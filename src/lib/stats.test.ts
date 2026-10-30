import { describe, expect, it } from "vitest";
import {
  byGame,
  dailySeries,
  dayKey,
  effectiveStatus,
  NO_PROGRESS_COOLDOWN_MS,
  plan,
  risk,
  skipActive,
  skipRetryAt,
  type StatItem,
  streak,
  summarizeCampaigns,
  syncHealth,
  totals,
  validTimeZone,
  watchedPerSync,
} from "./stats";

const now = new Date("2026-10-30T12:00:00Z");
const h = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

function item(over: Partial<StatItem>): StatItem {
  return {
    accountId: 1,
    campaignId: 1,
    campaignExternalId: "camp-a",
    campaignName: "Camp A",
    gameName: "Game A",
    name: "Reward",
    kind: "drop",
    imageUrl: null,
    requiredMinutes: 60,
    requiredSubs: null,
    minutesWatched: 0,
    subsCurrent: null,
    status: "not_started",
    endsAt: h(48),
    accountConnected: null,
    accountLinkUrl: null,
    ...over,
  };
}

describe("time buckets", () => {
  it("splits days at the viewer's midnight", () => {
    const late = new Date("2026-10-30T22:30:00Z");
    expect(dayKey(late, "UTC")).toBe("2026-10-30");
    expect(dayKey(late, "Europe/Moscow")).toBe("2026-10-31");
  });

  it("falls back to UTC for bad zones", () => {
    expect(validTimeZone("Mars/Base")).toBe("UTC");
    expect(validTimeZone(null)).toBe("UTC");
    expect(validTimeZone("Europe/Kyiv")).toBe("Europe/Kyiv");
  });
});

describe("watched minutes", () => {
  it("counts a campaign's drops once and overlapping campaigns once per sync", () => {
    const at = h(-1);
    const points = watchedPerSync([
      { accountId: 1, campaignKey: "a", at, delta: 15 },
      { accountId: 1, campaignKey: "a", at, delta: 15 },
      { accountId: 1, campaignKey: "b", at, delta: 10 },
      { accountId: 2, campaignKey: "a", at, delta: 5 },
      { accountId: 1, campaignKey: "a", at: h(-2), delta: 0 },
    ]);
    expect(points.sort((x, y) => x.accountId - y.accountId).map((p) => p.minutes)).toEqual([15, 5]);
  });

  it("builds a zero-filled daily series and a streak", () => {
    const daily = dailySeries(
      [
        { accountId: 1, campaignKey: "a", at: h(-1), delta: 30 },
        { accountId: 1, campaignKey: "a", at: h(-25), delta: 20 },
        { accountId: 1, campaignKey: "a", at: h(-24 * 40), delta: 99 },
      ],
      [{ accountId: 1, awardedAt: h(-2) }],
      7,
      now,
      "UTC",
    );
    expect(daily).toHaveLength(7);
    expect(daily.at(-1)).toEqual({ day: "2026-10-30", minutes: 30, rewards: 1 });
    expect(daily.at(-2)?.minutes).toBe(20);
    expect(daily.reduce((s, d) => s + d.minutes, 0)).toBe(50);
    expect(streak(daily)).toBe(2);
  });

  it("keeps a streak alive before today's first watch", () => {
    const d = (minutes: number) => ({ day: "", minutes, rewards: 0 });
    expect(streak([d(5), d(5), d(0)])).toBe(2);
    expect(streak([d(5), d(0), d(0)])).toBe(0);
  });
});

