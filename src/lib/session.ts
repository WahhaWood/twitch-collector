import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Cookie value: `${userId}.${expiresAtMs}.${hmac}`
function mac(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(userId: number, secret: string, now = Date.now()): string {
  const payload = `${userId}.${now + SESSION_TTL_MS}`;
  return `${payload}.${mac(payload, secret)}`;
}

export function verifySession(value: string | undefined, secret: string, now = Date.now()): number | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = Buffer.from(mac(`${id}.${exp}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const userId = Number(id);
  if (!Number.isInteger(userId) || Number(exp) <= now) return null;
  return userId;
}
