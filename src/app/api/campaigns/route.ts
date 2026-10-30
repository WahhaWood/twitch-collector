import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { campaigns } from "@/db/schema";
import { apiError, getCurrentUser } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== null && kind !== "drop" && kind !== "badge") return apiError(400, "bad_request", "kind must be drop or badge");

  const notEnded = or(isNull(campaigns.endsAt), gt(campaigns.endsAt, new Date()));
  const items = await db()
    .select({
      id: campaigns.id,
      kind: campaigns.kind,
      name: campaigns.name,
      campaignName: campaigns.campaignName,
      gameName: campaigns.gameName,
      imageUrl: campaigns.imageUrl,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      requiredMinutes: campaigns.requiredMinutes,
      requiredSubs: campaigns.requiredSubs,
      lastSeenAt: campaigns.lastSeenAt,
    })
    .from(campaigns)
    .where(kind ? and(notEnded, eq(campaigns.kind, kind)) : notEnded)
    .orderBy(asc(campaigns.endsAt), asc(campaigns.id));
  return Response.json({ items });
}
