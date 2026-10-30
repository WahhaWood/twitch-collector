// Watch worker: a long-running process (scripts/worker.mts) that keeps up to MAX_WATCH live channels "open"
// per account: streak channels until the goal is reached on the current broadcast, then the most urgent drops campaign.
// Every account touch goes through the DB, so the web app sees what the worker does via twitch_accounts.watching.
// A drops campaign whose minutes do not grow within STALL_MS of watching is skipped with reason `no_progress`.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { skippedCampaigns, streakChannels, twitchAccounts, type WatchTarget } from "@/db/schema";
import { loadItems, loadLive } from "./stats-data";
import { campaignKey, plan, type StatItem } from "./stats";
import { syncAccount, withFreshToken } from "./sync";
import { TwitchError } from "./twitch";
import { type Channel, fetchChannel, fetchPlaylistUrl, headLatestChunk, sendMinuteWatched } from "./watch";

export const TICK_MS = 20_000;
export const MAX_WATCH = 2; // Twitch counts watch time on at most two channels at once
export const STREAK_GOAL_SECONDS = 7 * 60;
const PLAN_MS = 5 * 60_000;
const RETRY_MS = 60_000;
const SYNC_MS = 15 * 60_000;
export const STALL_MS = 20 * 60_000;

type Account = typeof twitchAccounts.$inferSelect;
type Streak = typeof streakChannels.$inferSelect;

// `reward`: the drop watching earns next; the campaign is often named after a sub-only reward.
type Candidate = WatchTarget & { streakId?: number; campaignKey?: string; reward?: string };
// `baseline`: campaign minutes when the current check window began at `checkFrom` (drops only).
type Watch = Candidate & {
  channelId: string;
  broadcastId: string;
  game: Channel["game"];
  playlistUrl: string;
  beatAt: number;
  checkFrom: number;
  baseline: number | null;
};
// `config` = what the user asked for; a change replans right away instead of waiting for PLAN_MS.
type State = { watches: Watch[]; plannedAt: number; syncedAt: number; offline: Set<string>; config: string };

// Streak channels that still need watching on their current broadcast, earliest broadcast first.
export function streakCandidates(streaks: Streak[]): Candidate[] {
  return streaks
    .filter((s) => s.live && s.broadcastId && s.watchedSeconds < STREAK_GOAL_SECONDS)
    .sort((a, b) => (a.liveSince?.getTime() ?? 0) - (b.liveSince?.getTime() ?? 0))
    .map((s) => ({ kind: "streak", login: s.login, displayName: s.displayName, streakId: s.id }));
}

// Channels of the most urgent watchable campaigns, in plan order; `offline` holds logins that failed this cycle.
export function dropCandidates(items: ReturnType<typeof plan>, offline: Set<string>): Candidate[] {
  return items
    .filter((i) => i.action === "watch" && i.risk !== "impossible")
    .flatMap((i) =>
      i.channels.map((c) => ({ kind: "drop" as const, login: c.login, displayName: c.displayName, campaignName: i.campaignName, campaignKey: i.key, reward: i.next?.name })),
    )
    .filter((c) => !offline.has(c.login));
}

// Watched minutes across the campaign's watch-based drops (they progress together); null when any is unknown.
export function campaignMinutes(items: StatItem[], key: string): number | null {
  const own = items.filter((i) => campaignKey(i) === key && i.requiredMinutes);
  if (!own.length || own.some((i) => i.minutesWatched === null)) return null;
  return own.reduce((sum, i) => sum + i.minutesWatched!, 0);
}

// Watching for a whole window did not move a known baseline: Twitch is not counting this view.
export function stalled(baseline: number | null, current: number | null): boolean {
  return baseline !== null && current !== null && current <= baseline;
}

// Streaks first (a few minutes each, tied to the broadcast); drops take what is left. One channel serves one purpose.
export function chooseTargets(streaks: Candidate[], drops: Candidate[], max = MAX_WATCH): Candidate[] {
  const out: Candidate[] = [];
  for (const c of streaks) if (out.length < max && !out.some((o) => o.login === c.login)) out.push(c);
  const drop = drops.find((d) => !out.some((o) => o.login === d.login));
  if (drop && out.length < max) out.push(drop);
  return out;
}

