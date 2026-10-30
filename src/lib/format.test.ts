import { describe, expect, it } from "vitest";
import { errorText, minutesText, percent, timeAgo, timeLeft } from "./format";

const now = Date.parse("2026-10-30T12:00:00Z");
const ago = (ms: number) => new Date(now - ms);

describe("timeAgo", () => {
  it("formats relative age", () => {
    expect(timeAgo(null, now)).toBe("никогда");
    expect(timeAgo(ago(30_000), now)).toBe("только что");
    expect(timeAgo(ago(12 * 60_000), now)).toBe("12 мин назад");
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe("3 ч назад");
    expect(timeAgo(ago(50 * 3_600_000).toISOString(), now)).toBe("2 дн назад");
  });
});

describe("timeLeft", () => {
  it("formats remaining time", () => {
    expect(timeLeft(null, now)).toBeNull();
    expect(timeLeft(ago(1), now)).toBe("закончилось");
    expect(timeLeft(ago(-10 * 60_000), now)).toBe("ещё 10 мин");
    expect(timeLeft(ago(-30 * 3_600_000), now)).toBe("ещё 30 ч");
    expect(timeLeft(ago(-5 * 86_400_000), now)).toBe("ещё 5 дн");
  });
});

describe("progress display", () => {
  it("shows absolute minutes", () => {
    expect(minutesText(43, 60)).toBe("43 / 60 мин");
    expect(minutesText(null, 60)).toBe("? / 60 мин");
    expect(minutesText(15, null)).toBe("15 мин");
    expect(minutesText(null, null)).toBe("—");
  });

  it("never fills the bar for unknown progress", () => {
    expect(percent(60, 60, "unknown")).toBeNull();
    expect(percent(null, 60, "in_progress")).toBeNull();
    expect(percent(43, 60, "in_progress")).toBe(72);
    expect(percent(90, 60, "in_progress")).toBe(100);
    expect(percent(null, null, "claimed")).toBe(100);
  });

  it("maps error codes to text", () => {
    expect(errorText("account_limit")).toMatch(/5/);
    expect(errorText("nope", "fallback")).toBe("fallback");
  });
});
