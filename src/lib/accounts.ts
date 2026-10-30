import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { twitchAccounts } from "@/db/schema";

export const MAX_ACCOUNTS = 5;

// Every per-account query goes through this condition, so another user's account id matches nothing.
export function ownedAccount(userId: number, accountId: number) {
  return and(eq(twitchAccounts.id, accountId), eq(twitchAccounts.userId, userId));
}

export async function accountIdParam(params: Promise<{ id: string }>): Promise<number | null> {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isCronAuthorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}
