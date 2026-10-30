// Loads one user's rows and turns them into stats / plan via the pure functions in stats.ts.
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, liveChannels, progress, progressHistory, rewards, skippedCampaigns, syncRuns, twitchAccounts } from "@/db/schema";
import {
  byGame,
  dailySeries,
  effectiveStatus,
  plan,
  skipActive,
  skipRetryAt,
  type StatItem,
  streak,
  summarizeCampaigns,
  syncHealth,
  totals,
  watchedPerSync,
} from "./stats";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const LIVE_FRESH_MS = 45 * MIN; // a channel seen by an older sync may have gone offline

export async function loadAccounts(userId: number) {
  return db()
    .select({
      id: twitchAccounts.id,
      login: twitchAccounts.login,
      displayName: twitchAccounts.displayName,
      status: twitchAccounts.status,
      lastSyncedAt: twitchAccounts.lastSyncedAt,
    })
    .from(twitchAccounts)
    .where(eq(twitchAccounts.userId, userId))
    .orderBy(asc(twitchAccounts.id));
}

export async function loadItems(accountIds: number[], now = new Date()): Promise<StatItem[]> {
  if (!accountIds.length) return [];
  const rows = await db()
    .select({
      accountId: progress.accountId,
      campaignId: campaigns.id,
      campaignExternalId: campaigns.campaignExternalId,
      campaignName: campaigns.campaignName,
      gameName: campaigns.gameName,
      name: campaigns.name,
      kind: campaigns.kind,
      imageUrl: campaigns.imageUrl,
      requiredMinutes: campaigns.requiredMinutes,
      requiredSubs: campaigns.requiredSubs,
      minutesWatched: progress.minutesWatched,
      subsCurrent: progress.subsCurrent,
      status: progress.status,
      endsAt: campaigns.endsAt,
      accountConnected: progress.accountConnected,
      accountLinkUrl: campaigns.accountLinkUrl,
    })
    .from(progress)
    .innerJoin(campaigns, eq(campaigns.id, progress.campaignId))
    .where(inArray(progress.accountId, accountIds));
  return rows.map((r) => ({ ...r, status: effectiveStatus(r.status, r.endsAt, now) }));
}

async function loadHistory(accountIds: number[], since: Date) {
  if (!accountIds.length) return [];
  return db()
    .select({
      accountId: progressHistory.accountId,
      campaignKey: sql<string>`coalesce(${campaigns.campaignExternalId}, 'name:' || coalesce(${campaigns.campaignName}, ${campaigns.name}))`,
      at: progressHistory.at,
      delta: progressHistory.delta,
    })
    .from(progressHistory)
    .innerJoin(campaigns, eq(campaigns.id, progressHistory.campaignId))
    .where(and(inArray(progressHistory.accountId, accountIds), gt(progressHistory.at, since), gt(progressHistory.delta, 0)));
}

export async function loadRewards(accountIds: number[], limit?: number) {
  if (!accountIds.length) return [];
  const q = db()
    .select({ accountId: rewards.accountId, name: rewards.name, imageUrl: rewards.imageUrl, awardedAt: rewards.awardedAt })
    .from(rewards)
    .where(inArray(rewards.accountId, accountIds))
    .orderBy(desc(rewards.awardedAt));
  return limit ? q.limit(limit) : q;
}

export async function loadLive(campaignExternalIds: string[], now: Date) {
  if (!campaignExternalIds.length) return [];
  return db()
    .select({
      campaignExternalId: liveChannels.campaignExternalId,
      login: liveChannels.login,
      displayName: liveChannels.displayName,
      viewers: liveChannels.viewers,
      title: liveChannels.title,
      avatarUrl: liveChannels.avatarUrl,
    })
    .from(liveChannels)
    .where(
      and(
        inArray(liveChannels.campaignExternalId, campaignExternalIds),
        gt(liveChannels.seenAt, new Date(now.getTime() - LIVE_FRESH_MS)),
      ),
    );
}

