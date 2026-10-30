import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { twitchAccounts } from "@/db/schema";
import { accountIdParam, ownedAccount } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { fetchIdentity, TwitchError } from "@/lib/twitch";
import { parseWatchToken } from "@/lib/watch-token";

const body = z.object({ input: z.string().min(1).max(2000) });

async function owned(ctx: RouteContext<"/api/accounts/[id]/watch-token">) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const id = await accountIdParam(ctx.params);
  if (!id) return apiError(400, "bad_request", "Invalid account id");
  const [account] = await db()
    .select({ id: twitchAccounts.id, twitchUserId: twitchAccounts.twitchUserId })
    .from(twitchAccounts)
    .where(ownedAccount(user.id, id));
  if (!account) return apiError(404, "not_found", "Account not found");
  return account;
}

// Stores the Android-client token pasted after the Twitch login; it must belong to this very account.
export async function POST(req: Request, ctx: RouteContext<"/api/accounts/[id]/watch-token">) {
  const account = await owned(ctx);
  if (account instanceof Response) return account;
  const parsed = body.safeParse(await req.json().catch(() => null));
  const token = parsed.success ? parseWatchToken(parsed.data.input) : null;
  if (!token) return apiError(400, "bad_token", "Не нашли токен в вставленном тексте. Нужен адрес страницы Twitch после входа.");
  let who;
  try {
    who = await fetchIdentity(token, env().TWITCH_WATCH_CLIENT_ID);
  } catch (e) {
    if (e instanceof TwitchError && e.code === "unauthorized") return apiError(400, "bad_token", "Twitch не принял этот токен. Войдите заново и скопируйте адрес целиком.");
    return apiError(502, "twitch_unavailable", "Twitch сейчас не отвечает, попробуйте позже.");
  }
  if (who.id !== account.twitchUserId) {
    return apiError(409, "wrong_account", `Вы вошли как ${who.login}, а нужен другой аккаунт. Выйдите из Twitch и войдите нужным.`);
  }
  await db().update(twitchAccounts).set({ watchTokenEnc: encrypt(token, env().TOKEN_ENC_KEY) }).where(eq(twitchAccounts.id, account.id));
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/accounts/[id]/watch-token">) {
  const account = await owned(ctx);
  if (account instanceof Response) return account;
  await db().update(twitchAccounts).set({ watchTokenEnc: null }).where(eq(twitchAccounts.id, account.id));
  return new Response(null, { status: 204 });
}
