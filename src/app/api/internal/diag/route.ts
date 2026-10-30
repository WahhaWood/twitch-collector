import { eq } from "drizzle-orm";
import { db } from "@/db";
import { twitchAccounts } from "@/db/schema";
import { isCronAuthorized } from "@/lib/accounts";
import { apiError } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { channelsQuery, pickChannels, streamsQuery, type StreamEdge } from "@/lib/drops";
import { env } from "@/lib/env";

export const maxDuration = 60;

async function raw(token: string, query: string) {
  const res = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, "Client-Id": env().TWITCH_GQL_CLIENT_ID, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

// TEMPORARY: raw discovery responses as seen from the deployed runtime.
export async function POST(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env().CRON_SECRET)) return apiError(401, "unauthorized", "Invalid cron secret");
  const [a] = await db().select().from(twitchAccounts).where(eq(twitchAccounts.id, 1));
  const token = decrypt(a.accessTokenEnc!, env().TOKEN_ENC_KEY);
  const s = await raw(token, streamsQuery());
  const edges = (s.body?.data?.streams?.edges ?? []) as StreamEdge[];
  const ids = pickChannels(edges).slice(0, 15);
  const c = await raw(token, channelsQuery(ids));
  const chans = Object.values(c.body?.data ?? {}) as any[];
  const games: Record<string, number> = {};
  for (const ch of chans) for (const k of ch?.viewerDropCampaigns ?? []) games[k.game?.displayName] = (games[k.game?.displayName] ?? 0) + 1;
  return Response.json({
    region: process.env.VERCEL_REGION ?? null,
    streams: { status: s.status, edges: edges.length, errors: (s.body?.errors ?? []).slice(0, 3).map((e: any) => e.message), top: edges.slice(0, 8).map((e: any) => e.node?.game?.id + ":" + e.node?.broadcaster?.login) },
    channels: { status: c.status, asked: ids.length, nullChannels: chans.filter((x) => !x).length, emptyCampaigns: chans.filter((x) => x && !x.viewerDropCampaigns?.length).length, errors: [...new Set((c.body?.errors ?? []).map((e: any) => e.message))].slice(0, 4), games },
    ext: c.body?.extensions ?? null,
  });
}