export async function buildStats(userId: number, days: number, tz: string, now = new Date()) {
  const accounts = await loadAccounts(userId);
  const ids = accounts.map((a) => a.id);
  const since = new Date(now.getTime() - days * DAY);
  const [items, history, allRewards, runs] = await Promise.all([
    loadItems(ids, now),
    loadHistory(ids, since),
    loadRewards(ids),
    ids.length
      ? db()
          .select({ status: syncRuns.status, startedAt: syncRuns.startedAt, finishedAt: syncRuns.finishedAt, errorCode: syncRuns.errorCode })
          .from(syncRuns)
          .where(and(inArray(syncRuns.accountId, ids), gt(syncRuns.startedAt, since)))
      : [],
  ]);

  const daily = dailySeries(history, allRewards, days, now, tz);
  const watchedByAccount = new Map<number, number>();
  for (const w of watchedPerSync(history)) watchedByAccount.set(w.accountId, (watchedByAccount.get(w.accountId) ?? 0) + w.minutes);
  const rewardsInRange = allRewards.filter((r) => r.awardedAt > since);

  const names = new Map(accounts.map((a) => [a.id, a.displayName]));
  const active = items.filter((i) => !i.endsAt || i.endsAt > now);
  const risks = summarizeCampaigns(active, now)
    .filter((c) => c.started && (c.risk === "impossible" || c.risk === "tight"))
    .sort((a, b) => (a.endsAt?.getTime() ?? Infinity) - (b.endsAt?.getTime() ?? Infinity))
    .map((c) => ({ ...c, accountName: names.get(c.accountId) ?? "" }));

  return {
    days,
    tz,
    totals: {
      ...totals(items, now),
      accounts: accounts.filter((a) => a.status !== "revoked").length,
      watchedMinutes: daily.reduce((s, d) => s + d.minutes, 0),
      rewardsInRange: rewardsInRange.length,
      rewardsAllTime: allRewards.length,
      streak: streak(daily),
    },
    daily,
    byGame: byGame(items, now).slice(0, 12),
    byAccount: accounts.map((a) => {
      const mine = items.filter((i) => i.accountId === a.id);
      const t = totals(mine, now);
      return {
        id: a.id,
        displayName: a.displayName,
        status: a.status,
        lastSyncedAt: a.lastSyncedAt,
        claimed: t.claimed,
        inProgress: t.inProgress,
        ready: t.ready,
        remainingMinutes: t.remainingMinutes,
        watchedMinutes: watchedByAccount.get(a.id) ?? 0,
        rewards: rewardsInRange.filter((r) => r.accountId === a.id).length,
      };
    }),
    risks,
    sync: syncHealth(runs),
    recentRewards: allRewards.slice(0, 12).map((r) => ({ ...r, accountName: names.get(r.accountId) ?? "" })),
  };
}

export type Stats = Awaited<ReturnType<typeof buildStats>>;

const PLAN_PER_ACCOUNT = 6;

// Skips of the given accounts; `no_progress` ones past their cooldown are deleted, so the campaign is tried again.
export async function loadSkipped(accountIds: number[], now = new Date()) {
  if (!accountIds.length) return [];
  const rows = await db()
    .select()
    .from(skippedCampaigns)
    .where(inArray(skippedCampaigns.accountId, accountIds))
    .orderBy(asc(skippedCampaigns.createdAt));
  const expired = rows.filter((r) => !skipActive(r, now));
  for (const r of expired) {
    await db().delete(skippedCampaigns).where(and(eq(skippedCampaigns.accountId, r.accountId), eq(skippedCampaigns.campaignKey, r.campaignKey)));
  }
  return rows.filter((r) => skipActive(r, now));
}

// Claims and watch items are the plan; every link reminder follows (the overview groups them by game).
function limitPlan(items: ReturnType<typeof plan>) {
  return [...items.filter((i) => i.action !== "link").slice(0, PLAN_PER_ACCOUNT), ...items.filter((i) => i.action === "link")];
}

export async function buildPlan(userId: number, now = new Date()) {
  const accounts = (await loadAccounts(userId)).filter((a) => a.status === "active" || a.status === "error");
  const items = await loadItems(
    accounts.map((a) => a.id),
    now,
  );
  const campaignIds = [...new Set(items.map((i) => i.campaignExternalId).filter((v): v is string => !!v))];
  const live = await loadLive(campaignIds, now);
  const skipped = await loadSkipped(accounts.map((a) => a.id), now);
  return {
    accounts: accounts.map((a) => {
      const own = skipped.filter((s) => s.accountId === a.id);
      return {
        id: a.id,
        displayName: a.displayName,
        items: limitPlan(
          plan(
            items.filter((i) => i.accountId === a.id),
            live,
            now,
            new Set(own.map((s) => s.campaignKey)),
          ),
        ),
        skipped: own.map((s) => ({ key: s.campaignKey, campaignName: s.campaignName, reason: s.reason, retryAt: skipRetryAt(s) })),
      };
    }),
  };
}

export type Plan = Awaited<ReturnType<typeof buildPlan>>;
