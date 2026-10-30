import { describe, expect, it } from "vitest";
import type { PlanItem } from "./client";
import type { StatItem } from "./stats";
import {
  activeOffline,
  backoffMs,
  campaignMinutes,
  chooseTargets,
  dropCandidates,
  MAX_CHANNEL_TRIES,
  minuteDue,
  offlineTtl,
  planInterval,
  STREAK_GOAL_SECONDS,
  stalled,
  stallAction,
  streakCandidates,
  syncDueAt,
} from "./worker";

const streak = (id: number, login: string, over: Partial<Parameters<typeof streakCandidates>[0][number]> = {}) => ({
  id,
  accountId: 1,
  channelId: `c${id}`,
  login,
  displayName: login,
  avatarUrl: null,
  broadcastId: `b${id}`,
  liveSince: new Date(`2026-10-30T1${id}:00:00Z`),
  live: true,
  watchedSeconds: 0,
  checkedAt: null,
  createdAt: new Date(),
  ...over,
});

const item = (over: Partial<PlanItem & { endsAt: Date | null }>) =>
  ({ action: "watch", risk: "ok", campaignName: "C", channels: [], ...over }) as unknown as Parameters<typeof dropCandidates>[0][number];
const ch = (login: string) => ({ login, displayName: login.toUpperCase(), viewers: 1, title: null, avatarUrl: null });

describe("streakCandidates", () => {
  it("keeps live channels below the goal, earliest broadcast first", () => {
    const out = streakCandidates([
      streak(3, "late"),
      streak(1, "early"),
      streak(2, "done", { watchedSeconds: STREAK_GOAL_SECONDS }),
      streak(4, "offline", { live: false }),
    ]);
    expect(out.map((c) => c.login)).toEqual(["early", "late"]);
    expect(out[0]).toMatchObject({ kind: "streak", streakId: 1 });
  });
});

describe("dropCandidates", () => {
  it("lists channels of watchable campaigns in plan order, skipping offline ones", () => {
    const out = dropCandidates(
      [
        item({ action: "claim", channels: [ch("claimonly")] }),
        item({ risk: "impossible", channels: [ch("hopeless")] }),
        item({ campaignName: "A", key: "camp-a", channels: [ch("a1"), ch("a2")] }),
        item({ campaignName: "B", channels: [ch("b1")] }),
      ],
      new Set(["a1"]),
    );
    expect(out.map((c) => c.login)).toEqual(["a2", "b1"]);
    expect(out[0]).toEqual({ kind: "drop", login: "a2", displayName: "A2", avatarUrl: null, campaignName: "A", campaignKey: "camp-a", reward: undefined, etaMin: null });
  });

  it("skips channels where watching this campaign did not count, but only for that campaign", () => {
    const items = [item({ key: "a", channels: [ch("x"), ch("y")] }), item({ key: "b", channels: [ch("x")] })];
    const out = dropCandidates(items, new Set(), new Map([["a", new Set(["x"])]]));
    expect(out.map((c) => `${c.campaignKey}:${c.login}`)).toEqual(["a:y", "b:x"]);
  });
});

describe("progress watchdog", () => {
  const stat = (over: Partial<StatItem>) => ({ campaignExternalId: "camp", campaignName: "C", name: "R", requiredMinutes: 60, minutesWatched: 0, ...over }) as StatItem;

  it("sums watch-based drops of the campaign and ignores sub drops", () => {
    const items = [stat({ minutesWatched: 10 }), stat({ minutesWatched: 5 }), stat({ requiredMinutes: 0, requiredSubs: 1 }), stat({ campaignExternalId: "other", minutesWatched: 99 })];
    expect(campaignMinutes(items, "camp")).toBe(15);
    expect(campaignMinutes([stat({ minutesWatched: null })], "camp")).toBeNull();
    expect(campaignMinutes([stat({ requiredMinutes: 0, requiredSubs: 1 })], "camp")).toBeNull();
  });

  it("calls a window stalled only when known minutes did not grow", () => {
    expect(stalled(0, 0)).toBe(true);
    expect(stalled(40, 40)).toBe(true);
    expect(stalled(40, 41)).toBe(false);
    expect(stalled(null, 0)).toBe(false);
    expect(stalled(40, null)).toBe(false);
  });
});

describe("chooseTargets", () => {
  const s = (login: string) => ({ kind: "streak" as const, login, displayName: login });
  const d = (login: string) => ({ kind: "drop" as const, login, displayName: login });

  it("puts streaks first and fills the rest with one drops channel", () => {
    expect(chooseTargets([s("x")], [d("y"), d("z")]).map((c) => c.login)).toEqual(["x", "y"]);
    expect(chooseTargets([s("x"), s("w"), s("v")], [d("y")]).map((c) => c.login)).toEqual(["x", "w"]);
    expect(chooseTargets([], [d("y"), d("z")]).map((c) => c.login)).toEqual(["y"]);
  });

  it("never opens one channel twice", () => {
    expect(chooseTargets([s("x")], [d("x"), d("y")]).map((c) => `${c.kind}:${c.login}`)).toEqual(["streak:x", "drop:y"]);
  });
});

describe("adaptive timing", () => {
  const MIN = 60_000;

  it("backs off exponentially up to 15 minutes", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([MIN, 2 * MIN, 4 * MIN, 8 * MIN, 15 * MIN, 15 * MIN]);
    expect(backoffMs(0)).toBe(MIN);
  });

  it("syncs when the next reward is due, never sooner than 3 minutes after the last sync", () => {
    expect(syncDueAt(0, [])).toBe(15 * MIN);
    expect(syncDueAt(0, [null, 6 * MIN])).toBe(7 * MIN);
    expect(syncDueAt(0, [40 * MIN])).toBe(15 * MIN);
    expect(syncDueAt(10 * MIN, [10 * MIN])).toBe(13 * MIN); // reward was due before this sync: no extra sync
    expect(syncDueAt(10 * MIN, [11 * MIN - 30_000])).toBe(13 * MIN);
  });

  it("looks for a streamer more often while waiting for the broadcast", () => {
    expect(planInterval(true)).toBeLessThan(planInterval(false));
  });

  it("rotates a stalled campaign to another channel once, then skips it", () => {
    expect(stallAction(1, 2)).toBe("rotate");
    expect(stallAction(1, 0)).toBe("skip");
    expect(stallAction(MAX_CHANNEL_TRIES, 3)).toBe("skip");
  });

  it("forgets offline channels after their time", () => {
    const offline = new Map([["a", 100], ["b", 500]]);
    expect([...activeOffline(offline, 200)]).toEqual(["b"]);
    expect(offline.has("a")).toBe(false);
  });
});

describe("minuteDue", () => {
  it("sends the first minute at once, then at most one per minute", () => {
    expect(minuteDue(0, 1_000_000)).toBe(true);
    expect(minuteDue(1_000_000, 1_020_000)).toBe(false);
    expect(minuteDue(1_000_000, 1_060_000)).toBe(true);
  });
});

describe("offlineTtl", () => {
  it("doubles with every strike up to two hours", () => {
    expect(offlineTtl(0)).toBe(10 * 60_000);
    expect(offlineTtl(1)).toBe(20 * 60_000);
    expect(offlineTtl(2)).toBe(40 * 60_000);
    expect(offlineTtl(9)).toBe(2 * 60 * 60_000);
  });
});
