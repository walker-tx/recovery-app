import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createUser(t: ReturnType<typeof convexTest>, email: string) {
  return await t.run(async (ctx) => await ctx.db.insert("users", { email }));
}

function asUser(t: ReturnType<typeof convexTest>, userId: string) {
  return t.withIdentity({ subject: `${userId}|test-session` });
}

describe("profiles", () => {
  test("rejects unauthenticated reads and writes", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.profiles.getMine, {})).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(
      t.mutation(api.profiles.complete, { displayName: "Taylor" }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  test("creates, returns, and updates only the authenticated user's profile", async () => {
    const t = convexTest(schema, modules);
    const firstUserId = await createUser(t, "first@example.com");
    const secondUserId = await createUser(t, "second@example.com");
    const firstUser = asUser(t, firstUserId);
    const secondUser = asUser(t, secondUserId);

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
    await expect(secondUser.query(api.profiles.getMine, {})).resolves.toEqual({
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
    const publicProfile = await firstUser.query(api.profiles.getMine, {});
    expect(publicProfile).toEqual({
      displayName: "Taylor Reed",
      onboardingComplete: true,
    });
    expect(publicProfile).not.toHaveProperty("ownerId");
    expect(publicProfile).not.toHaveProperty("email");
    expect(publicProfile).not.toHaveProperty("_id");
    expect(publicProfile).not.toHaveProperty("_creationTime");

    const storedProfiles = await t.run(async (ctx) => await ctx.db.query("profiles").collect());
    expect(storedProfiles).toHaveLength(2);
    expect(storedProfiles.map(({ ownerId }) => ownerId)).toEqual(
      expect.arrayContaining([firstUserId, secondUserId]),
    );
  });

  test("rejects invalid profile names without persisting a profile", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUser(t, "person@example.com");
    const user = asUser(t, userId);

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
