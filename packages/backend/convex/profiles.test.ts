import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const clientId = "client_01ABC123";
const issuer = `https://api.workos.com/user_management/${clientId}`;
let previousClientId: string | undefined;

function asWorkOSUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, issuer, client_id: clientId });
}

beforeAll(() => {
  previousClientId = process.env.WORKOS_CLIENT_ID;
  process.env.WORKOS_CLIENT_ID = clientId;
});

afterAll(() => {
  if (previousClientId === undefined) {
    delete process.env.WORKOS_CLIENT_ID;
  } else {
    process.env.WORKOS_CLIENT_ID = previousClientId;
  }
});

describe("WorkOS-owned profiles", () => {
  test("rejects unauthenticated reads and writes", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.profiles.getMine, {})).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(
      t.mutation(api.profiles.complete, { displayName: "Taylor" }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  test("creates, returns, updates, and isolates profiles by validated WorkOS subject", async () => {
    const t = convexTest(schema, modules);
    const firstUser = asWorkOSUser(t, "user_first");
    const secondUser = asWorkOSUser(t, "user_second");

    await expect(firstUser.query(api.profiles.getMine, {})).resolves.toBeNull();
    await expect(
      firstUser.mutation(api.profiles.complete, {
        displayName: "  Taylor R.  ",
        firstName: "  Taylor  ",
      }),
    ).resolves.toEqual({
      displayName: "Taylor R.",
      firstName: "Taylor",
      onboardingComplete: true,
    });
    await expect(
      secondUser.mutation(api.profiles.complete, {
        displayName: "Morgan Lee",
        firstName: "Morgan",
      }),
    ).resolves.toEqual({
      displayName: "Morgan Lee",
      firstName: "Morgan",
      onboardingComplete: true,
    });

    await expect(
      firstUser.mutation(api.profiles.complete, {
        displayName: "Taylor Reed",
        firstName: "",
      }),
    ).resolves.toEqual({
      displayName: "Taylor Reed",
      onboardingComplete: true,
    });
    await expect(secondUser.query(api.profiles.getMine, {})).resolves.toEqual({
      displayName: "Morgan Lee",
      firstName: "Morgan",
      onboardingComplete: true,
    });

    const storedProfiles = await t.run(
      async (ctx) => await ctx.db.query("profiles").collect(),
    );
    expect(storedProfiles).toHaveLength(2);
    expect(storedProfiles.map(({ ownerSubject }) => ownerSubject)).toEqual(
      expect.arrayContaining(["user_first", "user_second"]),
    );
    expect(storedProfiles.every((profile) => !("ownerId" in profile))).toBe(
      true,
    );
  });

  test("rejects mismatched and missing WorkOS client identities", async () => {
    const t = convexTest(schema, modules);
    const wrongClient = t.withIdentity({
      subject: "user_wrong",
      issuer,
      client_id: "client_other",
    });
    const missingClient = t.withIdentity({
      subject: "user_missing_client",
      issuer,
    });

    await expect(
      wrongClient.query(api.profiles.getMine, {}),
    ).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(
      missingClient.query(api.profiles.getMine, {}),
    ).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  test("rejects invalid profile names without persisting a profile", async () => {
    const t = convexTest(schema, modules);
    const user = asWorkOSUser(t, "user_person");

    await expect(
      user.mutation(api.profiles.complete, { displayName: "   " }),
    ).rejects.toMatchObject({ data: { code: "INVALID_PROFILE" } });
    await expect(
      user.mutation(api.profiles.complete, { displayName: "x".repeat(81) }),
    ).rejects.toMatchObject({ data: { code: "INVALID_PROFILE" } });
    await expect(
      user.mutation(api.profiles.complete, {
        displayName: "Taylor",
        firstName: "x".repeat(51),
      }),
    ).rejects.toMatchObject({ data: { code: "INVALID_PROFILE" } });
    await expect(user.query(api.profiles.getMine, {})).resolves.toBeNull();
  });
});
