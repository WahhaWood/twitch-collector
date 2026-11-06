import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

let cached: ReturnType<typeof create> | undefined;

// Supabase pooler (transaction mode) has no prepared statements; keep the pool tiny:
// serverless instances multiply, the long-running worker needs one connection.
function create() {
  return drizzle(postgres(env().DATABASE_URL, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15 }), { schema });
}

export function db() {
  cached ??= create();
  return cached;
}
