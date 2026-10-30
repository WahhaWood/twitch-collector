import { env } from "./env";

const DEVICE_URL = "https://id.twitch.tv/oauth2/device";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const GQL_URL = "https://gql.twitch.tv/gql";
const TIMEOUT_MS = 5000;
const ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5000;

export type TwitchTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };
export type TwitchIdentity = { id: string; login: string; displayName: string };
export type DeviceStart = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };
export type DevicePoll = { kind: "pending" } | { kind: "expired" } | { kind: "ok"; tokens: TwitchTokens };

export type TwitchErrorCode = "unauthorized" | "rate_limited" | "unavailable" | "bad_response";

// Messages never include tokens or raw response bodies.
export class TwitchError extends Error {
  constructor(
    readonly code: TwitchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retries timeouts, network errors and 5xx with exponential backoff + jitter; honours short Retry-After on 429.
export async function fetchWithRetry(url: string, init: RequestInit, attempts = ATTEMPTS): Promise<Response> {
  for (let i = 0; ; i++) {
    const last = i === attempts - 1;
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      if (last) throw new TwitchError("unavailable", "Twitch request timed out or failed");
      await sleep(backoff(i));
      continue;
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) * 1000;
      if (last || !Number.isFinite(wait) || wait > MAX_RETRY_AFTER_MS) {
        throw new TwitchError("rate_limited", "Twitch rate limit");
      }
      await sleep(wait || backoff(i));
      continue;
    }
    if (res.status >= 500) {
      if (last) throw new TwitchError("unavailable", `Twitch responded ${res.status}`);
      await sleep(backoff(i));
      continue;
    }
    return res;
  }
}

function backoff(attempt: number) {
  return 300 * 2 ** attempt + Math.random() * 200;
}

function clientId() {
  return env().TWITCH_GQL_CLIENT_ID;
}

function toTokens(data: { access_token: string; refresh_token?: string; expires_in?: number }, now: number): TwitchTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(now + data.expires_in * 1000) : null,
  };
}

export async function startDevice(): Promise<DeviceStart> {
  const res = await fetchWithRetry(DEVICE_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId(), scopes: "" }),
  });
  if (!res.ok) throw new TwitchError("bad_response", `Twitch device start failed: ${res.status}`);
  const d = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  return {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    expiresIn: d.expires_in,
    interval: d.interval,
  };
}

export async function pollDevice(deviceCode: string, now = Date.now()): Promise<DevicePoll> {
  const res = await fetchWithRetry(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId(),
      scopes: "",
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (res.ok) return { kind: "ok", tokens: toTokens(await res.json(), now) };
  const { message } = ((await res.json().catch(() => ({}))) as { message?: string }) ?? {};
  if (message === "authorization_pending" || message === "slow_down") return { kind: "pending" };
  return { kind: "expired" };
}

export async function refreshTokens(refreshToken: string, now = Date.now()): Promise<TwitchTokens> {
  const res = await fetchWithRetry(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId(), grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (res.status === 400 || res.status === 401) throw new TwitchError("unauthorized", "Twitch refresh rejected");
  if (!res.ok) throw new TwitchError("bad_response", `Twitch refresh failed: ${res.status}`);
  return toTokens(await res.json(), now);
}

export async function gql<T>(accessToken: string, query: string, client = clientId()): Promise<T> {
  const res = await fetchWithRetry(GQL_URL, {
    method: "POST",
    headers: { Authorization: `OAuth ${accessToken}`, "Client-Id": client, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (res.status === 401) throw new TwitchError("unauthorized", "Twitch rejected the token");
  if (!res.ok) throw new TwitchError("bad_response", `Twitch GQL responded ${res.status}`);
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message?: string }[] } | null;
  if (!body?.data) {
    const msg = body?.errors?.[0]?.message?.slice(0, 200) ?? "empty response";
    throw new TwitchError("bad_response", `Twitch GQL error: ${msg}`);
  }
  return body.data;
}

export async function fetchIdentity(accessToken: string, client?: string): Promise<TwitchIdentity> {
  const data = await gql<{ currentUser: TwitchIdentity | null }>(accessToken, "query { currentUser { id login displayName } }", client);
  if (!data.currentUser) throw new TwitchError("unauthorized", "Twitch returned no current user");
  return data.currentUser;
}