describe("campaign summary and risk", () => {
  it("rates deadlines", () => {
    expect(risk(120, h(1), now)).toBe("impossible");
    expect(risk(120, h(4), now)).toBe("tight");
    expect(risk(120, h(48), now)).toBe("ok");
    expect(risk(null, h(48), now)).toBeNull();
  });

  it("groups drops by campaign and finds the next reward", () => {
    const [c] = summarizeCampaigns(
      [
        item({ campaignId: 1, name: "Part 1", requiredMinutes: 60, minutesWatched: 60, status: "claimed" }),
        item({ campaignId: 2, name: "Part 2", requiredMinutes: 120, minutesWatched: 70, status: "in_progress" }),
        item({ campaignId: 3, name: "Part 3", requiredMinutes: 240, minutesWatched: 70, status: "in_progress" }),
      ],
      now,
    );
    expect(c).toMatchObject({ drops: 3, claimed: 1, ready: 0, started: true, remainingMinutes: 170, next: { name: "Part 2", remainingMinutes: 50 }, risk: "ok" });
    expect(summarizeCampaigns([item({ endsAt: h(0.5) })], now)[0]).toMatchObject({ started: false, risk: "impossible" });
  });

  it("keeps sub rewards apart from the watch goal", () => {
    const [c] = summarizeCampaigns(
      [
        item({ campaignId: 1, name: "Melissa 1", imageUrl: "sub.png", requiredMinutes: 0, requiredSubs: 1, subsCurrent: 0 }),
        item({ campaignId: 2, name: "Melissa 2", imageUrl: "watch.png", requiredMinutes: 60 }),
      ],
      now,
    );
    expect(c).toMatchObject({ pending: 1, remainingMinutes: 60, next: { name: "Melissa 2", imageUrl: "watch.png" } });
    expect(c.subDrops).toEqual([{ name: "Melissa 1", imageUrl: "sub.png", subs: 0, requiredSubs: 1 }]);
    const [subbed] = summarizeCampaigns([item({ requiredMinutes: 0, requiredSubs: 1, subsCurrent: 1, status: "in_progress" })], now);
    expect(subbed).toMatchObject({ ready: 1, subDrops: [] });
  });

  it("does not guess remaining time when progress is unknown", () => {
    const [c] = summarizeCampaigns([item({ status: "unknown", minutesWatched: null })], now);
    expect(c.remainingMinutes).toBeNull();
    expect(c.risk).toBeNull();
  });
});

describe("plan", () => {
  const live = [
    { campaignExternalId: "camp-b", login: "small", displayName: "Small", viewers: 10, title: null, avatarUrl: null },
    { campaignExternalId: "camp-b", login: "big", displayName: "Big", viewers: 1000, title: null, avatarUrl: null },
  ];

  it("puts claims first, then the most urgent feasible campaign, then links", () => {
    const items = [
      item({ campaignExternalId: "relaxed", campaignId: 1, endsAt: h(24 * 10) }),
      item({ campaignExternalId: "camp-b", campaignId: 2, endsAt: h(5) }),
      item({ campaignExternalId: "ready", campaignId: 3, minutesWatched: 60, status: "in_progress" }),
      item({ campaignExternalId: "link", campaignId: 4, accountConnected: false, accountLinkUrl: "https://link" }),
      item({ campaignExternalId: "lost", campaignId: 5, endsAt: h(0.5) }),
      item({ campaignExternalId: "done", campaignId: 6, status: "claimed", minutesWatched: 60 }),
      item({ campaignExternalId: "ended", campaignId: 7, endsAt: h(-1) }),
      item({ campaignExternalId: "sub", campaignId: 8, requiredMinutes: 0, requiredSubs: 1, subsCurrent: 0 }),
    ];
    const p = plan(items, live, now);
    expect(p.map((x) => [x.key, x.action])).toEqual([
      ["ready", "claim"],
      ["camp-b", "watch"],
      ["relaxed", "watch"],
      ["lost", "watch"],
      ["link", "link"],
    ]);
    expect(p[1].channels.map((c) => c.login)).toEqual(["big", "small"]);
    expect(p[3].risk).toBe("impossible");
  });

  it("leaves out skipped campaigns", () => {
    const items = [
      item({ campaignExternalId: "lost", campaignId: 1, endsAt: h(0.5) }),
      item({ campaignExternalId: null, campaignName: "No id", campaignId: 2 }),
      item({ campaignExternalId: "kept", campaignId: 3 }),
    ];
    expect(plan(items, [], now, new Set(["lost", "name:No id"])).map((x) => x.key)).toEqual(["kept"]);
  });
});

