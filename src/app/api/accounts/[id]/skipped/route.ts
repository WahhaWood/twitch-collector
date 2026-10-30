import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { skippedCampaigns, twitchAccounts } from "@/db/schema";
import { accountIdParam, ownedAccount } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";

const body = z.object({ key: z.string().min(1).max(300), name: z.string().min(1).max(300) });
const keyOnly = z.object({ key: z.string().min(1).max(300) });

async function owned(ctx: RouteContext<"/api/accounts/[id]/skipped">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid account id");
  const [account] = await db().select({ id: twitchAccounts.id }).from(twitchAccounts).where(ownedAccount(user.id, id));
  if (!account) return apiError(404, "not_found", "Account not found");
  return id;
}

// Hides a campaign from the overview plan for this account.
export async function POST(req: Request, ctx: RouteContext<"/api/accounts/[id]/skipped">) {
  const id = await owned(ctx);
  if (id instanceof Response) return id;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "bad_request", "Invalid body");
  await db()
    .insert(skippedCampaigns)
    .values({ accountId: id, campaignKey: parsed.data.key, campaignName: parsed.data.name })
    .onConflictDoNothing();
  return new Response(null, { status: 204 });
}

// Brings a skipped campaign back.
export async function DELETE(req: Request, ctx: RouteContext<"/api/accounts/[id]/skipped">) {
  const id = await owned(ctx);
  if (id instanceof Response) return id;
  const parsed = keyOnly.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "bad_request", "Invalid body");
  await db()
    .delete(skippedCampaigns)
    .where(and(eq(skippedCampaigns.accountId, id), eq(skippedCampaigns.campaignKey, parsed.data.key)));
  return new Response(null, { status: 204 });
}
