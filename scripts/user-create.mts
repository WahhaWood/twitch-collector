import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index";
import { users } from "../src/db/schema";
import { issueToken } from "../src/lib/users";

const { values } = parseArgs({ options: { name: { type: "string" }, admin: { type: "boolean" } } });
if (!values.name) {
  console.error('Usage: npm run user:create -- --name "Name" [--admin]');
  process.exit(1);
}

const { token, tokenHash } = issueToken();
const admin = values.admin ? { isAdmin: true } : {};
const [existing] = await db().select().from(users).where(eq(users.name, values.name));

if (existing) {
  await db().update(users).set({ tokenHash, ...admin }).where(eq(users.id, existing.id));
  console.log(`Token reissued for "${values.name}" (old token no longer works)`);
} else {
  await db().insert(users).values({ name: values.name, tokenHash, ...admin });
  console.log(`User "${values.name}" created`);
}
console.log(`Token (shown once): ${token}`);
