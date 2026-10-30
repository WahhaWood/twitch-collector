import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// What the watch worker is on right now, for the UI.
export type WatchTarget = { kind: "drop" | "streak"; login: string; displayName: string; campaignName?: string | null; reward?: string | null; avatarUrl?: string | null };

// Why the worker is (not) watching, in words for the UI. `retryAt` is set while an account backs off after errors.
export type WorkerStatus = {
  state: "watching" | "idle" | "error";
  reason: "no_campaigns" | "no_live" | "waiting_streamers" | "error" | "ok";
  retryAt?: string | null;
  detail?: string | null;
};

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const twitchAccounts = pgTable("twitch_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  twitchUserId: text("twitch_user_id").notNull().unique(),
  login: text("login").notNull(),
  displayName: text("display_name").notNull(),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  status: text("status", { enum: ["pending", "active", "expired", "revoked", "error"] }).notNull().default("pending"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  // Watch worker: farm drops on this account; `watching` is refreshed every tick, stale `watchingAt` = worker is down.
  autoWatch: boolean("auto_watch").notNull().default(false),
  watching: jsonb("watching").$type<WatchTarget[]>(),
  watchingAt: timestamp("watching_at", { withTimezone: true }),
  workerStatus: jsonb("worker_status").$type<WorkerStatus>(),
});

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  kind: text("kind", { enum: ["drop", "badge"] }).notNull(),
  externalId: text("external_id").notNull().unique(),
  name: text("name").notNull(),
  campaignName: text("campaign_name"),
  // Twitch campaign id: drops of one campaign progress together while watching.
  campaignExternalId: text("campaign_external_id"),
  accountLinkUrl: text("account_link_url"),
  gameName: text("game_name"),
  imageUrl: text("image_url"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  requiredMinutes: integer("required_minutes"),
  // Subscriptions (own or gifted) on the campaign's channels that earn the drop instead of watch time.
  requiredSubs: integer("required_subs"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const progress = pgTable(
  "progress",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => twitchAccounts.id, { onDelete: "cascade" }),
    campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    minutesWatched: integer("minutes_watched"),
    subsCurrent: integer("subs_current"),
    status: text("status", { enum: ["not_started", "in_progress", "claimed", "expired", "unknown"] }).notNull().default("unknown"),
    source: text("source", { enum: ["twitch", "manual"] }).notNull(),
    // null = Twitch did not say; false means the game account must be linked or the drop is never awarded.
    accountConnected: boolean("account_connected"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("progress_account_campaign").on(t.accountId, t.campaignId)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => twitchAccounts.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status", { enum: ["ok", "partial", "failed"] }),
    errorCode: text("error_code"),
    errorSummary: text("error_summary"),
  },
  (t) => [index("sync_runs_started_at").on(t.startedAt)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    ip: text("ip").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_at").on(t.ip, t.at)],
);

// One row per observed change of a progress row; `delta` is watched minutes gained since the previous sync.
export const progressHistory = pgTable(
  "progress_history",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => twitchAccounts.id, { onDelete: "cascade" }),
    campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    minutesWatched: integer("minutes_watched"),
    delta: integer("delta").notNull().default(0),
    status: text("status", { enum: ["not_started", "in_progress", "claimed", "expired", "unknown"] }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("progress_history_account_at").on(t.accountId, t.at)],
);

// Rewards Twitch reports as awarded (inventory.gameEventDrops), including ones from before the account was connected.
export const rewards = pgTable(
  "rewards",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => twitchAccounts.id, { onDelete: "cascade" }),
    benefitId: text("benefit_id").notNull(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("rewards_account_benefit").on(t.accountId, t.benefitId), index("rewards_awarded_at").on(t.awardedAt)],
);

// Live drops-enabled channels seen during sync, per Twitch campaign: "where to watch".
export const liveChannels = pgTable(
  "live_channels",
  {
    campaignExternalId: text("campaign_external_id").notNull(),
    channelId: text("channel_id").notNull(),
    login: text("login").notNull(),
    displayName: text("display_name").notNull(),
    title: text("title"),
    viewers: integer("viewers"),
    avatarUrl: text("avatar_url"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignExternalId, t.channelId] }), index("live_channels_seen_at").on(t.seenAt)],
);

// Streamers whose watch streak the worker keeps up: it watches each broadcast until `watchedSeconds` reaches the goal.
export const streakChannels = pgTable(
  "streak_channels",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => twitchAccounts.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    login: text("login").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    // Current or last seen broadcast; watchedSeconds counts for this broadcast only.
    broadcastId: text("broadcast_id"),
    liveSince: timestamp("live_since", { withTimezone: true }),
    live: boolean("live").notNull().default(false),
    watchedSeconds: integer("watched_seconds").notNull().default(0),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("streak_channels_account_channel").on(t.accountId, t.channelId)],
);

// Campaigns skipped on the overview (e.g. a deadline that cannot be met); hidden from the plan and the worker.
// `no_progress`: the worker watched it and Twitch did not count a minute, so watching it is wasted time.
export const skippedCampaigns = pgTable(
  "skipped_campaigns",
  {
    accountId: integer("account_id").notNull().references(() => twitchAccounts.id, { onDelete: "cascade" }),
    // stats.campaignKey(): Twitch campaign id, or `name:<campaign name>` when it is unknown.
    campaignKey: text("campaign_key").notNull(),
    campaignName: text("campaign_name").notNull(),
    reason: text("reason", { enum: ["user", "no_progress"] }).notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.campaignKey] })],
);
