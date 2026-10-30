import { describe, expect, it } from "vitest";
import real from "./__fixtures__/drops-sources.real.json";
import synthetic from "./__fixtures__/drops-sources.synthetic.json";
import {
  allowedLive,
  channelCampaigns,
  channelsQuery,
  claimId,
  computeStatus,
  earned,
  externalLink,
  type GqlCampaign,
  type InventoryData,
  liveChannels,
  parseDrops,
  pickChannels,
  streamsQuery,
} from "./drops";
import { historyEntry } from "./sync";

// Synthetic: hand-made edge cases. Real: `npm run drops:dump` output from 2026-10-30 (public campaigns + own progress).
const inventory = synthetic.inventory as InventoryData;
const campaigns = synthetic.campaigns as GqlCampaign[];
const now = new Date("2026-10-30T12:00:00Z");

describe("parseDrops (synthetic)", () => {
  const { drops, progress } = parseDrops(inventory, campaigns, now);
  const byId = (id: string) => progress.find((p) => p.externalId === id);

  it("takes progress from inventory", () => {
    expect(byId("drop-1")).toEqual({ externalId: "drop-1", status: "claimed", minutesWatched: 60, subsCurrent: null, accountConnected: null });
    expect(byId("drop-2")).toEqual({ externalId: "drop-2", status: "in_progress", minutesWatched: 43, subsCurrent: null, accountConnected: null });
  });

  it("marks untouched campaign drops as not started", () => {
    expect(byId("drop-untouched")).toEqual({ externalId: "drop-untouched", status: "not_started", minutesWatched: 0, subsCurrent: null, accountConnected: null });
  });

  it("detects claimed badges via awarded game event drops and classifies them", () => {
    expect(byId("drop-badge")?.status).toBe("claimed");
    expect(drops.find((d) => d.externalId === "drop-badge")).toMatchObject({ kind: "badge", name: "Cool Badge", gameName: "Game B" });
  });

  it("normalizes drop rows", () => {
    expect(drops.find((d) => d.externalId === "drop-2")).toEqual({
      externalId: "drop-2",
      kind: "drop",
      name: "Armor",
      campaignName: "Season Drops",
      campaignExternalId: "camp-active",
      accountLinkUrl: null,
      gameName: "Game A",
      imageUrl: "https://example.test/camp.png",
      startsAt: new Date("2026-10-20T00:00:00Z"),
      endsAt: new Date("2026-11-10T00:00:00Z"),
      requiredMinutes: 120,
      requiredSubs: null,
    });
    expect(new Set(drops.map((d) => d.externalId)).size).toBe(drops.length);
  });

  it("marks drops without own progress unknown when inventory is missing", () => {
    const result = parseDrops({ currentUser: { inventory: null } }, campaigns, now);
    expect(result.progress.find((p) => p.externalId === "drop-untouched")?.status).toBe("unknown");
    expect(result.progress.every((p) => p.status !== "claimed")).toBe(true);
  });

  it("throws when there is no current user", () => {
    expect(() => parseDrops({ currentUser: null }, campaigns, now)).toThrow();
  });
});

describe("parseDrops (real dump)", () => {
  const { drops, progress } = parseDrops(real.inventory as InventoryData, real.campaigns as GqlCampaign[], now);

  it("dedupes campaigns seen on several channels", () => {
    const unique = new Set(real.campaigns.flatMap((c) => (c.timeBasedDrops ?? []).map((d) => d.id)));
    expect(drops.length).toBe(unique.size);
    expect(progress.length).toBe(drops.length);
  });

  it("reads own progress for every drop and classifies badges", () => {
    expect(progress.every((p) => p.status !== "unknown")).toBe(true);
    expect(drops.some((d) => d.kind === "badge")).toBe(true);
    expect(drops.every((d) => d.endsAt && d.campaignName)).toBe(true);
    expect(drops.some((d) => d.gameName === null)).toBe(true); // channel-specific campaigns have no game
  });
});

describe("computeStatus", () => {
  const base = { claimedByEvent: false, inventoryLoaded: true, endsAt: new Date("2026-11-01T00:00:00Z"), now };

  it("never reports claimed without evidence", () => {
    expect(computeStatus({ ...base, self: null, inventoryLoaded: false }).status).toBe("unknown");
    expect(computeStatus({ ...base, self: { isClaimed: false, currentMinutesWatched: null } }).status).toBe("unknown");
    expect(computeStatus({ ...base, self: { currentMinutesWatched: 10 } }).status).toBe("in_progress");
  });

  it("expires unclaimed drops after the end date", () => {
    const ended = { ...base, endsAt: new Date("2026-10-29T00:00:00Z") };
    expect(computeStatus({ ...ended, self: { isClaimed: false, currentMinutesWatched: 30 } })).toEqual({ status: "expired", minutesWatched: 30 });
    expect(computeStatus({ ...ended, self: null }).status).toBe("expired");
    expect(computeStatus({ ...ended, self: { isClaimed: true, currentMinutesWatched: 60 } }).status).toBe("claimed");
  });
});

