import { describe, expect, it } from "vitest";
import { parseWatchToken } from "./watch-token";

const token = "abcdefghij0123456789abcdefghij";

describe("parseWatchToken", () => {
  it("reads the token from the fragment, the query, oauth: form and bare", () => {
    expect(parseWatchToken(`https://www.twitch.tv/login#access_token=${token}&scope=&token_type=bearer`)).toBe(token);
    expect(parseWatchToken(`https://www.twitch.tv/login?foo=1&access_token=${token}`)).toBe(token);
    expect(parseWatchToken(`oauth:${token}`)).toBe(token);
    expect(parseWatchToken(`  ${token}\n`)).toBe(token);
  });

  it("rejects anything else", () => {
    expect(parseWatchToken("https://www.twitch.tv/login")).toBeNull();
    expect(parseWatchToken("short")).toBeNull();
    expect(parseWatchToken(`${token}x`)).toBeNull();
  });
});
