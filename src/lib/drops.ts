// Unofficial Twitch GQL adapter for drops: queries, defensive parsing and status rules.
// The schema can change without notice; anything we cannot read becomes `unknown`, never `claimed`.

export type CampaignKind = "drop" | "badge";
export type ProgressStatus = "not_started" | "in_progress" | "claimed" | "expired" | "unknown";

export type DropRow = {
  externalId: string;
  kind: CampaignKind;
  name: string;
  campaignName: string | null;
  campaignExternalId: string | null;
  accountLinkUrl: string | null;
  gameName: string | null;
  imageUrl: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  requiredMinutes: number | null;
  // >0: earned by subscribing or gifting a sub on a campaign channel, not by watching.
  requiredSubs: number | null;
};
export type ProgressRow = {
  externalId: string;
  minutesWatched: number | null;
  subsCurrent: number | null;
  status: ProgressStatus;
  accountConnected: boolean | null;
};
export type RewardRow = { benefitId: string; name: string; imageUrl: string | null; awardedAt: Date };
export type LiveChannelRow = {
  campaignExternalId: string;
  channelId: string;
  login: string;
  displayName: string;
  title: string | null;
  viewers: number | null;
  avatarUrl: string | null;
};
// A watched-out drop that is not claimed yet. `instanceId` is null when Twitch did not send one (see claimId).
export type Claimable = { externalId: string; campaignExternalId: string; instanceId: string | null };
export type ParsedDrops = { drops: DropRow[]; progress: ProgressRow[]; rewards: RewardRow[]; claimable: Claimable[] };

type GqlSelf = { currentMinutesWatched?: number | null; currentSubs?: number | null; isClaimed?: boolean | null; dropInstanceID?: string | null } | null;
type GqlBenefit = { id?: string; name?: string | null; imageAssetURL?: string | null; distributionType?: string | null };
type GqlDrop = {
  id: string;
  name?: string | null;
  requiredMinutesWatched?: number | null;
  requiredSubs?: number | null;
  startAt?: string | null;
  endAt?: string | null;
  self?: GqlSelf;
  benefitEdges?: { benefit?: GqlBenefit | null }[] | null;
};
export type GqlCampaign = {
  id: string;
  name?: string | null;
  status?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  imageURL?: string | null;
  accountLinkURL?: string | null;
  self?: { isAccountConnected?: boolean | null } | null;
  game?: { displayName?: string | null } | null;
  timeBasedDrops?: GqlDrop[] | null;
};
type GqlEventDrop = { id?: string; name?: string | null; imageURL?: string | null; lastAwardedAt?: string | null };

export type InventoryData = {
  currentUser: {
    inventory?: { dropCampaignsInProgress?: GqlCampaign[] | null; gameEventDrops?: GqlEventDrop[] | null } | null;
  } | null;
};
export type StreamEdge = {
  cursor?: string | null;
  node?: {
    title?: string | null;
    viewersCount?: number | null;
    broadcaster?: { id?: string; login?: string | null; displayName?: string | null; profileImageURL?: string | null } | null;
    game?: { id?: string } | null;
  } | null;
};
export type StreamsData = { streams: { edges?: StreamEdge[] | null; pageInfo?: { hasNextPage?: boolean } | null } | null };
export type ChannelsData = Record<string, { viewerDropCampaigns?: GqlCampaign[] | null } | null>;

const DROP_FIELDS = `id name requiredMinutesWatched requiredSubs startAt endAt
  self { currentMinutesWatched currentSubs isClaimed dropInstanceID }
  benefitEdges { benefit { id name imageAssetURL distributionType } }`;
const CAMPAIGN_FIELDS = `id name status startAt endAt imageURL accountLinkURL self { isAccountConnected } game { displayName }`;

// Since 2026-09 Twitch gates currentUser.dropCampaigns (dashboard) and dropCampaign(id) behind client
// integrity: they come back null. Campaigns are discovered through live drops-enabled streams instead,
// whose channel.viewerDropCampaigns still carries the viewer's own progress in `self`.
export const INVENTORY_QUERY = `query {
  currentUser {
    inventory {
      dropCampaignsInProgress { ${CAMPAIGN_FIELDS} timeBasedDrops { ${DROP_FIELDS} } }
      gameEventDrops { id name imageURL lastAwardedAt }
    }
  }
}`;

export const STREAMS_PAGE = 30; // GQL rejects larger pages
export const CHANNELS_PER_QUERY = 15; // GQL root alias limit

export function streamsQuery(after?: string): string {
  const cursor = after ? `, after: ${JSON.stringify(after)}` : "";
  return `query { streams(first: ${STREAMS_PAGE}${cursor}, options: { systemFilters: [DROPS_ENABLED] }) {
    edges { cursor node { title viewersCount broadcaster { id login displayName profileImageURL(width: 70) } game { id } } }
    pageInfo { hasNextPage } } }`;
}