const states = new Map<number, State>();
const log = (a: Account, msg: string) => console.log(`${new Date().toISOString()} [${a.login}] ${msg}`);

export async function tick(now = Date.now()) {
  const accounts = await db()
    .select()
    .from(twitchAccounts)
    .where(and(inArray(twitchAccounts.status, ["active", "error"]), isNotNull(twitchAccounts.accessTokenEnc)));
  const streaks = accounts.length
    ? await db().select().from(streakChannels).where(inArray(streakChannels.accountId, accounts.map((a) => a.id)))
    : [];

  for (const a of accounts) {
    const mine = streaks.filter((s) => s.accountId === a.id);
    const state = states.get(a.id) ?? { watches: [], plannedAt: 0, syncedAt: 0, offline: new Set<string>(), config: "" };
    states.set(a.id, state);
    if (!a.autoWatch && !mine.length) {
      if (a.watching?.length) await setWatching(a.id, null);
      states.delete(a.id);
      continue;
    }
    try {
      await runAccount(a, mine, state, now);
    } catch (e) {
      log(a, `error: ${e instanceof TwitchError ? e.code : e instanceof Error ? e.message : "unknown"}`);
      state.plannedAt = now - PLAN_MS + RETRY_MS;
    }
  }
  // Accounts that left the list (disconnected, expired) stop being watched.
  for (const id of states.keys()) if (!accounts.some((a) => a.id === id)) states.delete(id);
}

async function runAccount(a: Account, streaks: Streak[], state: State, now: number) {
  if (a.autoWatch && now - state.syncedAt > SYNC_MS) {
    state.syncedAt = now;
    const r = await syncAccount(a.id);
    if (r.status !== "skipped") log(a, `sync ${r.status}${r.code ? ` ${r.code}` : ""}${r.claimed ? `, claimed ${r.claimed}` : ""}`);
    state.plannedAt = 0; // fresh progress and live channels
    state.offline.clear();
  }
  const config = `${a.autoWatch}|${streaks.map((s) => s.id).join(",")}`;
  if (config !== state.config || now - state.plannedAt > PLAN_MS) {
    state.config = config;
    await replan(a, streaks, state, now);
  }

  for (const w of [...state.watches]) {
    const ok = await beat(a, w);
    const elapsed = Math.min(now - w.beatAt, 2 * TICK_MS) / 1000;
    w.beatAt = now;
    if (!ok) {
      log(a, `lost ${w.login}`);
      if (w.kind === "drop") state.offline.add(w.login);
      state.watches = state.watches.filter((x) => x !== w);
      state.plannedAt = 0;
      continue;
    }
    if (w.streakId) {
      const s = streaks.find((x) => x.id === w.streakId);
      const seconds = Math.round((s?.watchedSeconds ?? 0) + elapsed);
      await db().update(streakChannels).set({ watchedSeconds: seconds }).where(eq(streakChannels.id, w.streakId));
      if (s) s.watchedSeconds = seconds;
      if (seconds >= STREAK_GOAL_SECONDS) {
        log(a, `streak goal reached on ${w.login}`);
        state.watches = state.watches.filter((x) => x !== w);
        state.plannedAt = 0;
      }
    }
  }
  await checkProgress(a, state, now);
  await setWatching(a.id, state.watches.map(({ kind, login, displayName, campaignName }) => ({ kind, login, displayName, campaignName })));
}

