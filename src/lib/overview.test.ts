import { describe, expect, it } from "vitest";
import { channelHue, greeting, leftShort, segments, timelineBar } from "./overview";

describe("timelineBar", () => {
  it("fits the bar before the deadline when there is time", () => {
    expect(timelineBar(90, 400)).toEqual({ deadline: "83.3%", fit: "18.8%", over: "0.0%" });
  });
  it("hatches the part past the deadline", () => {
    expect(timelineBar(150, 130)).toEqual({ deadline: "27.1%", fit: "27.1%", over: "4.2%" });
  });
  it("clips at the window edge", () => {
    expect(timelineBar(900, 60)).toEqual({ deadline: "12.5%", fit: "12.5%", over: "87.5%" });
  });
});

describe("segments", () => {
  it("uses one segment per minute for short goals", () => {
    expect(segments(3, 7)).toEqual([1, 1, 1, 0, 0, 0, 0]);
  });
  it("caps at 12 segments and fills the current one partially", () => {
    const s = segments(52, 60);
    expect(s).toHaveLength(12);
    expect(s.slice(9)).toEqual([1, 0.4, 0]);
  });
  it("is empty without a goal", () => {
    expect(segments(5, 0)).toEqual([]);
  });
});

describe("labels", () => {
  it("formats time left", () => {
    expect(leftShort(65)).toBe("1:05");
    expect(leftShort(5)).toBe("0:05");
    expect(leftShort(18 * 60)).toBe("18 ч");
    expect(leftShort(3 * 1440 + 5)).toBe("3 д");
  });
  it("greets by hour", () => {
    expect(greeting(3)).toBe("Доброй ночи");
    expect(greeting(19)).toBe("Добрый вечер");
  });
  it("gives a stable hue", () => {
    expect(channelHue("roier")).toBe(channelHue("roier"));
    expect(channelHue("roier")).toBeLessThan(360);
  });
});
