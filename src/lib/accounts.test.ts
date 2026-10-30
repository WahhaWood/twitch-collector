import { QueryBuilder } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { twitchAccounts } from "@/db/schema";
import { accountIdParam, isCronAuthorized, ownedAccount } from "./accounts";

describe("ownedAccount", () => {
  it("filters by both account id and owner", () => {
    const { sql, params } = new QueryBuilder().select().from(twitchAccounts).where(ownedAccount(42, 7)).toSQL();
    expect(sql).toMatch(/"twitch_accounts"\."id" = \$1 and "twitch_accounts"\."user_id" = \$2/);
    expect(params).toEqual([7, 42]);
  });
});

describe("accountIdParam", () => {
  it("accepts positive integers only", async () => {
    expect(await accountIdParam(Promise.resolve({ id: "12" }))).toBe(12);
    for (const id of ["0", "-1", "1.5", "abc", ""]) expect(await accountIdParam(Promise.resolve({ id }))).toBeNull();
  });
});

describe("isCronAuthorized", () => {
  const secret = "cron-secret-0123456789";
  it("requires the exact bearer secret", () => {
    expect(isCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(isCronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isCronAuthorized(secret, secret)).toBe(false);
    expect(isCronAuthorized(null, secret)).toBe(false);
  });
});
