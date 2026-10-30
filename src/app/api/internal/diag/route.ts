import { eq } from "drizzle-orm";
import { db } from "@/db";
import { twitchAccounts } from "@/db/schema";
import { isCronAuthorized } from "@/lib/accounts";
import { apiError } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { parseDrops } from "@/lib/drops";
import { env } from "@/lib/env";
import { fetchDropSources } from "@/lib/sync";

export const maxDuration = 60;

// TEMPORARY: read-only discovery counters as seen from the deployed runtime.
export async function POST(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env().CRON_SECRET)) return apiError(401, "unauthorized", "Invalid cron secret");
  const [a] = await db().select().from(twitchAccounts).where(eq(twitchAccounts.id, 1));
  const started = Date.now();
  const src = await fetchDropSources(decrypt(a.accessTokenEnc!, env().TOKEN_ENC_KEY));
  const parsed = parseDrops(src.inventory, src.campaigns, new Date());
  return Response.json({
    region: process.env.VERCEL_REGION ?? null,
    ms: Date.now() - started,
    campaignsRaw: src.campaigns.length,
    live: src.live.length,
    drops: parsed.drops.length,
    kinds: parsed.drops.reduce<Record<string, number>>((m, d) => ({ ...m, [d.kind]: (m[d.kind] ?? 0) + 1 }), {}),
    games: [...new Set(src.campaigns.map((c) => c.game?.displayName))],
  });
}
