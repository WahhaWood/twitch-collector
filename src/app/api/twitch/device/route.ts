import { and, count, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { twitchAccounts } from "@/db/schema";
import { MAX_ACCOUNTS } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";
import { DEVICE_COOKIE, sealDeviceState } from "@/lib/device-state";
import { env } from "@/lib/env";
import { startDevice } from "@/lib/twitch";

// Starts Twitch device code flow: the user enters `userCode` at `verificationUri`, the client polls /poll.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");

  const [{ n }] = await db()
    .select({ n: count() })
    .from(twitchAccounts)
    .where(and(eq(twitchAccounts.userId, user.id), ne(twitchAccounts.status, "revoked")));
  if (n >= MAX_ACCOUNTS) return apiError(409, "account_limit", `At most ${MAX_ACCOUNTS} accounts allowed`);

  let device;
  try {
    device = await startDevice();
  } catch {
    return apiError(502, "twitch_error", "Twitch request failed");
  }

  (await cookies()).set(DEVICE_COOKIE, sealDeviceState(user.id, device.deviceCode, device.expiresIn, env().TOKEN_ENC_KEY), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/twitch",
    maxAge: device.expiresIn,
  });
  return Response.json({
    userCode: device.userCode,
    verificationUri: device.verificationUri,
    expiresIn: device.expiresIn,
    interval: device.interval,
  });
}
