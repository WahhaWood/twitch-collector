// Pure statistics and watch planning over stored progress. No DB access here, so everything is unit-testable.
import { earned, type ProgressStatus } from "./drops";

export type StatItem = {
  accountId: number;
  campaignId: number;
  campaignExternalId: string | null;
  campaignName: string | null;
  gameName: string | null;
  name: string;
  kind: "drop" | "badge";
  imageUrl: string | null;
  requiredMinutes: number | null;
  requiredSubs: number | null;
  minutesWatched: number | null;
  subsCurrent: number | null;
  status: ProgressStatus;
  endsAt: Date | null;
  accountConnected: boolean | null;
  accountLinkUrl: string | null;
};
export type HistoryPoint = { accountId: number; campaignKey: string; at: Date; delta: number };
export type RewardPoint = { accountId: number; awardedAt: Date };
export type SyncRunRow = { status: "ok" | "partial" | "failed" | null; startedAt: Date; finishedAt: Date | null; errorCode: string | null };
export type LiveChannel = { campaignExternalId: string; login: string; displayName: string; viewers: number | null; title: string | null; avatarUrl: string | null };

export type Risk = "ok" | "tight" | "impossible";
export type CampaignSummary = {
  accountId: number;
  key: string;
  campaignExternalId: string | null;
  campaignName: string;
  gameName: string | null;
  imageUrl: string | null;
  endsAt: Date | null;
  drops: number;
  claimed: number;
  ready: number;
  // Open drops that need watch time (zero-minute ones come from subs or gifts).
  pending: number;
  // Something already watched or claimed: a deadline only matters for campaigns the viewer is doing.
  started: boolean;
  // Minutes until every watch-based drop is earned; null when some progress is unknown.
  remainingMinutes: number | null;
  next: { name: string; imageUrl: string | null; remainingMinutes: number } | null;
  // Open drops of the campaign that only a sub or gifted sub earns; watching does nothing for them.
  subDrops: { name: string; imageUrl: string | null; subs: number; requiredSubs: number }[];
  needsLink: boolean;
  accountLinkUrl: string | null;
  risk: Risk | null;
};
export type PlanItem = CampaignSummary & {
  action: "claim" | "link" | "watch";
  channels: Omit<LiveChannel, "campaignExternalId">[];
};

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export function campaignKey(i: { campaignExternalId: string | null; campaignName: string | null; name: string }) {
  return i.campaignExternalId ?? `name:${i.campaignName ?? i.name}`;
}

export function isReady(i: Pick<StatItem, "status" | "requiredMinutes" | "minutesWatched" | "requiredSubs" | "subsCurrent">) {
  return i.status === "in_progress" && earned(i.minutesWatched, i.requiredMinutes, i.subsCurrent, i.requiredSubs);
}

// Rows of campaigns that ended before the last sync saw them keep their old status; past the end date they are expired.
export function effectiveStatus(status: ProgressStatus, endsAt: Date | null, now: Date): ProgressStatus {
  if (status === "claimed" || status === "expired" || !endsAt || endsAt.getTime() > now.getTime()) return status;
  return "expired";
}

const isOpen = (i: StatItem) => i.status === "in_progress" || i.status === "not_started" || i.status === "unknown";

// "YYYY-MM-DD" in the viewer's time zone, so days split at their midnight, not UTC.
export function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// Drops of one campaign gain minutes together, so one sync's gain is the campaign's max delta, not the sum.
export function watchedPerSync(history: HistoryPoint[]): { accountId: number; at: Date; minutes: number }[] {
  const max = new Map<string, { accountId: number; at: Date; campaign: string; minutes: number }>();
  for (const h of history) {
    if (h.delta <= 0) continue;
    const k = `${h.accountId}|${h.campaignKey}|${h.at.getTime()}`;
    const cur = max.get(k);
    if (!cur || h.delta > cur.minutes) max.set(k, { accountId: h.accountId, at: h.at, campaign: h.campaignKey, minutes: h.delta });
  }
  // Watching one stream can advance several campaigns at once; per account and sync, count the largest gain only.
  const perSync = new Map<string, { accountId: number; at: Date; minutes: number }>();
  for (const v of max.values()) {
    const k = `${v.accountId}|${v.at.getTime()}`;
    const cur = perSync.get(k);
    if (!cur || v.minutes > cur.minutes) perSync.set(k, { accountId: v.accountId, at: v.at, minutes: v.minutes });
  }
  return [...perSync.values()];
}

export type DailyPoint = { day: string; minutes: number; rewards: number };

