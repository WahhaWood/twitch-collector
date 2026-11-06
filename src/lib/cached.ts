import { cacheLife } from "next/cache";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, users } from "@/db/schema";

// Shared by all users and changed only by the sync (every 15 min), so a few minutes of staleness is fine.
export async function getCatalog(kind: "drop" | "badge" | null) {
  "use cache";
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  const notEnded = or(isNull(campaigns.endsAt), gt(campaigns.endsAt, new Date()));
  return db()
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
}

// Every API call needs the user row; the session cookie is verified outside, only the lookup is cached.
export async function getUserById(id: number) {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  const [user] = await db().select({ id: users.id, name: users.name, isAdmin: users.isAdmin }).from(users).where(eq(users.id, id));
  return user ?? null;
}
