// Unofficial Twitch "watching" protocol, as used by TwitchDropsMiner and Twitch-Channel-Points-Miner-v2:
// the live HLS chunks are requested (HEAD, no video downloaded) and spade "minute-watched" events are sent.
// Raw GQL accepts the TV client token here; no client integrity is needed (Plan.md, stage 6 spike).
import { fetchWithRetry, gql, TwitchError } from "./twitch";

export type Channel = {
  channelId: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  // null when offline
  broadcastId: string | null;
  liveSince: Date | null;
  game: { id: string; name: string } | null;
};

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const SPADE_TTL_MS = 60 * 60_000;
const CLAIM_OK = new Set(["ELIGIBLE_FOR_ALL", "DROP_INSTANCE_ALREADY_CLAIMED"]);

export const LOGIN_RE = /^[a-zA-Z0-9_]{2,25}$/;

// True only when Twitch confirms the reward is (now or already) claimed.
export async function claimDrop(accessToken: string, instanceId: string): Promise<boolean> {
  const data = await gql<{ claimDropRewards: { status?: string | null } | null }>(
    accessToken,
    `mutation { claimDropRewards(input: { dropInstanceID: ${JSON.stringify(instanceId)} }) { status } }`,
  );
  return CLAIM_OK.has(data.claimDropRewards?.status ?? "");
}

// null when there is no such user.
export async function fetchChannel(accessToken: string, login: string, client?: string): Promise<Channel | null> {
  type User = { id: string; login: string; displayName?: string | null; profileImageURL?: string | null; stream?: { id?: string; createdAt?: string; game?: { id?: string; name?: string } | null } | null };
  const data = await gql<{ user: User | null }>(
    accessToken,
    `query { user(login: ${JSON.stringify(login)}) { id login displayName profileImageURL(width: 70) stream { id createdAt game { id name } } } }`,
    client,
  );
  const u = data.user;
  if (!u?.id) return null;
  const since = u.stream?.createdAt ? new Date(u.stream.createdAt) : null;
  return {
    channelId: u.id,
    login: u.login,
    displayName: u.displayName || u.login,
    avatarUrl: u.profileImageURL ?? null,
    broadcastId: u.stream?.id ?? null,
    liveSince: since && !Number.isNaN(since.getTime()) ? since : null,
    game: u.stream?.game?.id && u.stream.game.name ? { id: u.stream.game.id, name: u.stream.game.name } : null,
  };
}

// Lowest-quality variant playlist of a live channel; null when it is offline.
export async function fetchPlaylistUrl(accessToken: string, login: string, client?: string): Promise<string | null> {
  const data = await gql<{ streamPlaybackAccessToken: { value: string; signature: string } | null }>(
    accessToken,
    `query { streamPlaybackAccessToken(channelName: ${JSON.stringify(login)}, params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) { value signature } }`,
    client,
  );
  const pat = data.streamPlaybackAccessToken;
  if (!pat) return null;
  const qs = new URLSearchParams({ sig: pat.signature, token: pat.value });
  const res = await fetchWithRetry(`https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login)}.m3u8?${qs}`, {});
  if (!res.ok) return null;
  return lastUrl(await res.text());
}

// Playlists list URLs in ascending order: the master ends with the lowest quality, a media playlist with the newest chunk.
export function lastUrl(m3u8: string): string | null {
  return m3u8.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("https://")).at(-1) ?? null;
}

// One watch beat: fetch the media playlist and HEAD its newest chunk. False when the stream is gone or the URL expired.
export async function headLatestChunk(playlistUrl: string): Promise<boolean> {
  const res = await fetchWithRetry(playlistUrl, {});
  if (!res.ok) return false;
  const chunk = lastUrl(await res.text());
  if (!chunk) return false;
  return (await fetchWithRetry(chunk, { method: "HEAD" })).ok;
}

let spade: { url: string; at: number } | null = null;

// The spade endpoint is published in the web client's settings script.
async function spadeUrl(login: string): Promise<string> {
  if (spade && Date.now() - spade.at < SPADE_TTL_MS) return spade.url;
  const page = await (await fetchWithRetry(`https://www.twitch.tv/${encodeURIComponent(login)}`, { headers: { "User-Agent": BROWSER_UA } })).text();
  const settings = page.match(/https:\/\/(?:static\.twitchcdn\.net|assets\.twitch\.tv)\/config\/settings\.[^"]*?\.js/)?.[0];
  if (!settings) throw new TwitchError("bad_response", "Twitch settings script not found");
  const url = (await (await fetchWithRetry(settings, { headers: { "User-Agent": BROWSER_UA } })).text()).match(/"spade_url":"(.*?)"/)?.[1];
  if (!url) throw new TwitchError("bad_response", "Twitch spade url not found");
  spade = { url, at: Date.now() };
  return url;
}

// `game` ties the minute to drops campaigns of that game (as Twitch-Channel-Points-Miner-v2 does with claim_drops).
export type MinuteWatched = { userId: string; channelId: string; login: string; broadcastId: string; game?: { id: string; name: string } | null };

export function minuteWatchedBody(e: MinuteWatched): URLSearchParams {
  const event = [
    {
      event: "minute-watched",
      properties: {
        channel_id: e.channelId,
        broadcast_id: e.broadcastId,
        player: "site",
        user_id: e.userId,
        live: true,
        channel: e.login,
        ...(e.game ? { game: e.game.name, game_id: e.game.id } : {}),
      },
    },
  ];
  return new URLSearchParams({ data: Buffer.from(JSON.stringify(event)).toString("base64") });
}

export async function sendMinuteWatched(e: MinuteWatched): Promise<boolean> {
  const res = await fetchWithRetry(await spadeUrl(e.login), {
    method: "POST",
    headers: { "User-Agent": BROWSER_UA },
    body: minuteWatchedBody(e),
  });
  return res.status === 204;
}
