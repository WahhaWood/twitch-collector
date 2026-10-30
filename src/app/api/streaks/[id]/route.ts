import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { streakChannels, twitchAccounts } from "@/db/schema";
import { accountIdParam } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/streaks/[id]">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid id");
  const own = db().select({ id: twitchAccounts.id }).from(twitchAccounts).where(eq(twitchAccounts.userId, user.id));
  const deleted = await db()
    .delete(streakChannels)
    .where(and(eq(streakChannels.id, id), inArray(streakChannels.accountId, own)))
    .returning({ id: streakChannels.id });
  if (!deleted.length) return apiError(404, "not_found", "Channel not found");
  return new Response(null, { status: 204 });
}
