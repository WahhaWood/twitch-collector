import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { streakChannels, twitchAccounts } from "@/db/schema";
import { ownedAccount } from "@/lib/accounts";
import { apiError, getCurrentUser } from "@/lib/auth";
import { withFreshToken } from "@/lib/sync";
import { TwitchError } from "@/lib/twitch";
import { fetchChannel, LOGIN_RE } from "@/lib/watch";
import { STREAK_GOAL_SECONDS } from "@/lib/worker";

const MAX_PER_ACCOUNT = 20;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const accounts = await db()
    .select({ id: twitchAccounts.id, displayName: twitchAccounts.displayName, status: twitchAccounts.status, watchingAt: twitchAccounts.watchingAt })
    .from(twitchAccounts)
    .where(and(eq(twitchAccounts.userId, user.id), ne(twitchAccounts.status, "revoked")))
    .orderBy(asc(twitchAccounts.id));
  const channels = accounts.length
    ? await db()
        .select({
          id: streakChannels.id,
          accountId: streakChannels.accountId,
          login: streakChannels.login,
          displayName: streakChannels.displayName,
          avatarUrl: streakChannels.avatarUrl,
          live: streakChannels.live,
          liveSince: streakChannels.liveSince,
          watchedSeconds: streakChannels.watchedSeconds,
          checkedAt: streakChannels.checkedAt,
        })
        .from(streakChannels)
        .where(inArray(streakChannels.accountId, accounts.map((a) => a.id)))
        .orderBy(asc(streakChannels.login))
    : [];
  return Response.json({ goalSeconds: STREAK_GOAL_SECONDS, accounts, channels });
}

const body = z.object({ accountId: z.number().int().positive(), login: z.string().trim().toLowerCase().regex(LOGIN_RE) });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "bad_login", "Invalid Twitch login");
  const { accountId, login } = parsed.data;

  const [account] = await db().select().from(twitchAccounts).where(ownedAccount(user.id, accountId));
  if (!account) return apiError(404, "not_found", "Account not found");
  if (!account.accessTokenEnc || account.status === "expired") return apiError(409, "reconnect_required", "Reconnect the account first");
  const existing = await db().select({ id: streakChannels.id }).from(streakChannels).where(eq(streakChannels.accountId, accountId));
  if (existing.length >= MAX_PER_ACCOUNT) return apiError(409, "streak_limit", "Too many channels");

  let channel;
  try {
    channel = await withFreshToken(account, (token) => fetchChannel(token, login));
  } catch (e) {
    return apiError(502, e instanceof TwitchError ? e.code : "unavailable", "Twitch lookup failed");
  }
  if (!channel) return apiError(404, "channel_not_found", "No such Twitch channel");

  const [row] = await db()
    .insert(streakChannels)
    .values({
      accountId,
      channelId: channel.channelId,
      login: channel.login,
      displayName: channel.displayName,
      avatarUrl: channel.avatarUrl,
      broadcastId: channel.broadcastId,
      liveSince: channel.liveSince,
      live: !!channel.broadcastId,
      checkedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: streakChannels.id });
  if (!row) return apiError(409, "streak_exists", "Channel already added");
  return Response.json(row, { status: 201 });
}
