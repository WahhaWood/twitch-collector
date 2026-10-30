import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, liveChannels, loginAttempts, progress, progressHistory, rewards, syncRuns, twitchAccounts } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import {
  allowedLive,
  channelCampaigns,
  claimId,
  type ChannelsData,
  CHANNELS_PER_QUERY,
  channelsQuery,
  INVENTORY_QUERY,
  type InventoryData,
  type LiveChannelRow,
  liveChannels as toLiveChannels,
  parseDrops,
  type ProgressStatus,
  pickChannels,
  type StreamEdge,
  type StreamsData,
  streamsQuery,
} from "./drops";
import { env } from "./env";
import { gql, refreshTokens, TwitchError } from "./twitch";
import { claimDrop } from "./watch";

const LOCK_MS = 60_000;
const REFRESH_MARGIN_MS = 5 * 60_000;
const STREAM_PAGES = 45; // ~1300 live drops-enabled streams (~12 s): reaches every game that has drops, not just the biggest
const MAX_CHANNELS = 250;
const STREAMS_TTL_MS = 5 * 60_000; // the stream list is the same for everyone; the worker syncs far more often than it changes

export type SyncResult = { status: "ok" | "failed" | "skipped"; code?: string; claimed?: number };

type Account = typeof twitchAccounts.$inferSelect;

export async function fetchDrops(accessToken: string, now = new Date()) {
  const { inventory, campaigns, live } = await fetchDropSources(accessToken);
  return { ...parseDrops(inventory, campaigns, now), live };
}

export async function fetchDropSources(accessToken: string) {
  const inventory = await gql<InventoryData>(accessToken, INVENTORY_QUERY);

  const edges = await fetchStreams(accessToken);
  const channels = pickChannels(edges).slice(0, MAX_CHANNELS);
  const campaigns = [];
  const live: LiveChannelRow[] = [];
  for (let i = 0; i < channels.length; i += CHANNELS_PER_QUERY) {
    const ids = channels.slice(i, i + CHANNELS_PER_QUERY);
    const data = await gql<ChannelsData>(accessToken, channelsQuery(ids));
    campaigns.push(...channelCampaigns(data));
    live.push(...toLiveChannels(edges, ids, data));
  }
  const known = [...(inventory.currentUser?.inventory?.dropCampaignsInProgress ?? []), ...campaigns];
  live.push(...allowedLive(known, edges));
  return { inventory, campaigns, live };
}

let streamsCache: { at: number; edges: StreamEdge[] } | null = null;

async function fetchStreams(accessToken: string): Promise<StreamEdge[]> {
  if (streamsCache && Date.now() - streamsCache.at < STREAMS_TTL_MS) return streamsCache.edges;
  const edges: StreamEdge[] = [];
  let after: string | undefined;
  for (let page = 0; page < STREAM_PAGES; page++) {
    const { streams } = await gql<StreamsData>(accessToken, streamsQuery(after));
    edges.push(...(streams?.edges ?? []));
    after = edges.at(-1)?.cursor ?? undefined;
    if (!streams?.pageInfo?.hasNextPage || !after) break;
  }
  streamsCache = { at: Date.now(), edges };
  return edges;
}

