import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const clientId = "client_01ABC123";
const issuer = `https://api.workos.com/user_management/${clientId}`;

const completeWithOwnerArgument = makeFunctionReference<
  "mutation",
  { displayName: string; ownerSubject: string },
  { displayName: string; onboardingComplete: boolean }
>("profiles:complete");

function asWorkOSUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, issuer, client_id: clientId });
}

describe("WorkOS authorization after cutover", () => {
  beforeEach(() => vi.stubEnv("WORKOS_CLIENT_ID", clientId));
  afterEach(() => vi.unstubAllEnvs());

  test("rejects unauthenticated, wrong-client, and missing-client identities at the protected profile boundary", async () => {
    const t = convexTest(schema, modules);
    const identities = [
      t,
      t.withIdentity({ subject: "user_wrong", issuer, client_id: "client_other" }),
      t.withIdentity({ subject: "user_missing", issuer }),
    ];

    for (const identity of identities) {
      await expect(identity.query(api.profiles.getMine, {})).rejects.toMatchObject({
        data: { code: "UNAUTHENTICATED" },
      });
    }
  });

  test("keeps onboarding profiles scoped to matching-client users A and B", async () => {
    const t = convexTest(schema, modules);
    const userA = asWorkOSUser(t, "user_a");
    const userB = asWorkOSUser(t, "user_b");

    await expect(userA.query(api.profiles.getMine, {})).resolves.toBeNull();
    await expect(userB.query(api.profiles.getMine, {})).resolves.toBeNull();
    await expect(
      userA.mutation(api.profiles.complete, { displayName: "User A", firstName: "A" }),
    ).resolves.toEqual({ displayName: "User A", firstName: "A", onboardingComplete: true });
    await expect(
      userB.mutation(api.profiles.complete, { displayName: "User B" }),
    ).resolves.toEqual({ displayName: "User B", onboardingComplete: true });

    await expect(userA.query(api.profiles.getMine, {})).resolves.toEqual({
      displayName: "User A",
      firstName: "A",
      onboardingComplete: true,
    });
    await expect(userB.query(api.profiles.getMine, {})).resolves.toEqual({
      displayName: "User B",
      onboardingComplete: true,
    });

    const profiles = await t.run((ctx) => ctx.db.query("profiles").collect());
    expect(profiles).toHaveLength(2);
    expect(profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerSubject: "user_a", displayName: "User A" }),
      expect.objectContaining({ ownerSubject: "user_b", displayName: "User B" }),
    ]));
  });

  test("narrow public validators refuse caller-selected owners", async () => {
    const t = convexTest(schema, modules);
    const userA = asWorkOSUser(t, "user_a");

    await expect(userA.mutation(completeWithOwnerArgument, {
      displayName: "Impersonated",
      ownerSubject: "user_b",
    })).rejects.toThrow(/unexpected field `ownerSubject`/i);
    await expect(userA.query(api.profiles.getMine, {})).resolves.toBeNull();
  });
});