export function channelsQuery(ids: string[]): string {
  const fields = ids.map((id, i) => `c${i}: channel(id: ${JSON.stringify(id)}) { viewerDropCampaigns { ${CAMPAIGN_FIELDS} timeBasedDrops { ${DROP_FIELDS} } } }`);
  return `query { ${fields.join("\n")} }`;
}

// A few channels per game: campaigns limited to specific channels show up only there.
export function pickChannels(edges: StreamEdge[], perGame = 2): string[] {
  const perGameCount = new Map<string, number>();
  const picked: string[] = [];
  for (const e of edges) {
    const channel = e.node?.broadcaster?.id;
    const game = e.node?.game?.id ?? "";
    const n = perGameCount.get(game) ?? 0;
    if (!channel || n >= perGame || picked.includes(channel)) continue;
    perGameCount.set(game, n + 1);
    picked.push(channel);
  }
  return picked;
}

export function channelCampaigns(data: ChannelsData): GqlCampaign[] {
  return Object.values(data).flatMap((c) => c?.viewerDropCampaigns ?? []);
}

// Which campaigns each queried channel counts towards. `ids` is the list `channelsQuery` was built from (alias cN = ids[N]).
export function liveChannels(edges: StreamEdge[], ids: string[], data: ChannelsData): LiveChannelRow[] {
  const streams = new Map(edges.flatMap((e) => (e.node?.broadcaster?.id ? [[e.node.broadcaster.id, e.node] as const] : [])));
  const rows: LiveChannelRow[] = [];
  ids.forEach((channelId, i) => {
    const stream = streams.get(channelId);
    const login = stream?.broadcaster?.login;
    if (!stream || !login) return;
    const campaignIds = new Set((data[`c${i}`]?.viewerDropCampaigns ?? []).map((c) => c?.id).filter(Boolean) as string[]);
    for (const campaignExternalId of campaignIds) {
      rows.push({
        campaignExternalId,
        channelId,
        login,
        displayName: stream.broadcaster?.displayName || login,
        title: stream.title?.slice(0, 200) ?? null,
        viewers: typeof stream.viewersCount === "number" ? stream.viewersCount : null,
        avatarUrl: stream.broadcaster?.profileImageURL ?? null,
      });
    }
  });
  return rows;
}

export function computeStatus(input: {
  self: GqlSelf | undefined;
  claimedByEvent: boolean;
  inventoryLoaded: boolean;
  endsAt: Date | null;
  now: Date;
}): { status: ProgressStatus; minutesWatched: number | null } {
  const { self, claimedByEvent, inventoryLoaded, endsAt, now } = input;
  const minutes = typeof self?.currentMinutesWatched === "number" ? Math.max(0, self.currentMinutesWatched) : null;
  if (self?.isClaimed === true) return { status: "claimed", minutesWatched: minutes };
  if (self && minutes !== null) {
    if (isPast(endsAt, now)) return { status: "expired", minutesWatched: minutes };
    return { status: minutes > 0 ? "in_progress" : "not_started", minutesWatched: minutes };
  }
  if (claimedByEvent) return { status: "claimed", minutesWatched: null };
  if (self || !inventoryLoaded) return { status: "unknown", minutesWatched: null };
  if (isPast(endsAt, now)) return { status: "expired", minutesWatched: null };
  // Inventory lists every campaign with watched time, so absence there means nothing watched yet.
  return { status: "not_started", minutesWatched: 0 };
}

