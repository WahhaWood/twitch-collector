import { and, asc, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { twitchAccounts } from "@/db/schema";
import { isCronAuthorized } from "@/lib/accounts";
import { apiError } from "@/lib/auth";
import { env } from "@/lib/env";
import { pruneOldRows, syncAccount } from "@/lib/sync";

export const maxDuration = 60;

const BATCH = 5;
const STALE_MS = 15 * 60_000;
const BUDGET_MS = 40_000; // stop starting new accounts well before maxDuration

// Called by GitHub Actions on a schedule; the next run picks up whatever this one did not reach.
export async function POST(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env().CRON_SECRET)) {
    return apiError(401, "unauthorized", "Invalid cron secret");
  }
  const started = Date.now();
  const due = await db()
    .select({ id: twitchAccounts.id })
    .from(twitchAccounts)
    .where(
      and(
        inArray(twitchAccounts.status, ["active", "error"]),
        isNotNull(twitchAccounts.accessTokenEnc),
        or(isNull(twitchAccounts.lastSyncedAt), lt(twitchAccounts.lastSyncedAt, new Date(started - STALE_MS))),
      ),
    )
    .orderBy(sql`${twitchAccounts.lastSyncedAt} asc nulls first`, asc(twitchAccounts.id))
    .limit(BATCH);

  const results = [];
  for (const { id } of due) {
    if (Date.now() - started > BUDGET_MS) break;
    results.push({ accountId: id, ...(await syncAccount(id)) });
  }
  await pruneOldRows();
  return Response.json({ results });
}
