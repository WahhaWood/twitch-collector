import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, hashToken } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips", () => {
    expect(decrypt(encrypt("secret", key), key)).toBe("secret");
  });
  it("fails on tampered ciphertext", () => {
    const buf = Buffer.from(encrypt("secret", key), "base64");
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString("base64"), key)).toThrow();
  });
  it("hashes deterministically", () => {
    expect(hashToken("a")).toBe(hashToken("a"));
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