export function parseDrops(inventoryData: InventoryData, discovered: GqlCampaign[], now = new Date()): ParsedDrops {
  const user = inventoryData.currentUser;
  if (!user) throw new Error("no current user in drops response");

  const inventory = user.inventory;
  const inventoryLoaded = Array.isArray(inventory?.dropCampaignsInProgress);
  const awarded = new Map<string, Date>();
  const rewards: RewardRow[] = [];
  for (const e of inventory?.gameEventDrops ?? []) {
    const at = date(e?.lastAwardedAt);
    if (!e?.id || !at || awarded.has(e.id)) continue;
    awarded.set(e.id, at);
    rewards.push({ benefitId: e.id, name: e.name || e.id, imageUrl: e.imageURL ?? null, awardedAt: at });
  }

  // Inventory first: its `self` is the authoritative progress. Later sources only fill gaps.
  const campaigns = new Map<string, GqlCampaign>();
  const sources = [inventory?.dropCampaignsInProgress ?? [], discovered];
  const selfByDrop = new Map<string, GqlSelf>();
  for (const list of sources) {
    for (const c of list) {
      if (!c?.id) continue;
      const known = campaigns.get(c.id);
      if (!known || (!known.timeBasedDrops?.length && c.timeBasedDrops?.length)) {
        campaigns.set(c.id, { ...known, ...c, timeBasedDrops: c.timeBasedDrops?.length ? c.timeBasedDrops : known?.timeBasedDrops });
      }
      for (const d of c.timeBasedDrops ?? []) {
        if (d?.id && d.self && !selfByDrop.has(d.id)) selfByDrop.set(d.id, d.self);
      }
    }
  }

  const drops: DropRow[] = [];
  const progress: ProgressRow[] = [];
  const claimable: Claimable[] = [];
  const seen = new Set<string>(); // upsert fails if one statement touches the same key twice
  for (const c of campaigns.values()) {
    const campaignStart = date(c.startAt);
    for (const d of c.timeBasedDrops ?? []) {
      if (!d?.id || seen.has(d.id)) continue;
      seen.add(d.id);
      const benefits = (d.benefitEdges ?? []).map((e) => e?.benefit).filter((b): b is GqlBenefit => !!b);
      const endsAt = date(d.endAt) ?? date(c.endAt);
      const startsAt = date(d.startAt) ?? campaignStart;
      const kind = benefits.length > 0 && benefits.every((b) => b.distributionType === "BADGE") ? "badge" : "drop";
      // Badges land on the Twitch account itself; only drops with a real external link need a linked game account.
      const linkUrl = kind === "drop" ? externalLink(c.accountLinkURL) : null;
      drops.push({
        externalId: d.id,
        kind,
        name: benefits.map((b) => b.name).filter(Boolean).join(", ") || d.name || c.name || d.id,
        campaignName: c.name ?? null,
        campaignExternalId: c.id,
        accountLinkUrl: linkUrl,
        gameName: c.game?.displayName ?? null,
        imageUrl: benefits.find((b) => b.imageAssetURL)?.imageAssetURL ?? c.imageURL ?? null,
        startsAt,
        endsAt,
        requiredMinutes: typeof d.requiredMinutesWatched === "number" ? d.requiredMinutesWatched : null,
        requiredSubs: typeof d.requiredSubs === "number" ? d.requiredSubs : null,
      });
      const claimedByEvent =
        benefits.length > 0 &&
        benefits.every((b) => {
          const at = b.id ? awarded.get(b.id) : undefined;
          return !!at && (!startsAt || at >= startsAt);
        });
      const self = selfByDrop.get(d.id);
      const subsCurrent = typeof self?.currentSubs === "number" ? Math.max(0, self.currentSubs) : null;
      const s = computeStatus({ self, claimedByEvent, inventoryLoaded, endsAt, now });
      // A sub drop has no watch time: any counted sub means it is under way.
      if (s.status === "not_started" && d.requiredSubs && subsCurrent) s.status = "in_progress";
      const connected = c.self?.isAccountConnected;
      const accountConnected = linkUrl && typeof connected === "boolean" ? connected : null;
      progress.push({ externalId: d.id, ...s, subsCurrent, accountConnected });
      // An unlinked game account gets nothing from a claim; leave it for the "link" reminder.
      if (accountConnected !== false && canClaim(s, subsCurrent, d, endsAt, now)) {
        claimable.push({ externalId: d.id, campaignExternalId: c.id, instanceId: self?.dropInstanceID || null });
      }
    }
  }
  return { drops, progress, rewards, claimable };
}

const CLAIM_GRACE_MS = 24 * 60 * 60_000; // Twitch accepts claims for a day after the campaign ends

function canClaim(
  s: { status: ProgressStatus; minutesWatched: number | null },
  subs: number | null,
  d: Pick<GqlDrop, "requiredMinutesWatched" | "requiredSubs">,
  endsAt: Date | null,
  now: Date,
) {
  if (s.status !== "in_progress" && s.status !== "expired") return false;
  if (!earned(s.minutesWatched, d.requiredMinutesWatched, subs, d.requiredSubs)) return false;
  return !endsAt || endsAt.getTime() + CLAIM_GRACE_MS > now.getTime();
}

// A drop is earned by watch time or by subs, whichever it asks for; nothing asked means nothing to judge by.
export function earned(minutes: number | null, requiredMinutes: number | null | undefined, subs: number | null, requiredSubs: number | null | undefined) {
  if (!requiredMinutes && !requiredSubs) return false;
  if (requiredMinutes && (minutes === null || minutes < requiredMinutes)) return false;
  if (requiredSubs && (subs === null || subs < requiredSubs)) return false;
  return true;
}

// Twitch leaves dropInstanceID null until the viewer has progress; the id is then built from its parts.
export function claimId(c: Claimable, twitchUserId: string): string {
  return c.instanceId ?? `${twitchUserId}#${c.campaignExternalId}#${c.externalId}`;
}

// Campaigns without a game account to link report twitch.tv itself as the link URL.
export function externalLink(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const url = new URL(v);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (/(^|\.)twitch\.tv$/.test(url.hostname) && (url.pathname === "/" || url.pathname === "")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function date(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isPast(d: Date | null, now: Date) {
  return !!d && d.getTime() <= now.getTime();
}