// Refreshes live state of streak channels, picks targets and opens playlists for the new ones.
async function replan(a: Account, streaks: Streak[], state: State, now: number) {
  state.plannedAt = now;
  await withFreshToken(a, async (token) => {
    for (const s of streaks) {
      const ch = await fetchChannel(token, s.login);
      const changed = (ch?.broadcastId ?? s.broadcastId) !== s.broadcastId;
      const update = {
        live: !!ch?.broadcastId,
        checkedAt: new Date(now),
        ...(ch ? { displayName: ch.displayName, avatarUrl: ch.avatarUrl } : {}),
        ...(changed ? { broadcastId: ch!.broadcastId, liveSince: ch!.liveSince, watchedSeconds: 0 } : {}),
      };
      await db().update(streakChannels).set(update).where(eq(streakChannels.id, s.id));
      Object.assign(s, update);
    }

    let drops: Candidate[] = [];
    let items: StatItem[] = [];
    if (a.autoWatch) {
      items = await loadItems([a.id], new Date(now));
      const ids = [...new Set(items.map((i) => i.campaignExternalId).filter((v): v is string => !!v))];
      const skipped = await db()
        .select({ key: skippedCampaigns.campaignKey })
        .from(skippedCampaigns)
        .where(eq(skippedCampaigns.accountId, a.id));
      const p = plan(items, await loadLive(ids, new Date(now)), new Date(now), new Set(skipped.map((s) => s.key)));
      drops = dropCandidates(p, state.offline);
    }

    const wanted = chooseTargets(streakCandidates(streaks), drops);
    const kept = state.watches.filter((w) => wanted.some((c) => c.login === w.login && c.kind === w.kind && c.campaignKey === w.campaignKey));
    const next: Watch[] = [...kept];
    for (const c of wanted) {
      if (next.length >= MAX_WATCH) break;
      if (next.some((w) => w.login === c.login)) continue;
      const ch = await fetchChannel(token, c.login);
      const url = ch?.broadcastId ? await fetchPlaylistUrl(token, c.login) : null;
      if (!ch?.broadcastId || !url) {
        if (c.kind === "drop") state.offline.add(c.login);
        continue;
      }
      const baseline = c.campaignKey ? campaignMinutes(items, c.campaignKey) : null;
      next.push({ ...c, channelId: ch.channelId, broadcastId: ch.broadcastId, game: ch.game, playlistUrl: url, beatAt: now, checkFrom: now, baseline });
      log(a, `watching ${c.login} (${c.kind === "drop" ? `drops: ${c.reward ?? "?"}, campaign ${c.campaignName ?? "?"}` : "streak"})`);
    }
    state.watches = next;
  });
}

// Every STALL_MS of drops watching: fresh sync, then drop the campaign if its minutes did not move.
async function checkProgress(a: Account, state: State, now: number) {
  const due = state.watches.filter((w) => w.kind === "drop" && w.campaignKey && now - w.checkFrom >= STALL_MS);
  if (!due.length) return;
  state.syncedAt = now;
  await syncAccount(a.id);
  const items = await loadItems([a.id], new Date(now));
  for (const w of due) {
    const current = campaignMinutes(items, w.campaignKey!);
    if (!stalled(w.baseline, current)) {
      w.baseline = current;
      w.checkFrom = now;
      continue;
    }
    log(a, `no progress on ${w.campaignName ?? w.campaignKey} after ${STALL_MS / 60_000} min, skipping`);
    await db()
      .insert(skippedCampaigns)
      .values({ accountId: a.id, campaignKey: w.campaignKey!, campaignName: w.campaignName ?? w.campaignKey!, reason: "no_progress" })
      .onConflictDoNothing();
    state.watches = state.watches.filter((x) => x !== w);
    state.plannedAt = 0;
  }
}

// HLS chunk keeps drops going; minute-watched counts the view for channel points and the streak.
async function beat(a: Account, w: Watch): Promise<boolean> {
  try {
    if (!(await headLatestChunk(w.playlistUrl))) return false;
    await sendMinuteWatched({ userId: a.twitchUserId, channelId: w.channelId, login: w.login, broadcastId: w.broadcastId, game: w.game }).catch(() => false);
    return true;
  } catch {
    return false;
  }
}

async function setWatching(accountId: number, watching: WatchTarget[] | null) {
  await db().update(twitchAccounts).set({ watching, watchingAt: watching ? new Date() : null }).where(eq(twitchAccounts.id, accountId));
}

export async function stopAll() {
  for (const id of states.keys()) await setWatching(id, null);
  states.clear();
}
