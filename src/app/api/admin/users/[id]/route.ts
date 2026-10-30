import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { accountIdParam } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";
import { issueToken } from "@/lib/users";

const body = z.object({ reissueToken: z.literal(true).optional(), isAdmin: z.boolean().optional() });

// Reissue the login token (the old one stops working) and/or change the admin flag.
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  if (!user.isAdmin) return apiError(403, "forbidden", "Admins only");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid user id");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "bad_request", "Invalid request");
  if (id === user.id && parsed.data.isAdmin === false) return apiError(409, "self_demote", "Cannot remove your own admin rights");

  const issued = parsed.data.reissueToken ? issueToken() : null;
  const set = {
    ...(issued ? { tokenHash: issued.tokenHash } : {}),
    ...(parsed.data.isAdmin !== undefined ? { isAdmin: parsed.data.isAdmin } : {}),
  };
  if (!Object.keys(set).length) return apiError(400, "bad_request", "Nothing to change");
  const updated = await db().update(users).set(set).where(eq(users.id, id)).returning({ id: users.id });
  if (!updated.length) return apiError(404, "not_found", "User not found");
  return Response.json({ token: issued?.token ?? null });
}

// Deletes the user with their Twitch accounts and progress.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  if (!user.isAdmin) return apiError(403, "forbidden", "Admins only");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid user id");
  if (id === user.id) return apiError(409, "self_delete", "Cannot delete yourself");
  const deleted = await db().delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (!deleted.length) return apiError(404, "not_found", "User not found");
  return new Response(null, { status: 204 });
}