describe("effectiveStatus", () => {
  it("expires open rows past the end date but keeps claimed ones", () => {
    expect(effectiveStatus("not_started", h(-1), now)).toBe("expired");
    expect(effectiveStatus("unknown", h(-1), now)).toBe("expired");
    expect(effectiveStatus("claimed", h(-1), now)).toBe("claimed");
    expect(effectiveStatus("in_progress", h(1), now)).toBe("in_progress");
    expect(effectiveStatus("in_progress", null, now)).toBe("in_progress");
  });
});

describe("aggregates", () => {
  it("breaks down by game without double counting campaign minutes", () => {
    const games = byGame(
      [
        item({ campaignId: 1, minutesWatched: 30, status: "in_progress" }),
        item({ campaignId: 2, minutesWatched: 30, status: "in_progress", requiredMinutes: 120 }),
        item({ campaignId: 3, gameName: null, campaignExternalId: "x", status: "claimed", minutesWatched: 60 }),
      ],
      now,
    );
    expect(games.map((g) => g.game)).toEqual(["Без игры (награды каналов)", "Game A"]); // most watched first
    expect(games[1]).toMatchObject({ drops: 2, inProgress: 2, watched: 30, remaining: 90 });
    expect(games[0]).toMatchObject({ claimed: 1, watched: 60, remaining: 0 });
  });

  it("summarizes sync health without connect events", () => {
    const run = (status: "ok" | "failed", sec: number, errorCode: string | null = null) => ({
      status,
      startedAt: h(-1),
      finishedAt: new Date(h(-1).getTime() + sec * 1000),
      errorCode,
    });
    const s = syncHealth([run("ok", 2), run("ok", 4), run("failed", 1, "rate_limited"), run("ok", 0, "account_connected")]);
    expect(s).toMatchObject({ runs: 3, ok: 2, failed: 1, avgSeconds: 3, lastError: { code: "rate_limited" } });
    expect(s.okRate).toBeCloseTo(2 / 3);
  });

  it("totals statuses and remaining work", () => {
    const t = totals(
      [
        item({ campaignId: 1, status: "claimed", minutesWatched: 60 }),
        item({ campaignId: 2, status: "in_progress", minutesWatched: 60 }),
        item({ campaignId: 3, campaignExternalId: "b", status: "in_progress", minutesWatched: 20 }),
        item({ campaignId: 4, campaignExternalId: "c", status: "unknown", minutesWatched: null }),
      ],
      now,
    );
    expect(t).toMatchObject({ drops: 4, claimed: 1, inProgress: 2, ready: 1, unknown: 1, activeCampaigns: 3, remainingMinutes: 40 });
    expect(t.atRisk).toBe(0);
    expect(t.completion).toBeCloseTo(1 / 3);
  });
});

describe("skip cooldown", () => {
  const at = new Date("2026-10-30T10:00:00Z");

  it("keeps user skips forever and no_progress skips for the cooldown", () => {
    const later = new Date(at.getTime() + NO_PROGRESS_COOLDOWN_MS + 1);
    expect(skipActive({ reason: "user", createdAt: at }, later)).toBe(true);
    expect(skipActive({ reason: "no_progress", createdAt: at }, new Date(at.getTime() + 60_000))).toBe(true);
    expect(skipActive({ reason: "no_progress", createdAt: at }, later)).toBe(false);
    expect(skipRetryAt({ reason: "user", createdAt: at })).toBeNull();
    expect(skipRetryAt({ reason: "no_progress", createdAt: at })?.getTime()).toBe(at.getTime() + NO_PROGRESS_COOLDOWN_MS);
  });
});