export async function syncAccount(accountId: number): Promise<SyncResult> {
  const now = new Date();
  const [account] = await db()
    .update(twitchAccounts)
    .set({ lockedUntil: new Date(now.getTime() + LOCK_MS) })
    .where(
      and(
        eq(twitchAccounts.id, accountId),
        isNotNull(twitchAccounts.accessTokenEnc),
        or(isNull(twitchAccounts.lockedUntil), lt(twitchAccounts.lockedUntil, now)),
      ),
    )
    .returning();
  if (!account) return { status: "skipped" };

  const [run] = await db().insert(syncRuns).values({ accountId }).returning({ id: syncRuns.id });
  let result: SyncResult;
  try {
    const { parsed, claimed } = await withFreshToken(account, async (token) => {
      const parsed = await fetchDrops(token, now);
      return { parsed, claimed: await claimReady(token, account.twitchUserId, parsed) };
    });
    await store(accountId, parsed, now);
    await db()
      .update(twitchAccounts)
      .set({ status: "active", lastSyncedAt: now, lockedUntil: null })
      .where(eq(twitchAccounts.id, accountId));
    result = { status: "ok", ...(claimed ? { claimed } : {}) };
  } catch (e) {
    const code = e instanceof TwitchError ? e.code : "internal";
    const expired = code === "unauthorized";
    // Failed accounts still count as synced so a broken one does not hog every cron batch.
    await db()
      .update(twitchAccounts)
      .set({ status: expired ? "expired" : "error", lastSyncedAt: now, lockedUntil: null })
      .where(eq(twitchAccounts.id, accountId));
    if (!(e instanceof TwitchError)) console.error("sync failed", accountId, e instanceof Error ? e.message : "unknown");
    result = { status: "failed", code: expired ? "token_expired" : code };
    await db()
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "failed", errorCode: result.code, errorSummary: summary(e) })
      .where(eq(syncRuns.id, run.id));
    return result;
  }
  await db().update(syncRuns).set({ finishedAt: new Date(), status: "ok" }).where(eq(syncRuns.id, run.id));
  return result;
}

// Claims every watched-out drop; a confirmed claim turns its progress row into `claimed` before it is stored.
// A failed claim leaves the row as is, so the next sync retries it.
async function claimReady(token: string, twitchUserId: string, parsed: ReturnType<typeof parseDrops>): Promise<number> {
  let claimed = 0;
  for (const c of parsed.claimable) {
    const ok = await claimDrop(token, claimId(c, twitchUserId)).catch((e) => {
      if (e instanceof TwitchError && e.code === "unauthorized") throw e;
      return false;
    });
    const row = parsed.progress.find((p) => p.externalId === c.externalId);
    if (ok && row) {
      row.status = "claimed";
      claimed++;
    }
  }
  return claimed;
}

// Refreshes ahead of expiry, and once more on a 401; a second rejection means the account must reconnect.
export async function withFreshToken<T>(account: Account, fn: (token: string) => Promise<T>): Promise<T> {
  const key = env().TOKEN_ENC_KEY;
  let token = decrypt(account.accessTokenEnc!, key);
  let refreshed = false;
  const refresh = async () => {
    if (!account.refreshTokenEnc) throw new TwitchError("unauthorized", "No refresh token");
    const tokens = await refreshTokens(decrypt(account.refreshTokenEnc, key));
    await db()
      .update(twitchAccounts)
      .set({
        accessTokenEnc: encrypt(tokens.accessToken, key),
        refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken, key) : account.refreshTokenEnc,
        tokenExpiresAt: tokens.expiresAt,
      })
      .where(eq(twitchAccounts.id, account.id));
    token = tokens.accessToken;
    refreshed = true;
  };

  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS) await refresh();
  try {
    return await fn(token);
  } catch (e) {
    if (!(e instanceof TwitchError) || e.code !== "unauthorized" || refreshed) throw e;
    await refresh();
    return fn(token);
  }
}

type Parsed = ReturnType<typeof parseDrops> & { live: LiveChannelRow[] };
type Prev = { minutesWatched: number | null; status: ProgressStatus };

// History row for a changed progress row; null when nothing changed. The first sighting of a drop has no
// baseline, so its watched minutes are not counted as gained (they may be from before the account was connected).
export function historyEntry(prev: Prev | undefined, next: Prev): { delta: number } | null {
  if (!prev) return next.status === "claimed" || (next.minutesWatched ?? 0) > 0 ? { delta: 0 } : null;
  if (prev.minutesWatched === next.minutesWatched && prev.status === next.status) return null;
  const gained = prev.minutesWatched !== null && next.minutesWatched !== null ? next.minutesWatched - prev.minutesWatched : 0;
  return { delta: Math.max(0, gained) };
}

