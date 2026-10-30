import { describe, expect, it } from "vitest";
import { lastUrl, LOGIN_RE, minuteWatchedBody } from "./watch";

describe("lastUrl", () => {
  it("takes the lowest quality from a master playlist", () => {
    const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
https://video.example/1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=160000,RESOLUTION=284x160
https://video.example/160p.m3u8
`;
    expect(lastUrl(master)).toBe("https://video.example/160p.m3u8");
  });

  it("takes the newest chunk from a media playlist and handles empty ones", () => {
    expect(lastUrl("#EXTM3U\n#EXTINF:2.000,live\nhttps://c.example/1.ts\n#EXTINF:2.000,live\nhttps://c.example/2.ts\n")).toBe(
      "https://c.example/2.ts",
    );
    expect(lastUrl("#EXTM3U\n")).toBeNull();
  });
});

describe("minuteWatchedBody", () => {
  it("encodes one minute-watched event as base64 JSON", () => {
    const body = minuteWatchedBody({ userId: "1", channelId: "2", login: "chan", broadcastId: "3" });
    const decoded = JSON.parse(Buffer.from(body.get("data")!, "base64").toString());
    expect(decoded).toEqual([
      {
        event: "minute-watched",
        properties: { channel_id: "2", broadcast_id: "3", player: "site", user_id: "1", live: true, channel: "chan" },
      },
    ]);
  });

  it("adds the game when known", () => {
    const body = minuteWatchedBody({ userId: "1", channelId: "2", login: "chan", broadcastId: "3", game: { id: "9", name: "Game" } });
    const [{ properties }] = JSON.parse(Buffer.from(body.get("data")!, "base64").toString());
    expect(properties).toMatchObject({ game: "Game", game_id: "9" });
  });
});

describe("LOGIN_RE", () => {
  it("accepts Twitch logins only", () => {
    expect(LOGIN_RE.test("some_streamer42")).toBe(true);
    expect(LOGIN_RE.test("a")).toBe(false);
    expect(LOGIN_RE.test("bad name")).toBe(false);
    expect(LOGIN_RE.test('x") { id }')).toBe(false);
  });
});