describe("discovery queries", () => {
  it("pages streams with an escaped cursor", () => {
    expect(streamsQuery()).toContain("first: 30, options");
    expect(streamsQuery('a"b')).toContain('after: "a\\"b"');
  });

  it("aliases channels and escapes ids", () => {
    const q = channelsQuery(["1", '2"3']);
    expect(q).toContain('c0: channel(id: "1")');
    expect(q).toContain('c1: channel(id: "2\\"3")');
  });

  it("picks a few unique channels per game", () => {
    const edge = (channel: string, game: string) => ({ node: { broadcaster: { id: channel }, game: { id: game } } });
    const edges = [edge("1", "a"), edge("2", "a"), edge("3", "a"), edge("1", "b"), edge("4", "b"), { node: null }];
    expect(pickChannels(edges)).toEqual(["1", "2", "4"]);
  });

  it("flattens channel campaigns, skipping offline channels", () => {
    expect(channelCampaigns({ c0: { viewerDropCampaigns: [{ id: "x" }] }, c1: null, c2: { viewerDropCampaigns: null } })).toEqual([{ id: "x" }]);
  });
});

describe("allowedLive", () => {
  const stream = (id: string, game: string, viewers: number) => ({
    node: { title: "t", viewersCount: viewers, broadcaster: { id, login: `l${id}`, displayName: `L${id}`, profileImageURL: null }, game: { id: game } },
  });
  const edges = [stream("1", "g1", 10), stream("2", "g1", 300), stream("3", "g2", 5), stream("4", "g1", 50)];

  it("gives an open campaign the top streams of its game", () => {
    const rows = allowedLive([{ id: "open", game: { id: "g1" }, allow: { isEnabled: false, channels: null } }], edges, 2);
    expect(rows.map((r) => r.login)).toEqual(["l2", "l4"]);
    expect(rows.every((r) => r.campaignExternalId === "open")).toBe(true);
  });

  it("gives an allow-listed campaign only its live listed channels", () => {
    const rows = allowedLive([{ id: "r", game: { id: "g1" }, allow: { isEnabled: true, channels: [{ id: "3" }, { id: "99" }, { id: "1" }] } }], edges);
    expect(rows.map((r) => r.login)).toEqual(["l1", "l3"]);
  });

  it("skips campaigns without game or allow info", () => {
    expect(allowedLive([{ id: "a", allow: { isEnabled: false } }, { id: "b", game: { id: "g1" } }], edges)).toEqual([]);
  });
});

describe("live channels and rewards", () => {
  it("maps channel aliases back to campaigns with stream info", () => {
    const edges = [
      { node: { title: "t", viewersCount: 50, broadcaster: { id: "1", login: "one", displayName: "One", profileImageURL: "a.png" }, game: { id: "g" } } },
      { node: { broadcaster: { id: "2", login: null }, game: { id: "g" } } },
    ];
    const rows = liveChannels(edges, ["1", "2", "3"], {
      c0: { viewerDropCampaigns: [{ id: "camp" }, { id: "camp" }, { id: "other" }] },
      c1: { viewerDropCampaigns: [{ id: "camp" }] },
      c2: null,
    });
    expect(rows).toEqual([
      { campaignExternalId: "camp", channelId: "1", login: "one", displayName: "One", title: "t", viewers: 50, avatarUrl: "a.png" },
      { campaignExternalId: "other", channelId: "1", login: "one", displayName: "One", title: "t", viewers: 50, avatarUrl: "a.png" },
    ]);
  });

  it("reads awarded rewards and campaign link state from the real dump", () => {
    const { rewards, drops, progress } = parseDrops(real.inventory as InventoryData, real.campaigns as GqlCampaign[], now);
    expect(rewards.length).toBe(real.inventory.currentUser.inventory.gameEventDrops.length);
    expect(rewards.every((r) => r.awardedAt instanceof Date && r.name)).toBe(true);
    expect(drops.every((d) => d.campaignExternalId)).toBe(true);
    expect(progress.every((p) => p.accountConnected === null || typeof p.accountConnected === "boolean")).toBe(true);
  });

  it("ignores the twitch.tv placeholder link and non-http links", () => {
    expect(externalLink("https://www.twitch.tv/")).toBeNull();
    expect(externalLink("javascript:alert(1)")).toBeNull();
    expect(externalLink("https://account.game.test/link")).toBe("https://account.game.test/link");
    expect(externalLink("https://www.twitch.tv/drops/link")).toBe("https://www.twitch.tv/drops/link");
  });

  it("marks drops whose game account is not linked", () => {
    const c = { ...campaigns.find((x) => x.timeBasedDrops?.length)!, self: { isAccountConnected: false }, accountLinkURL: "https://link.test/" } as GqlCampaign;
    const result = parseDrops({ currentUser: { inventory: null } }, [c], now);
    const link = "https://link.test/";
    expect(result.drops.filter((d) => d.kind === "drop").every((d) => d.accountLinkUrl === link)).toBe(true);
    for (const d of result.drops) {
      expect(result.progress.find((p) => p.externalId === d.externalId)?.accountConnected).toBe(d.kind === "drop" ? false : null);
    }
  });
});

