import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

let cached: ReturnType<typeof create> | undefined;

// Use the Supabase SESSION pooler (port 5432): with the transaction pooler (6543) the second query
// on a warm connection hangs forever. Serverless instances multiply, so one connection each there;
// the long-running worker needs a few.
function create() {
  const max = process.env.VERCEL ? 1 : 3;
  return drizzle(postgres(env().DATABASE_URL, { prepare: false, max, idle_timeout: 20, connect_timeout: 15 }), { schema });
}

export function db() {
  cached ??= create();
  return cached;
}
