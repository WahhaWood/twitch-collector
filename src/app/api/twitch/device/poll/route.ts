import { and, count, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { syncRuns, twitchAccounts } from "@/db/schema";
import { MAX_ACCOUNTS } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { DEVICE_COOKIE, openDeviceState } from "@/lib/device-state";
import { env } from "@/lib/env";
import { syncAccount } from "@/lib/sync";
import { fetchIdentity, pollDevice } from "@/lib/twitch";

export const maxDuration = 60;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");

  const jar = await cookies();
  const key = env().TOKEN_ENC_KEY;
  const deviceCode = openDeviceState(jar.get(DEVICE_COOKIE)?.value, user.id, key);
  const clear = () => jar.delete({ name: DEVICE_COOKIE, path: "/api/twitch" });
  if (!deviceCode) return apiError(400, "device_expired", "Connection code expired, start again");

  let tokens, identity;
  try {
    const poll = await pollDevice(deviceCode);
    if (poll.kind === "pending") return Response.json({ status: "pending" });
    clear();
    if (poll.kind === "expired") return apiError(400, "device_expired", "Connection code expired, start again");
    tokens = poll.tokens;
    identity = await fetchIdentity(tokens.accessToken);
  } catch {
    return apiError(502, "twitch_error", "Twitch request failed");
  }

  const [existing] = await db()
    .select({ id: twitchAccounts.id, userId: twitchAccounts.userId, status: twitchAccounts.status })
    .from(twitchAccounts)
    .where(eq(twitchAccounts.twitchUserId, identity.id));
  if (existing && existing.userId !== user.id) {
    return apiError(409, "account_taken", "This Twitch account is connected to another user");
  }
  if (!existing || existing.status === "revoked") {
    const [{ n }] = await db()
      .select({ n: count() })
      .from(twitchAccounts)
      .where(and(eq(twitchAccounts.userId, user.id), ne(twitchAccounts.status, "revoked")));
    if (n >= MAX_ACCOUNTS) return apiError(409, "account_limit", `At most ${MAX_ACCOUNTS} accounts allowed`);
  }

  const values = {
    login: identity.login,
    displayName: identity.displayName,
    accessTokenEnc: encrypt(tokens.accessToken, key),
    refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken, key) : null,
    tokenExpiresAt: tokens.expiresAt,
    status: "active" as const,
    lockedUntil: null,
  };
  const [account] = await db()
    .insert(twitchAccounts)
    .values({ userId: user.id, twitchUserId: identity.id, ...values })
    .onConflictDoUpdate({ target: twitchAccounts.twitchUserId, set: values })
    .returning({ id: twitchAccounts.id });
  await db()
    .insert(syncRuns)
    .values({ accountId: account.id, finishedAt: new Date(), status: "ok", errorCode: "account_connected" });

  const sync = await syncAccount(account.id);
  return Response.json({ status: "connected", accountId: account.id, sync });
}
