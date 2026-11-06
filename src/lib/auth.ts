import { cookies } from "next/headers";
import { connection } from "next/server";
import { getUserById } from "./cached";
import { env } from "./env";
import { SESSION_COOKIE, verifySession } from "./session";

export async function getCurrentUser() {
  await connection(); // session expiry uses Date.now(); must not run during prerender
  const userId = verifySession((await cookies()).get(SESSION_COOKIE)?.value, env().SESSION_SECRET);
  if (userId === null) return null;
  return getUserById(userId);
}

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}
