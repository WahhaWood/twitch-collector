import { asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { twitchAccounts, users } from "@/db/schema";
import { apiError, getCurrentUser } from "@/lib/auth";
import { issueToken } from "@/lib/users";

const body = z.object({ name: z.string().trim().min(1).max(60), isAdmin: z.boolean().optional() });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  if (!user.isAdmin) return apiError(403, "forbidden", "Admins only");
  const list = await db()
    .select({
      id: users.id,
      name: users.name,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      accounts: count(twitchAccounts.id),
      lastSyncedAt: sql<string | null>`max(${twitchAccounts.lastSyncedAt})`,
    })
    .from(users)
    .leftJoin(twitchAccounts, eq(twitchAccounts.userId, users.id))
    .groupBy(users.id)
    .orderBy(asc(users.id));
  return Response.json({ users: list });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  if (!user.isAdmin) return apiError(403, "forbidden", "Admins only");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "bad_request", "Name is required");

  const [existing] = await db().select({ id: users.id }).from(users).where(eq(users.name, parsed.data.name));
  if (existing) return apiError(409, "name_taken", "A user with this name exists");
  const { token, tokenHash } = issueToken();
  const [created] = await db()
    .insert(users)
    .values({ name: parsed.data.name, isAdmin: parsed.data.isAdmin ?? false, tokenHash })
    .returning({ id: users.id, name: users.name });
  return Response.json({ user: created, token }, { status: 201 });
}
