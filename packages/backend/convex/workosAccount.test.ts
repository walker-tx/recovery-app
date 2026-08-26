import { readFileSync } from "node:fs";

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import schema from "./schema.ts";

const modules = import.meta.glob("./**/*.ts");
const clientId = "client_01ABC123";
const issuer = `https://api.workos.com/user_management/${clientId}`;

const upsertSnapshot = makeFunctionReference<
  "mutation",
  { ownerSubject: string; email: string; updatedAt: number },
  null
>("workosAccount:upsertWorkOSIdentitySnapshot");
const getCurrentAccount = makeFunctionReference<
  "query",
  Record<string, never>,
  { userId: string; email: string }
>("workosAccount:getCurrentWorkOSAccount");

function asWorkOSUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    issuer,
    client_id: clientId,
    tokenIdentifier: `${issuer}|${subject}`,
  });
}

describe("workosAccount", () => {
  beforeEach(() => vi.stubEnv("WORKOS_CLIENT_ID", clientId));
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the public account contract on the shared identity helper and subject index", () => {
    const source = readFileSync(new URL("./workosAccount.ts", import.meta.url), "utf8");
    expect(source).toContain("requireWorkOSIdentity(ctx)");
    expect(source).toContain('.withIndex("by_subject"');
    expect(source).toContain("returns: accountValue");
    expect(source).toContain("return { userId: subject, email: snapshot.email }");
  });

  it("upserts one normalized snapshot per WorkOS subject", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(upsertSnapshot, {
      ownerSubject: "user_123",
      email: " First@Example.COM ",
      updatedAt: 10,
    });
    await t.mutation(upsertSnapshot, {
      ownerSubject: "user_123",
      email: "latest@example.com",
      updatedAt: 20,
    });

    await expect(asWorkOSUser(t, "user_123").query(getCurrentAccount, {})).resolves.toEqual({
      userId: "user_123",
      email: "latest@example.com",
    });
    const rows = await t.run((ctx) => ctx.db.query("workosIdentitySnapshots").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ownerSubject: "user_123",
      email: "latest@example.com",
      updatedAt: 20,
    });
  });

  it("isolates two users by the authenticated WorkOS subject", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(upsertSnapshot, {
      ownerSubject: "user_first",
      email: "first@example.com",
      updatedAt: 10,
    });
    await t.mutation(upsertSnapshot, {
      ownerSubject: "user_second",
      email: "second@example.com",
      updatedAt: 11,
    });

    await expect(asWorkOSUser(t, "user_first").query(getCurrentAccount, {})).resolves.toEqual({
      userId: "user_first",
      email: "first@example.com",
    });
    await expect(asWorkOSUser(t, "user_second").query(getCurrentAccount, {})).resolves.toEqual({
      userId: "user_second",
      email: "second@example.com",
    });
  });

  it("fails closed when the authenticated subject has no snapshot", async () => {
    const t = convexTest(schema, modules);

    await expect(asWorkOSUser(t, "user_missing").query(getCurrentAccount, {})).rejects.toMatchObject({
      data: { code: "WORKOS_IDENTITY_SNAPSHOT_MISSING" },
    });
  });

  it("detects duplicate subject rows instead of claiming uniqueness", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("workosIdentitySnapshots", {
        ownerSubject: "user_duplicate",
        email: "one@example.com",
        updatedAt: 1,
      });
      await ctx.db.insert("workosIdentitySnapshots", {
        ownerSubject: "user_duplicate",
        email: "two@example.com",
        updatedAt: 2,
      });
    });

    await expect(
      t.mutation(upsertSnapshot, {
        ownerSubject: "user_duplicate",
        email: "new@example.com",
        updatedAt: 3,
      }),
    ).rejects.toMatchObject({ data: { code: "WORKOS_IDENTITY_SNAPSHOT_DUPLICATE" } });
  });
});
