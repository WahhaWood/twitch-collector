import { cookies } from "next/headers";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { env } from "./env";
import { SESSION_COOKIE, verifySession } from "./session";

export async function getCurrentUser() {
  await connection(); // session expiry uses Date.now(); must not run during prerender
  const userId = verifySession((await cookies()).get(SESSION_COOKIE)?.value, env().SESSION_SECRET);
  if (userId === null) return null;
  const [user] = await db().select({ id: users.id, name: users.name, isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
  return user ?? null;
}

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}
