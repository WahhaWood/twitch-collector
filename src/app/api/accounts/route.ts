import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { twitchAccounts } from "@/db/schema";
import { apiError, getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const accounts = await db()
    .select({
      id: twitchAccounts.id,
      login: twitchAccounts.login,
      displayName: twitchAccounts.displayName,
      status: twitchAccounts.status,
      lastSyncedAt: twitchAccounts.lastSyncedAt,
      autoWatch: twitchAccounts.autoWatch,
      watching: twitchAccounts.watching,
      watchingAt: twitchAccounts.watchingAt,
    })
    .from(twitchAccounts)
    .where(eq(twitchAccounts.userId, user.id))
    .orderBy(asc(twitchAccounts.id));
  return Response.json({ accounts });
}
