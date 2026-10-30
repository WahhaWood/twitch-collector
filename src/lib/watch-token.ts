// Twitch login with the Android app's client id: the token it returns earns drops minutes while watching
// (the TV token does not). Twitch finishes the login on a twitch.tv page whose address carries the token.
export const WATCH_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";

export const WATCH_AUTH_URL = `https://id.twitch.tv/oauth2/authorize?${new URLSearchParams({
  client_id: WATCH_CLIENT_ID,
  redirect_uri: "https://www.twitch.tv/login",
  response_type: "token",
  scope: "",
})}`;

const TOKEN_RE = /^[a-z0-9]{30}$/;

// Accepts the address copied after login (token in the fragment or query), `oauth:<token>` or the bare token.
export function parseWatchToken(input: string): string | null {
  const text = input.trim();
  const fromUrl = text.match(/[#?&]access_token=([A-Za-z0-9]+)/)?.[1];
  const candidate = (fromUrl ?? text.replace(/^oauth:/i, "")).toLowerCase();
  return TOKEN_RE.test(candidate) ? candidate : null;
}
