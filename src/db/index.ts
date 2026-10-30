import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { env } from "@/lib/env";

let cached: ReturnType<typeof create> | undefined;

function create() {
  return drizzle(neon(env().DATABASE_URL), { schema });
}

export function db() {
  cached ??= create();
  return cached;
}
