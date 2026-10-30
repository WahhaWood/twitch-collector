import { and, count, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { loginAttempts, users } from "@/db/schema";
import { apiError } from "@/lib/auth";
import { hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/session";

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const body = z.object({ token: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "bad_request", "Token is required");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const since = new Date(Date.now() - WINDOW_MS);
  const [{ n }] = await db()
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.at, since)));
  if (n >= MAX_ATTEMPTS) return apiError(429, "too_many_attempts", "Too many attempts, try later");

  const [user] = await db().select().from(users).where(eq(users.tokenHash, hashToken(parsed.data.token.trim())));
  if (!user) {
    await db().insert(loginAttempts).values({ ip });
    return apiError(401, "invalid_token", "Invalid token");
  }

  (await cookies()).set(SESSION_COOKIE, signSession(user.id, env().SESSION_SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return Response.json({ user: { id: user.id, name: user.name } });
}