export function dailySeries(history: HistoryPoint[], rewards: RewardPoint[], days: number, now: Date, tz: string): DailyPoint[] {
  const series = new Map<string, DailyPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(new Date(now.getTime() - i * DAY), tz);
    series.set(day, { day, minutes: 0, rewards: 0 });
  }
  for (const w of watchedPerSync(history)) {
    const p = series.get(dayKey(w.at, tz));
    if (p) p.minutes += w.minutes;
  }
  for (const r of rewards) {
    const p = series.get(dayKey(r.awardedAt, tz));
    if (p) p.rewards += 1;
  }
  return [...series.values()];
}

// Consecutive days with watch time, ending today (or yesterday, so an unwatched morning does not reset it).
export function streak(daily: DailyPoint[]): number {
  let i = daily.length - 1;
  if (i >= 0 && daily[i].minutes === 0) i--;
  let n = 0;
  for (; i >= 0 && daily[i].minutes > 0; i--) n++;
  return n;
}

export function risk(remainingMinutes: number | null, endsAt: Date | null, now: Date): Risk | null {
  if (remainingMinutes === null || !endsAt) return null;
  if (remainingMinutes <= 0) return "ok";
  const left = (endsAt.getTime() - now.getTime()) / MIN;
  if (left < remainingMinutes) return "impossible";
  // Nobody watches around the clock: under 3x headroom the deadline needs attention.
  if (left < remainingMinutes * 3) return "tight";
  return "ok";
}

