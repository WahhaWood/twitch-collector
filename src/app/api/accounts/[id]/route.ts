import { z } from "zod";
import { db } from "@/db";
import { syncRuns, twitchAccounts } from "@/db/schema";
import { accountIdParam, ownedAccount } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";

// Disconnect: tokens are wiped, progress rows stay for history.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/accounts/[id]">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid account id");
  const revoked = await db()
    .update(twitchAccounts)
    .set({ accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, status: "revoked", lockedUntil: null })
    .where(ownedAccount(user.id, id))
    .returning({ id: twitchAccounts.id });
  if (!revoked.length) return apiError(404, "not_found", "Account not found");
  await db().insert(syncRuns).values({ accountId: id, finishedAt: new Date(), status: "ok", errorCode: "account_revoked" });
  return new Response(null, { status: 204 });
}

const patch = z.object({ autoWatch: z.boolean() });

// Turns the watch worker on or off for this account.
export async function PATCH(req: Request, ctx: RouteContext<"/api/accounts/[id]">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid account id");
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "bad_request", "Invalid body");
  const updated = await db()
    .update(twitchAccounts)
    .set({ autoWatch: parsed.data.autoWatch })
    .where(ownedAccount(user.id, id))
    .returning({ id: twitchAccounts.id, autoWatch: twitchAccounts.autoWatch });
  if (!updated.length) return apiError(404, "not_found", "Account not found");
  return Response.json(updated[0]);
}
