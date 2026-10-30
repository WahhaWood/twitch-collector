// Watch worker: a long-running process (scripts/worker.mts) that keeps up to MAX_WATCH live channels "open"
// per account: streak channels until the goal is reached on the current broadcast, then the most urgent drops campaign.
// Every account touch goes through the DB, so the web app sees what the worker does via twitch_accounts.watching / worker_status.
//
// Adaptive behaviour (each piece is a small pure function below, covered by tests):
// - accounts run in parallel; an account that fails backs off exponentially (backoffMs) without holding up the others;
// - a lost stream is tolerated for MAX_MISSES beats, then its channel rests for OFFLINE_TTL_MS;
// - a drops campaign whose minutes do not grow is retried on another channel (stallAction), then skipped for a cooldown;
// - the account is synced when the next reward should be earned (syncDueAt), so it is claimed within minutes;
// - the plan is refreshed faster while a followed streamer is offline (planInterval).
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { skippedCampaigns, streakChannels, twitchAccounts, type WatchTarget, type WorkerStatus } from "@/db/schema";
import { decrypt } from "./crypto";
import { env } from "./env";
import { loadItems, loadLive, loadSkipped } from "./stats-data";
import { campaignKey, plan, type StatItem } from "./stats";
import { syncAccount, withFreshToken } from "./sync";
import { TwitchError } from "./twitch";
import { type Channel, fetchChannel, fetchPlaylistUrl, headLatestChunk, sendMinuteWatched } from "./watch";

export const TICK_MS = 20_000;
export const MAX_WATCH = 2; // Twitch counts watch time on at most two channels at once
export const STREAK_GOAL_SECONDS = 7 * 60;
const PLAN_MS = 5 * 60_000;
const PLAN_WAITING_MS = 2 * 60_000;
const RETRY_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const SYNC_MS = 15 * 60_000;
const SYNC_MIN_GAP_MS = 3 * 60_000;
const ETA_LEAD_MS = 60_000;
export const STALL_FIRST_MS = 10 * 60_000; // first check of a fresh channel; later windows are STALL_MS
export const STALL_MS = 20 * 60_000;
export const MAX_CHANNEL_TRIES = 2;
export const MAX_MISSES = 3;
export const MINUTE_MS = 60_000; // Twitch counts one minute-watched per channel per minute; the tick is faster
const OFFLINE_TTL_MS = 10 * 60_000;
const MAX_OFFLINE_TTL_MS = 2 * 60 * 60_000;

type Account = typeof twitchAccounts.$inferSelect;
type Streak = typeof streakChannels.$inferSelect;

// `reward`: the drop watching earns next; the campaign is often named after a sub-only reward.
// `etaMin`: minutes of watching until that reward.
type Candidate = WatchTarget & { streakId?: number; campaignKey?: string; etaMin?: number | null };
// `baseline`: campaign minutes when the current check window began at `checkFrom` (drops only).
type Watch = Candidate & {
  channelId: string;
  broadcastId: string;
  game: Channel["game"];
  playlistUrl: string;
  beatAt: number;
  checkFrom: number;
  checkAfter: number;
  baseline: number | null;
  etaAt: number | null;
  misses: number;
  minuteAt: number; // when minute-watched was last sent for this channel
};
type State = {
  watches: Watch[];
  plannedAt: number;
  syncedAt: number;
  // login -> until when it is considered offline
  offline: Map<string, number>;
  // login -> how many times in a row it failed (reset when watching it moves a campaign)
  strikes: Map<string, number>;
  // campaign key -> channels where watching did not move the campaign
  tried: Map<string, Set<string>>;
  lastDrops: Candidate[];
  // `config` = what the user asked for; a change replans right away instead of waiting for the plan interval.
  config: string;
  failures: number;
  retryAt: number;
  idle: { reason: WorkerStatus["reason"]; detail: string | null };
};

// Streak channels that still need watching on their current broadcast, earliest broadcast first.
export function streakCandidates(streaks: Streak[]): Candidate[] {
  return streaks
    .filter((s) => s.live && s.broadcastId && s.watchedSeconds < STREAK_GOAL_SECONDS)
    .sort((a, b) => (a.liveSince?.getTime() ?? 0) - (b.liveSince?.getTime() ?? 0))
    .map((s) => ({ kind: "streak", login: s.login, displayName: s.displayName, avatarUrl: s.avatarUrl, streakId: s.id }));
}

