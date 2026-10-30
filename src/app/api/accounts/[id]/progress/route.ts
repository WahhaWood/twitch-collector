import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, progress, twitchAccounts } from "@/db/schema";
import { accountIdParam, ownedAccount } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";
import { effectiveStatus } from "@/lib/stats";
import { loadLive, loadRewards } from "@/lib/stats-data";

export async function GET(_req: Request, ctx: RouteContext<"/api/accounts/[id]/progress">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid account id");

  const [account] = await db()
    .select({
      id: twitchAccounts.id,
      login: twitchAccounts.login,
      displayName: twitchAccounts.displayName,
      status: twitchAccounts.status,
      lastSyncedAt: twitchAccounts.lastSyncedAt,
    })
    .from(twitchAccounts)
    .where(ownedAccount(user.id, id));
  if (!account) return apiError(404, "not_found", "Account not found");

  const now = new Date();
  const rows = await db()
    .select({
      campaignId: campaigns.id,
      kind: campaigns.kind,
      name: campaigns.name,
      campaignName: campaigns.campaignName,
      campaignExternalId: campaigns.campaignExternalId,
      accountLinkUrl: campaigns.accountLinkUrl,
      gameName: campaigns.gameName,
      imageUrl: campaigns.imageUrl,
      endsAt: campaigns.endsAt,
      requiredMinutes: campaigns.requiredMinutes,
      requiredSubs: campaigns.requiredSubs,
      minutesWatched: progress.minutesWatched,
      subsCurrent: progress.subsCurrent,
      status: progress.status,
      source: progress.source,
      accountConnected: progress.accountConnected,
      fetchedAt: progress.fetchedAt,
    })
    .from(progress)
    .innerJoin(campaigns, eq(campaigns.id, progress.campaignId))
    .where(eq(progress.accountId, account.id))
    .orderBy(asc(campaigns.endsAt), asc(campaigns.id));
  const items = rows.map((r) => ({ ...r, status: effectiveStatus(r.status, r.endsAt, now) }));
  const campaignIds = [...new Set(items.map((i) => i.campaignExternalId).filter((v): v is string => !!v))];
  const [channels, awarded] = await Promise.all([loadLive(campaignIds, now), loadRewards([account.id], 50)]);
  const live: Record<string, Omit<(typeof channels)[number], "campaignExternalId">[]> = {};
  for (const { campaignExternalId, ...c } of channels.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))) {
    (live[campaignExternalId] ??= []).push(c);
  }
  return Response.json({ account, items, live, rewards: awarded.map((r) => ({ name: r.name, imageUrl: r.imageUrl, awardedAt: r.awardedAt })) });
}
