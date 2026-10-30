import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS, signSession, verifySession } from "./session";

const secret = "test-secret-test-secret";

describe("session", () => {
  it("accepts a valid cookie", () => {
    expect(verifySession(signSession(7, secret), secret)).toBe(7);
  });
  it("rejects an expired cookie", () => {
    const c = signSession(7, secret, 0);
    expect(verifySession(c, secret, SESSION_TTL_MS + 1)).toBeNull();
  });
  it("rejects a tampered user id", () => {
    const [, exp, sig] = signSession(7, secret).split(".");
    expect(verifySession(`8.${exp}.${sig}`, secret)).toBeNull();
  });
  it("rejects a wrong secret and garbage", () => {
    expect(verifySession(signSession(7, secret), "other-secret-other-secret")).toBeNull();
    expect(verifySession("abc", secret)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
  });
});
