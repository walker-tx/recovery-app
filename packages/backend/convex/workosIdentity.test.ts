import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { UserIdentity } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requireWorkOSIdentity } from "./workosIdentity";

const clientId = "client_01ABC123";
const issuer = `https://api.workos.com/user_management/${clientId}`;

function contextWith(identity: UserIdentity | null) {
  return {
    auth: { getUserIdentity: vi.fn().mockResolvedValue(identity) },
  };
}

function identity(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    tokenIdentifier: `${issuer}|user_123`,
    subject: "user_123",
    issuer,
    client_id: clientId,
    email: "person@example.com",
    ...overrides,
  };
}

describe("requireWorkOSIdentity", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns only the validated subject", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", clientId);

    await expect(requireWorkOSIdentity(contextWith(identity()))).resolves.toEqual({
      subject: "user_123",
    });
  });

  it("rejects a missing identity", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", clientId);
    await expect(requireWorkOSIdentity(contextWith(null))).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  it.each([undefined, "client_other", 123])(
    "rejects invalid client_id claim %s",
    async (claim) => {
      vi.stubEnv("WORKOS_CLIENT_ID", clientId);
      await expect(
        requireWorkOSIdentity(
          contextWith(identity({ client_id: claim } as Partial<UserIdentity>)),
        ),
      ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    },
  );

  it("rejects an issuer other than the exact client-scoped issuer", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", clientId);
    await expect(
      requireWorkOSIdentity(
        contextWith(identity({ issuer: "https://api.workos.com/user_management" })),
      ),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  it.each([undefined, "", "client"])(
    "fails closed for invalid configured client ID %s",
    async (configuredClientId) => {
      vi.stubEnv("WORKOS_CLIENT_ID", configuredClientId ?? "");
      await expect(
        requireWorkOSIdentity(contextWith(identity())),
      ).rejects.toThrow("WORKOS_CLIENT_ID");
    },
  );
});

it("centralizes direct protected identity reads in workosIdentity.ts", () => {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const directCall = ["ctx", "auth", "getUserIdentity"].join(".") + "(";
  const offenders = readdirSync(directory)
    .filter(
      (name) =>
        name.endsWith(".ts") &&
        !name.endsWith(".test.ts") &&
        name !== "workosIdentity.ts",
    )
    .filter((name) =>
      readFileSync(new URL(name, import.meta.url), "utf8").includes(directCall),
    );

  expect(offenders).toEqual([]);
});
