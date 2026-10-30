import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDeviceState, sealDeviceState } from "./device-state";

const key = randomBytes(32).toString("base64");

describe("device state cookie", () => {
  it("round-trips for the same user", () => {
    expect(openDeviceState(sealDeviceState(7, "dev-code", 600, key), 7, key)).toBe("dev-code");
  });

  it("is cookie-safe (base64url)", () => {
    expect(sealDeviceState(7, "dev-code", 600, key)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects another user", () => {
    expect(openDeviceState(sealDeviceState(7, "dev-code", 600, key), 8, key)).toBeNull();
  });

  it("rejects an expired cookie", () => {
    const sealed = sealDeviceState(7, "dev-code", 600, key, Date.now() - 601_000);
    expect(openDeviceState(sealed, 7, key)).toBeNull();
  });

  it("rejects tampering, another key and garbage", () => {
    const sealed = sealDeviceState(7, "dev-code", 600, key);
    const flipped = (sealed[10] === "A" ? "B" : "A");
    expect(openDeviceState(sealed.slice(0, 10) + flipped + sealed.slice(11), 7, key)).toBeNull();
    expect(openDeviceState(sealed, 7, randomBytes(32).toString("base64"))).toBeNull();
    expect(openDeviceState("garbage", 7, key)).toBeNull();
    expect(openDeviceState(undefined, 7, key)).toBeNull();
  });
});
