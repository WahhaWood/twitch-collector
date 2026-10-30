import type { AccountStatus, ProgressStatus } from "./format";

export type Account = {
  id: number;
  login: string;
  displayName: string;
  status: AccountStatus;
  lastSyncedAt: string | null;
  autoWatch: boolean;
  watching: WatchTarget[] | null;
  watchingAt: string | null;
};

export type WatchTarget = { kind: "drop" | "streak"; login: string; displayName: string; campaignName?: string | null };

// The worker writes `watchingAt` every tick; older than this means it is not running.
export const WORKER_STALE_MS = 2 * 60_000;

export type StreakChannel = {
  id: number;
  accountId: number;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  live: boolean;
  liveSince: string | null;
  watchedSeconds: number;
  checkedAt: string | null;
};
export type StreaksResponse = {
  goalSeconds: number;
  accounts: { id: number; displayName: string; status: AccountStatus; watchingAt: string | null }[];
  channels: StreakChannel[];
};

export type ProgressItem = {
  campaignId: number;
  kind: "drop" | "badge";
  name: string;
  campaignName: string | null;
  gameName: string | null;
  imageUrl: string | null;
  endsAt: string | null;
  requiredMinutes: number | null;
  requiredSubs: number | null;
  minutesWatched: number | null;
  subsCurrent: number | null;
  status: ProgressStatus;
  source: "twitch" | "manual";
  fetchedAt: string;
  campaignExternalId?: string | null;
  accountLinkUrl?: string | null;
  accountConnected?: boolean | null;
};

export type LiveChannel = { login: string; displayName: string; viewers: number | null; title: string | null; avatarUrl: string | null };
export type Reward = { name: string; imageUrl: string | null; awardedAt: string; accountName?: string };

export type ProgressResponse = {
  account: Account;
  items: ProgressItem[];
  live: Record<string, LiveChannel[]>;
  rewards: Reward[];
};

export type Risk = "ok" | "tight" | "impossible";
export type CampaignSummary = {
  accountId: number;
  key: string;
  campaignExternalId: string | null;
  campaignName: string;
  gameName: string | null;
  imageUrl: string | null;
  endsAt: string | null;
  drops: number;
  claimed: number;
  ready: number;
  pending: number;
  started: boolean;
  remainingMinutes: number | null;
  next: { name: string; imageUrl: string | null; remainingMinutes: number } | null;
  subDrops: { name: string; imageUrl: string | null; subs: number; requiredSubs: number }[];
  needsLink: boolean;
  accountLinkUrl: string | null;
  risk: Risk | null;
};
export type PlanItem = CampaignSummary & { action: "claim" | "link" | "watch"; channels: LiveChannel[] };
export type PlanResponse = { accounts: { id: number; displayName: string; items: PlanItem[]; skipped: { key: string; campaignName: string; reason: "user" | "no_progress" }[] }[] };

export type StatsResponse = {
  days: number;
  tz: string;
  totals: {
    drops: number;
    claimed: number;
    inProgress: number;
    notStarted: number;
    expired: number;
    unknown: number;
    ready: number;
    activeCampaigns: number;
    remainingMinutes: number;
    atRisk: number;
    needsLink: number;
    completion: number | null;
    accounts: number;
    watchedMinutes: number;
    rewardsInRange: number;
    rewardsAllTime: number;
    streak: number;
  };
  daily: { day: string; minutes: number; rewards: number }[];
  byGame: { game: string; drops: number; claimed: number; inProgress: number; watched: number; remaining: number }[];
  byAccount: {
    id: number;
    displayName: string;
    status: AccountStatus;
    lastSyncedAt: string | null;
    claimed: number;
    inProgress: number;
    ready: number;
    remainingMinutes: number;
    watchedMinutes: number;
    rewards: number;
  }[];
  risks: (CampaignSummary & { accountName: string })[];
  sync: { runs: number; ok: number; failed: number; okRate: number | null; avgSeconds: number | null; lastError: { code: string; at: string } | null };
  recentRewards: (Reward & { accountId: number; accountName: string })[];
};

export type AdminUser = { id: number; name: string; isAdmin: boolean; createdAt: string; accounts: number; lastSyncedAt: string | null };

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export type CatalogItem = {
  id: number;
  kind: "drop" | "badge";
  name: string;
  campaignName: string | null;
  gameName: string | null;
  imageUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  requiredMinutes: number | null;
  requiredSubs: number | null;
  lastSeenAt: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Full reload on a dead session so the server renders the login form.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.status === 401 && window.location.pathname !== "/") window.location.assign("/");
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? "Request failed");
  }
  return body as T;
}

export const fetcher = <T>(url: string) => api<T>(url);

export const POLL_MS = 60_000;