// Channels of the most urgent watchable campaigns, in plan order; `offline` holds logins that failed recently,
// `tried` the channels of a campaign where watching did not count.
export function dropCandidates(
  items: ReturnType<typeof plan>,
  offline: ReadonlySet<string>,
  tried: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): Candidate[] {
  return items
    .filter((i) => i.action === "watch" && i.risk !== "impossible")
    .flatMap((i) =>
      i.channels.map((c) => ({
        kind: "drop" as const,
        login: c.login,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
        campaignName: i.campaignName,
        campaignKey: i.key,
        reward: i.next?.name,
        etaMin: i.next?.remainingMinutes ?? null,
      })),
    )
    .filter((c) => !offline.has(c.login) && !tried.get(c.campaignKey)?.has(c.login));
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

// A stalled campaign gets another channel first (the streamer may not run drops); after MAX_CHANNEL_TRIES it is skipped.
export function stallAction(tried: number, alternatives: number): "rotate" | "skip" {
  return tried < MAX_CHANNEL_TRIES && alternatives > 0 ? "rotate" : "skip";
}

// Streaks first (a few minutes each, tied to the broadcast); drops take what is left. One channel serves one purpose.
export function chooseTargets(streaks: Candidate[], drops: Candidate[], max = MAX_WATCH): Candidate[] {
  const out: Candidate[] = [];
  for (const c of streaks) if (out.length < max && !out.some((o) => o.login === c.login)) out.push(c);
  const drop = drops.find((d) => !out.some((o) => o.login === d.login));
  if (drop && out.length < max) out.push(drop);
  return out;
}

export function backoffMs(failures: number): number {
  return Math.min(RETRY_MS * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);
}

// When the account should be synced next: SYNC_MS after the last sync, or a minute after the next reward is due, if sooner.
export function syncDueAt(syncedAt: number, etas: (number | null)[]): number {
  let due = syncedAt + SYNC_MS;
  for (const eta of etas) if (eta !== null && eta + ETA_LEAD_MS > syncedAt) due = Math.min(due, eta + ETA_LEAD_MS);
  return Math.max(due, syncedAt + SYNC_MIN_GAP_MS);
}

// Look for a followed streamer's broadcast more often than the plan otherwise changes.
export function planInterval(waitingForStreamer: boolean): number {
  return waitingForStreamer ? PLAN_WAITING_MS : PLAN_MS;
}

// A channel that keeps failing rests longer each time, so a broken top-priority channel cannot keep stealing the slot.
export function offlineTtl(strikes: number): number {
  return Math.min(OFFLINE_TTL_MS * 2 ** Math.max(0, strikes), MAX_OFFLINE_TTL_MS);
}

export function activeOffline(offline: Map<string, number>, now: number): Set<string> {
  for (const [login, until] of offline) if (until <= now) offline.delete(login);
  return new Set(offline.keys());
}

const states = new Map<number, State>();
const newState = (): State => ({
  watches: [],
  plannedAt: 0,
  syncedAt: 0,
  offline: new Map(),
  strikes: new Map(),
  tried: new Map(),
  lastDrops: [],
  config: "",
  failures: 0,
  retryAt: 0,
  idle: { reason: "ok", detail: null },
});
function rest(state: State, login: string, now: number) {
  const strikes = state.strikes.get(login) ?? 0;
  state.offline.set(login, now + offlineTtl(strikes));
  state.strikes.set(login, strikes + 1);
}
const log = (a: Account, msg: string) => console.log(`${new Date().toISOString()} [${a.login}] ${msg}`);

export async function tick(now = Date.now()) {
  const accounts = await db()
    .select()
    .from(twitchAccounts)
    .where(and(inArray(twitchAccounts.status, ["active", "error"]), isNotNull(twitchAccounts.accessTokenEnc)));
  const streaks = accounts.length
    ? await db().select().from(streakChannels).where(inArray(streakChannels.accountId, accounts.map((a) => a.id)))
    : [];

  await Promise.allSettled(accounts.map((a) => tickAccount(a, streaks.filter((s) => s.accountId === a.id), now)));
  // Accounts that left the list (disconnected, expired) stop being watched.
  for (const id of states.keys()) if (!accounts.some((a) => a.id === id)) states.delete(id);
}

async function tickAccount(a: Account, mine: Streak[], now: number) {
  const state = states.get(a.id) ?? newState();
  states.set(a.id, state);
  if (!a.autoWatch && !mine.length) {
    if (a.watching?.length || a.workerStatus) await setWatching(a.id, null, null);
    states.delete(a.id);
    return;
  }
  if (now < state.retryAt) {
    // Backing off after an error: keep the heartbeat so the UI shows "retrying", not "worker is down".
    await db().update(twitchAccounts).set({ watchingAt: new Date() }).where(eq(twitchAccounts.id, a.id)).catch(() => undefined);
    return;
  }
  try {
    await runAccount(a, mine, state, now);
    state.failures = 0;
  } catch (e) {
    state.failures++;
    state.retryAt = now + backoffMs(state.failures);
    const code = e instanceof TwitchError ? e.code : e instanceof Error ? e.message : "unknown";
    log(a, `error: ${code}, retry in ${Math.round(backoffMs(state.failures) / 1000)} s`);
    state.plannedAt = 0;
    state.watches = [];
    if (e instanceof TwitchError && e.code === "unauthorized") {
      await db().update(twitchAccounts).set({ status: "expired" }).where(eq(twitchAccounts.id, a.id));
    }
    await setWatching(a.id, [], { state: "error", reason: "error", retryAt: new Date(state.retryAt).toISOString(), detail: code }).catch(() => undefined);
  }
}

async function runAccount(a: Account, streaks: Streak[], state: State, now: number) {
  const due = syncDueAt(state.syncedAt, state.watches.map((w) => w.etaAt));
  if (a.autoWatch && now >= due) {
    state.syncedAt = now;
    const r = await syncAccount(a.id);
    if (r.status !== "skipped") log(a, `sync ${r.status}${r.code ? ` ${r.code}` : ""}${r.claimed ? `, claimed ${r.claimed}` : ""}`);
    state.plannedAt = 0; // fresh progress and live channels
  }
  const config = `${a.autoWatch}|${streaks.map((s) => s.id).join(",")}`;
  const waiting = streaks.some((s) => !s.live);
  if (config !== state.config || now - state.plannedAt > planInterval(waiting)) {
    state.config = config;
    await replan(a, streaks, state, now);
  }

  for (const w of [...state.watches]) {
    const ok = await beat(a, w, now);
    const elapsed = Math.min(now - w.beatAt, 2 * TICK_MS) / 1000;
    w.beatAt = now;
    if (!ok) {
      if (++w.misses < MAX_MISSES) continue; // a hiccup, not a lost stream
      log(a, `lost ${w.login}`);
      rest(state, w.login, now);
      state.watches = state.watches.filter((x) => x !== w);
      state.plannedAt = 0;
      continue;
    }
    w.misses = 0;
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
  const targets = state.watches.map(({ kind, login, displayName, campaignName, reward, avatarUrl }) => ({ kind, login, displayName, campaignName, reward, avatarUrl }));
  await setWatching(a.id, targets, {
    state: targets.length ? "watching" : "idle",
    reason: targets.length ? "ok" : state.idle.reason,
    detail: targets.length ? null : state.idle.detail,
  });
}

// Refreshes live state of streak channels, picks targets and opens playlists for the new ones.
// Runs a watching call with the Android-client token when the account has one (it is the one that earns drops minutes).
// If Twitch rejects it, it is dropped and the call falls back to the TV token; an account must never turn "expired" over it.
async function viaWatchToken<T>(a: Account, tvToken: string, fn: (token: string, client?: string) => Promise<T>): Promise<T> {
  if (!a.watchTokenEnc) return fn(tvToken);
  try {
    return await fn(decrypt(a.watchTokenEnc, env().TOKEN_ENC_KEY), env().TWITCH_WATCH_CLIENT_ID);
  } catch (e) {
    if (!(e instanceof TwitchError && e.code === "unauthorized")) throw e;
    a.watchTokenEnc = null;
    await db().update(twitchAccounts).set({ watchTokenEnc: null }).where(eq(twitchAccounts.id, a.id));
    log(a, "watch token rejected by Twitch, falling back to the TV token");
    return fn(tvToken);
  }
}

async function replan(a: Account, streaks: Streak[], state: State, now: number) {
  state.plannedAt = now;
  await withFreshToken(a, async (token) => {
    for (const s of streaks) {
      const ch = await viaWatchToken(a, token, (t, client) => fetchChannel(t, s.login, client));
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
    let watchable = 0;
    let starving: string[] = []; // watchable campaigns that have no usable live channel right now
    if (a.autoWatch) {
      items = await loadItems([a.id], new Date(now));
      const ids = [...new Set(items.map((i) => i.campaignExternalId).filter((v): v is string => !!v))];
      const skipped = await loadSkipped([a.id], new Date(now));
      const p = plan(items, await loadLive(ids, new Date(now)), new Date(now), new Set(skipped.map((s) => s.campaignKey)));
      watchable = p.filter((i) => i.action === "watch" && i.risk !== "impossible").length;
      drops = dropCandidates(p, activeOffline(state.offline, now), state.tried);
      const served = new Set(drops.map((d) => d.campaignKey));
      starving = p.filter((i) => i.action === "watch" && i.risk !== "impossible" && !served.has(i.key)).map((i) => i.campaignName ?? i.key);
    }
    state.lastDrops = drops;

    const wanted = chooseTargets(streakCandidates(streaks), drops);
    const kept = state.watches.filter((w) => wanted.some((c) => c.login === w.login && c.kind === w.kind && c.campaignKey === w.campaignKey));
    for (const w of kept) {
      const c = wanted.find((x) => x.login === w.login && x.kind === w.kind && x.campaignKey === w.campaignKey)!;
      w.reward = c.reward;
      w.etaAt = c.etaMin != null ? now + c.etaMin * 60_000 : null;
    }
    const next: Watch[] = [...kept];
    for (const c of wanted) {
      if (next.length >= MAX_WATCH) break;
      if (next.some((w) => w.login === c.login)) continue;
      const ch = await viaWatchToken(a, token, (t, client) => fetchChannel(t, c.login, client));
      const url = ch?.broadcastId ? await viaWatchToken(a, token, (t, client) => fetchPlaylistUrl(t, c.login, client)) : null;
      if (!ch?.broadcastId || !url) {
        if (c.kind === "drop") rest(state, c.login, now);
        continue;
      }
      const baseline = c.campaignKey ? campaignMinutes(items, c.campaignKey) : null;
      next.push({
        ...c,
        channelId: ch.channelId,
        broadcastId: ch.broadcastId,
        game: ch.game,
        playlistUrl: url,
        beatAt: now,
        checkFrom: now,
        checkAfter: STALL_FIRST_MS,
        baseline,
        etaAt: c.etaMin != null ? now + c.etaMin * 60_000 : null,
        misses: 0,
        minuteAt: 0,
      });
      log(a, `watching ${c.login} (${c.kind === "drop" ? `drops: ${c.reward ?? "?"}, campaign ${c.campaignName ?? "?"}` : "streak"})`);
    }
    state.watches = next;
    state.idle = {
      reason: !a.autoWatch ? "waiting_streamers" : watchable === 0 ? "no_campaigns" : "no_live",
      detail: (watchable > 0 ? [...new Set(starving)].slice(0, 4).join(", ") : streaks.filter((s) => !s.live).map((s) => s.displayName).join(", ")) || null,
    };
  });
}

// Every check window of drops watching: fresh sync, then rotate the channel or skip the campaign if its minutes did not move.
async function checkProgress(a: Account, state: State, now: number) {
  const due = state.watches.filter((w) => w.kind === "drop" && w.campaignKey && now - w.checkFrom >= w.checkAfter);
  if (!due.length) return;
  state.syncedAt = now;
  await syncAccount(a.id);
  const items = await loadItems([a.id], new Date(now));
  for (const w of due) {
    const key = w.campaignKey!;
    const current = campaignMinutes(items, key);
    if (!stalled(w.baseline, current)) {
      w.baseline = current;
      w.checkFrom = now;
      w.checkAfter = STALL_MS;
      state.tried.delete(key);
      state.strikes.delete(w.login);
      state.plannedAt = 0; // progress moved: the plan may have changed (reward earned, campaign done)
      continue;
    }
    const tried = state.tried.get(key) ?? new Set<string>();
    tried.add(w.login);
    state.tried.set(key, tried);
    const alternatives = state.lastDrops.filter((c) => c.campaignKey === key && !tried.has(c.login)).length;
    state.watches = state.watches.filter((x) => x !== w);
    state.plannedAt = 0;
    if (stallAction(tried.size, alternatives) === "rotate") {
      log(a, `no progress on ${w.campaignName ?? key} via ${w.login}, trying another channel`);
      continue;
    }
    log(a, `no progress on ${w.campaignName ?? key} after ${tried.size} channel(s), skipping for a while`);
    state.tried.delete(key);
    await db()
      .insert(skippedCampaigns)
      .values({ accountId: a.id, campaignKey: key, campaignName: w.campaignName ?? key, reason: "no_progress" })
      .onConflictDoNothing();
  }
}

// HLS chunk keeps drops going; minute-watched counts the view for channel points and the streak.
export function minuteDue(lastAt: number, now: number): boolean {
  return now - lastAt >= MINUTE_MS;
}

async function beat(a: Account, w: Watch, now: number): Promise<boolean> {
  try {
    if (!(await headLatestChunk(w.playlistUrl))) return false;
    if (!minuteDue(w.minuteAt, now)) return true;
    w.minuteAt = now;
    await sendMinuteWatched({ userId: a.twitchUserId, channelId: w.channelId, login: w.login, broadcastId: w.broadcastId, game: w.game }).catch(() => false);
    return true;
  } catch {
    return false;
  }
}

async function setWatching(accountId: number, watching: WatchTarget[] | null, status: WorkerStatus | null) {
  await db()
    .update(twitchAccounts)
    .set({ watching, watchingAt: watching ? new Date() : null, workerStatus: status })
    .where(eq(twitchAccounts.id, accountId));
}

export async function stopAll() {
  for (const id of states.keys()) await setWatching(id, null, null);
  states.clear();
}
