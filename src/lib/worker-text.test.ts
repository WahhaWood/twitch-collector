import { describe, expect, it } from "vitest";
import { workerLine } from "./worker-text";

const now = Date.parse("2026-10-30T12:00:00Z");
const fresh = new Date(now - 20_000).toISOString();
const base = { autoWatch: true, watching: null, watchingAt: fresh, workerStatus: null };

describe("workerLine", () => {
  it("says automatic watching is off when nothing asks for it", () => {
    expect(workerLine({ ...base, autoWatch: false }, now).tone).toBe("off");
    expect(workerLine({ ...base, autoWatch: false }, now, true).tone).not.toBe("off");
  });

  it("reports a worker that stopped writing its heartbeat", () => {
    const l = workerLine({ ...base, watchingAt: new Date(now - 5 * 60_000).toISOString() }, now);
    expect(l).toMatchObject({ tone: "warn", title: "Воркер не запущен" });
    expect(workerLine({ ...base, watchingAt: null }, now).tone).toBe("warn");
  });

  it("lists what is being watched", () => {
    const l = workerLine({ ...base, watching: [{ kind: "drop", login: "a", displayName: "A" }, { kind: "streak", login: "b", displayName: "B" }] }, now);
    expect(l).toMatchObject({ tone: "ok", title: "Смотрит: A (дропсы), B (серия просмотра)" });
  });

  it("explains why it is idle", () => {
    const idle = (reason: "no_campaigns" | "no_live" | "waiting_streamers", detail: string | null = null) =>
      workerLine({ ...base, workerStatus: { state: "idle", reason, detail } }, now);
    expect(idle("no_campaigns").title).toContain("смотреть пока нечего");
    expect(idle("no_live", "Roier").detail).toContain("Ждут канал: Roier");
    expect(idle("waiting_streamers", "Roier").detail).toBe("Не в эфире: Roier.");
  });

  it("shows the retry time after an error", () => {
    const l = workerLine({ ...base, workerStatus: { state: "error", reason: "error", retryAt: new Date(now + 120_000).toISOString(), detail: "unavailable" } }, now);
    expect(l.tone).toBe("bad");
    expect(l.detail).toContain("unavailable");
  });
});
