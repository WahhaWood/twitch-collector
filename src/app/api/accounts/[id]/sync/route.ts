import { db } from "@/db";
import { twitchAccounts } from "@/db/schema";
import { accountIdParam, ownedAccount } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";
import { syncAccount } from "@/lib/sync";

export const maxDuration = 60;

const COOLDOWN_MS = 60_000;

export async function POST(_req: Request, ctx: RouteContext<"/api/accounts/[id]/sync">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid account id");

  const [account] = await db()
    .select({ status: twitchAccounts.status, lastSyncedAt: twitchAccounts.lastSyncedAt })
    .from(twitchAccounts)
    .where(ownedAccount(user.id, id));
  if (!account) return apiError(404, "not_found", "Account not found");
  if (account.status === "revoked" || account.status === "expired") {
    return apiError(409, "reconnect_required", "Reconnect the account first");
  }
  if (account.lastSyncedAt && Date.now() - account.lastSyncedAt.getTime() < COOLDOWN_MS) {
    return apiError(429, "too_soon", "Synced less than a minute ago");
  }

  const result = await syncAccount(id);
  if (result.status === "skipped") return apiError(409, "sync_in_progress", "Sync is already running");
  if (result.status === "failed") return apiError(502, result.code ?? "sync_failed", "Sync failed");
  return Response.json({ status: "ok" });
}
