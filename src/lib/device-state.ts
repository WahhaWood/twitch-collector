import { decrypt, encrypt } from "./crypto";

export const DEVICE_COOKIE = "twitch_device";

// The device code grants a token once the user activates it, so the cookie is encrypted (AES-GCM also
// authenticates it) and bound to the site user who started the flow.
export function sealDeviceState(userId: number, deviceCode: string, ttlSec: number, key: string, now = Date.now()): string {
  const json = JSON.stringify({ u: userId, d: deviceCode, e: now + ttlSec * 1000 });
  return Buffer.from(encrypt(json, key), "base64").toString("base64url");
}

export function openDeviceState(value: string | undefined, userId: number, key: string, now = Date.now()): string | null {
  if (!value) return null;
  try {
    const { u, d, e } = JSON.parse(decrypt(Buffer.from(value, "base64url").toString("base64"), key));
    if (u !== userId || typeof d !== "string" || !(e > now)) return null;
    return d;
  } catch {
    return null;
  }
}