async function store(accountId: number, parsed: Parsed, now: Date) {
  if (parsed.rewards.length) {
    await db()
      .insert(rewards)
      .values(parsed.rewards.map((r) => ({ accountId, ...r })))
      .onConflictDoUpdate({
        target: [rewards.accountId, rewards.benefitId],
        set: { name: sql`excluded.name`, imageUrl: sql`excluded.image_url`, awardedAt: sql`excluded.awarded_at` },
      });
  }
  if (parsed.live.length) {
    await db()
      .insert(liveChannels)
      .values(dedupeLive(parsed.live).map((l) => ({ ...l, seenAt: now })))
      .onConflictDoUpdate({
        target: [liveChannels.campaignExternalId, liveChannels.channelId],
        set: {
          login: sql`excluded.login`,
          displayName: sql`excluded.display_name`,
          title: sql`excluded.title`,
          viewers: sql`excluded.viewers`,
          avatarUrl: sql`excluded.avatar_url`,
          seenAt: sql`excluded.seen_at`,
        },
      });
  }
  if (!parsed.drops.length) return;
  const rows = await db()
    .insert(campaigns)
    .values(parsed.drops.map((d) => ({ ...d, lastSeenAt: now })))
    .onConflictDoUpdate({
      target: campaigns.externalId,
      set: {
        kind: sql`excluded.kind`,
        name: sql`excluded.name`,
        campaignName: sql`excluded.campaign_name`,
        campaignExternalId: sql`excluded.campaign_external_id`,
        accountLinkUrl: sql`excluded.account_link_url`,
        gameName: sql`excluded.game_name`,
        imageUrl: sql`excluded.image_url`,
        startsAt: sql`excluded.starts_at`,
        endsAt: sql`excluded.ends_at`,
        requiredMinutes: sql`excluded.required_minutes`,
        requiredSubs: sql`excluded.required_subs`,
        lastSeenAt: sql`excluded.last_seen_at`,
      },
    })
    .returning({ id: campaigns.id, externalId: campaigns.externalId });
  const ids = new Map(rows.map((r) => [r.externalId, r.id]));
  const values = parsed.progress.map((p) => ({
    accountId,
    campaignId: ids.get(p.externalId)!,
    minutesWatched: p.minutesWatched,
    subsCurrent: p.subsCurrent,
    status: p.status,
    accountConnected: p.accountConnected,
    source: "twitch" as const,
    fetchedAt: now,
  }));

  const before = await db()
    .select({ campaignId: progress.campaignId, minutesWatched: progress.minutesWatched, status: progress.status })
    .from(progress)
    .where(eq(progress.accountId, accountId));
  const prev = new Map(before.map((b) => [b.campaignId, b]));
  const history = values.flatMap((v) => {
    const entry = historyEntry(prev.get(v.campaignId), v);
    return entry ? [{ accountId, campaignId: v.campaignId, minutesWatched: v.minutesWatched, status: v.status, delta: entry.delta, at: now }] : [];
  });
  if (history.length) await db().insert(progressHistory).values(history);

  await db()
    .insert(progress)
    .values(values)
    .onConflictDoUpdate({
      target: [progress.accountId, progress.campaignId],
      set: {
        minutesWatched: sql`excluded.minutes_watched`,
        subsCurrent: sql`excluded.subs_current`,
        status: sql`excluded.status`,
        source: sql`excluded.source`,
        accountConnected: sql`excluded.account_connected`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
}

// One statement must not touch the same key twice.
function dedupeLive(rows: LiveChannelRow[]) {
  return [...new Map(rows.map((r) => [`${r.campaignExternalId}:${r.channelId}`, r])).values()];
}

function summary(e: unknown): string {
  if (e instanceof TwitchError) return e.message;
  return "Internal error during sync";
}

export async function pruneOldRows(now = new Date()) {
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  await db().delete(syncRuns).where(lt(syncRuns.startedAt, monthAgo));
  await db().delete(loginAttempts).where(lt(loginAttempts.at, dayAgo));
  await db().delete(liveChannels).where(lt(liveChannels.seenAt, dayAgo));
}
