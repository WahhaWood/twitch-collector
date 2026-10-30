// Saves the raw drops sources (inventory + campaigns found on live channels) for one account as a test fixture.
// They hold no tokens or user identity; review the file before committing anyway.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index";
import { twitchAccounts } from "../src/db/schema";
import { decrypt } from "../src/lib/crypto";
import { parseDrops } from "../src/lib/drops";
import { env } from "../src/lib/env";
import { fetchDropSources } from "../src/lib/sync";

const { values } = parseArgs({ options: { id: { type: "string" } } });
const id = Number(values.id);
if (!Number.isInteger(id)) {
  console.error("Usage: npm run drops:dump -- --id <account id>");
  process.exit(1);
}

const [account] = await db().select().from(twitchAccounts).where(eq(twitchAccounts.id, id));
if (!account?.accessTokenEnc) {
  console.error("Account not found or not connected");
  process.exit(1);
}
const sources = await fetchDropSources(decrypt(account.accessTokenEnc, env().TOKEN_ENC_KEY));
const out = "src/lib/__fixtures__/drops-sources.real.json";
writeFileSync(out, JSON.stringify(sources, null, 2) + "\n");
const parsed = parseDrops(sources.inventory, sources.campaigns);
const counts: Record<string, number> = {};
for (const p of parsed.progress) counts[p.status] = (counts[p.status] ?? 0) + 1;
console.log(`Saved ${out}: ${sources.campaigns.length} campaigns, ${parsed.drops.length} drops`, counts);
