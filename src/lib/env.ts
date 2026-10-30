import { z } from "zod";
import { WATCH_CLIENT_ID } from "./watch-token";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  TOKEN_ENC_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes in base64"),
  // Twitch TV app client: the only kind of token gql.twitch.tv accepts (see Plan.md, GQL spike).
  TWITCH_WATCH_CLIENT_ID: z.string().min(1).default(WATCH_CLIENT_ID),
  TWITCH_GQL_CLIENT_ID: z.string().min(1).default("ue6666qo983tsx6so1t0vnawi233wa"),
  CRON_SECRET: z.string().min(16),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