export function summarizeCampaigns(items: StatItem[], now: Date): CampaignSummary[] {
  const groups = new Map<string, StatItem[]>();
  for (const i of items) {
    const k = `${i.accountId}|${campaignKey(i)}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups.values()].map((list) => {
    const first = list[0];
    const open = list.filter(isOpen);
    const watchBased = open.filter((i) => i.requiredMinutes && !isReady(i));
    const unknown = watchBased.some((i) => i.minutesWatched === null || i.status === "unknown");
    const remaining = watchBased.map((i) => ({ name: i.name, imageUrl: i.imageUrl, remainingMinutes: Math.max(0, i.requiredMinutes! - (i.minutesWatched ?? 0)) }));
    const remainingMinutes = unknown ? null : Math.max(0, ...remaining.map((r) => r.remainingMinutes));
    const ends = open.map((i) => i.endsAt).filter((d): d is Date => !!d);
    const endsAt = ends.length ? new Date(Math.min(...ends.map((d) => d.getTime()))) : (first.endsAt ?? null);
    return {
      accountId: first.accountId,
      key: campaignKey(first),
      campaignExternalId: first.campaignExternalId,
      campaignName: first.campaignName ?? first.name,
      gameName: first.gameName,
      imageUrl: list.find((i) => i.imageUrl)?.imageUrl ?? null,
      endsAt,
      drops: list.length,
      claimed: list.filter((i) => i.status === "claimed").length,
      ready: list.filter(isReady).length,
      pending: watchBased.length,
      started: list.some((i) => i.status === "claimed" || (i.minutesWatched ?? 0) > 0),
      remainingMinutes,
      next: unknown ? null : (remaining.sort((a, b) => a.remainingMinutes - b.remainingMinutes)[0] ?? null),
      subDrops: open
        .filter((i) => !i.requiredMinutes && i.requiredSubs && !isReady(i))
        .map((i) => ({ name: i.name, imageUrl: i.imageUrl, subs: i.subsCurrent ?? 0, requiredSubs: i.requiredSubs! })),
      needsLink: open.length > 0 && list.some((i) => i.accountConnected === false),
      accountLinkUrl: first.accountLinkUrl,
      risk: open.length ? risk(remainingMinutes, endsAt, now) : null,
    };
  });
}

// A campaign the worker gave up on (`no_progress`) is hidden for a while only: Twitch may count views again later.
// User skips never expire.
export const NO_PROGRESS_COOLDOWN_MS = 3 * 60 * MIN;
export function skipActive(s: { reason: "user" | "no_progress"; createdAt: Date }, now: Date): boolean {
  return s.reason === "user" || now.getTime() - s.createdAt.getTime() < NO_PROGRESS_COOLDOWN_MS;
}
export function skipRetryAt(s: { reason: "user" | "no_progress"; createdAt: Date }): Date | null {
  return s.reason === "no_progress" ? new Date(s.createdAt.getTime() + NO_PROGRESS_COOLDOWN_MS) : null;
}

// What to do now, per account: claim finished drops, watch the most urgent feasible campaign, then link game accounts
// (a campaign without a linked account awards nothing, so it is not worth watching until linked).
// `live` should hold recently seen channels only; stale ones may be offline. `skipped` holds campaign keys the user hid.
export function plan(items: StatItem[], live: LiveChannel[], now: Date, skipped: ReadonlySet<string> = new Set()): PlanItem[] {
  const channels = new Map<string, LiveChannel[]>();
  for (const l of live) channels.set(l.campaignExternalId, [...(channels.get(l.campaignExternalId) ?? []), l]);
  const active = items.filter((i) => !i.endsAt || i.endsAt.getTime() > now.getTime());
  const rank = { claim: 0, watch: 1, link: 2 };

  const out: { item: PlanItem; slack: number }[] = [];
  for (const c of summarizeCampaigns(active, now)) {
    if (skipped.has(c.key)) continue;
    const action = c.ready > 0 ? "claim" : c.pending === 0 ? null : c.needsLink ? "link" : "watch";
    if (!action) continue;
    const left = c.endsAt ? (c.endsAt.getTime() - now.getTime()) / MIN : Infinity;
    const live = (c.campaignExternalId ? (channels.get(c.campaignExternalId) ?? []) : [])
      .sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))
      .slice(0, 3)
      .map((l) => ({ login: l.login, displayName: l.displayName, viewers: l.viewers, title: l.title, avatarUrl: l.avatarUrl }));
    out.push({ item: { ...c, action, channels: live }, slack: c.risk === "impossible" ? Infinity : left - (c.remainingMinutes ?? 0) });
  }
  return out
    .sort(
      (a, b) =>
        rank[a.item.action] - rank[b.item.action] ||
        a.slack - b.slack ||
        (a.item.remainingMinutes ?? 1e9) - (b.item.remainingMinutes ?? 1e9),
    )
    .map((x) => x.item);
}

export const NO_GAME = "Без игры (награды каналов)";

export type GameStat = { game: string; drops: number; claimed: number; inProgress: number; watched: number; remaining: number };

export function byGame(items: StatItem[], now: Date): GameStat[] {
  const out = new Map<string, GameStat>();
  const watchedByCampaign = new Map<string, { game: string; watched: number }>();
  for (const i of items) {
    const game = i.gameName ?? NO_GAME;
    const g = out.get(game) ?? { game, drops: 0, claimed: 0, inProgress: 0, watched: 0, remaining: 0 };
    g.drops++;
    if (i.status === "claimed") g.claimed++;
    if (i.status === "in_progress") g.inProgress++;
    out.set(game, g);
    const k = `${i.accountId}|${campaignKey(i)}`;
    const w = watchedByCampaign.get(k);
    const m = i.minutesWatched ?? 0;
    if (!w || m > w.watched) watchedByCampaign.set(k, { game, watched: m });
  }
  for (const w of watchedByCampaign.values()) out.get(w.game)!.watched += w.watched;
  for (const c of summarizeCampaigns(items, now)) {
    if (c.risk !== null && c.remainingMinutes) out.get(c.gameName ?? NO_GAME)!.remaining += c.remainingMinutes;
  }
  return [...out.values()].sort((a, b) => b.watched - a.watched || b.drops - a.drops || a.game.localeCompare(b.game));
}

export type SyncHealth = { runs: number; ok: number; failed: number; okRate: number | null; avgSeconds: number | null; lastError: { code: string; at: Date } | null };

// Connect/disconnect events are logged in sync_runs too; they are not syncs.
const EVENT_CODES = new Set(["account_connected", "account_revoked"]);

export function syncHealth(runs: SyncRunRow[]): SyncHealth {
  const real = runs.filter((r) => !(r.errorCode && EVENT_CODES.has(r.errorCode)) && r.finishedAt);
  const ok = real.filter((r) => r.status === "ok");
  const failed = real.filter((r) => r.status === "failed");
  const durations = ok.map((r) => (r.finishedAt!.getTime() - r.startedAt.getTime()) / 1000);
  const last = failed.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  return {
    runs: real.length,
    ok: ok.length,
    failed: failed.length,
    okRate: real.length ? ok.length / real.length : null,
    avgSeconds: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    lastError: last ? { code: last.errorCode ?? "unknown", at: last.startedAt } : null,
  };
}

export function totals(items: StatItem[], now: Date) {
  const count = (s: ProgressStatus) => items.filter((i) => i.status === s).length;
  const campaigns = summarizeCampaigns(
    items.filter((i) => !i.endsAt || i.endsAt.getTime() > now.getTime()),
    now,
  );
  const known = items.filter((i) => i.status !== "unknown").length;
  return {
    drops: items.length,
    claimed: count("claimed"),
    inProgress: count("in_progress"),
    notStarted: count("not_started"),
    expired: count("expired"),
    unknown: count("unknown"),
    ready: items.filter(isReady).length,
    activeCampaigns: new Set(campaigns.map((c) => c.key)).size,
    remainingMinutes: campaigns.reduce((s, c) => s + (c.risk !== null && c.risk !== "impossible" ? (c.remainingMinutes ?? 0) : 0), 0),
    atRisk: campaigns.filter((c) => c.started && (c.risk === "impossible" || c.risk === "tight")).length,
    // Same rule as the plan's "link" action.
    needsLink: campaigns.filter((c) => c.needsLink && c.ready === 0 && c.pending > 0).length,
    completion: known ? count("claimed") / known : null,
  };
}