describe("claimable drops", () => {
  const drop = (id: string, minutes: number, extra: object = {}) => ({
    id,
    requiredMinutesWatched: 60,
    self: { currentMinutesWatched: minutes, isClaimed: false, dropInstanceID: null },
    benefitEdges: [{ benefit: { id: `b-${id}`, name: id, distributionType: "DIRECT_ENTITLEMENT" } }],
    ...extra,
  });
  const campaign = (over: Partial<GqlCampaign> = {}): GqlCampaign => ({
    id: "camp",
    endAt: "2026-11-01T00:00:00Z",
    timeBasedDrops: [
      drop("done", 60, { self: { currentMinutesWatched: 60, isClaimed: false, dropInstanceID: "u#camp#done" } }),
      drop("built", 75),
      drop("half", 30),
      drop("taken", 60, { self: { currentMinutesWatched: 60, isClaimed: true } }),
    ],
    ...over,
  });
  const parse = (c: GqlCampaign, at = now) => parseDrops({ currentUser: { inventory: { dropCampaignsInProgress: [] } } }, [c], at).claimable;

  it("lists watched-out unclaimed drops with their claim id", () => {
    const out = parse(campaign());
    expect(out.map((c) => c.externalId)).toEqual(["done", "built"]);
    expect(claimId(out[0], "u")).toBe("u#camp#done");
    expect(claimId(out[1], "42")).toBe("42#camp#built");
  });

  it("allows a day after the campaign end, then stops", () => {
    expect(parse(campaign(), new Date("2026-11-01T12:00:00Z"))).toHaveLength(2);
    expect(parse(campaign(), new Date("2026-11-02T01:00:00Z"))).toHaveLength(0);
  });

  it("skips drops whose game account is not linked", () => {
    expect(parse(campaign({ accountLinkURL: "https://link.test/", self: { isAccountConnected: false } }))).toHaveLength(0);
  });

  // Shape seen live on 2026-10-30: "GTA IV Melissa 1" asks for 1 sub and no watch time.
  const sub = (id: string, subs: number) =>
    drop(id, 0, { requiredMinutesWatched: 0, requiredSubs: 1, self: { currentMinutesWatched: 0, currentSubs: subs, isClaimed: false } });

  it("judges sub drops by subs, not by watch time", () => {
    const result = parseDrops({ currentUser: { inventory: { dropCampaignsInProgress: [] } } }, [campaign({ timeBasedDrops: [sub("nosub", 0), sub("subbed", 1)] })], now);
    expect(result.drops.map((d) => d.requiredSubs)).toEqual([1, 1]);
    expect(result.progress.map((p) => [p.status, p.subsCurrent])).toEqual([["not_started", 0], ["in_progress", 1]]);
    expect(result.claimable.map((c) => c.externalId)).toEqual(["subbed"]);
  });
});

describe("earned", () => {
  it("needs whatever the drop asks for", () => {
    expect(earned(60, 60, null, 0)).toBe(true);
    expect(earned(59, 60, null, null)).toBe(false);
    expect(earned(0, 0, 1, 1)).toBe(true);
    expect(earned(500, 0, 0, 1)).toBe(false);
    expect(earned(0, 0, 0, 0)).toBe(false);
  });
});

describe("historyEntry", () => {
  it("records changes with gained minutes and skips the unchanged", () => {
    expect(historyEntry(undefined, { minutesWatched: 0, status: "not_started" })).toBeNull();
    expect(historyEntry(undefined, { minutesWatched: 40, status: "in_progress" })).toEqual({ delta: 0 });
    expect(historyEntry({ minutesWatched: 40, status: "in_progress" }, { minutesWatched: 40, status: "in_progress" })).toBeNull();
    expect(historyEntry({ minutesWatched: 40, status: "in_progress" }, { minutesWatched: 55, status: "in_progress" })).toEqual({ delta: 15 });
    expect(historyEntry({ minutesWatched: 55, status: "in_progress" }, { minutesWatched: 0, status: "not_started" })).toEqual({ delta: 0 });
    expect(historyEntry({ minutesWatched: null, status: "unknown" }, { minutesWatched: 10, status: "in_progress" })).toEqual({ delta: 0 });
  });
});
