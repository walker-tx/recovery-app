import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { UserIdentity } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requireWorkOSIdentity } from "./workosIdentity";
import {
  findGetUserIdentityUsages,
  sourceUsesGetUserIdentity,
} from "./workosIdentitySourceContract.testHelper";

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

it("centralizes protected identity reads in workosIdentity.ts", () => {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  expect(
    findGetUserIdentityUsages({
      rootDirectory: directory,
      allowedFile: join(directory, "workosIdentity.ts"),
    }),
  ).toEqual([]);
});

describe("WorkOS identity source-contract detection", () => {
  it.each([
    ["different context variable", "session.auth.getUserIdentity()"],
    ["call whitespace", "ctx.auth.getUserIdentity    ()"],
    ["optional chaining", "ctx?.auth?.getUserIdentity?.()"],
    ["computed access", 'auth["getUserIdentity"]()'],
    ["destructuring", "const { getUserIdentity: readIdentity } = auth"],
  ])("detects %s", (_case, source) => {
    expect(sourceUsesGetUserIdentity(source)).toBe(true);
  });

  it("ignores comments and string contents", () => {
    expect(
      sourceUsesGetUserIdentity(
        '// getUserIdentity\nconst label = "getUserIdentity";',
      ),
    ).toBe(false);
  });

  it("recursively catches nested production files while excluding tests and generated code", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "workos-identity-guard-"));
    const nestedDirectory = join(rootDirectory, "nested");
    const generatedDirectory = join(rootDirectory, "_generated");
    const allowedFile = join(rootDirectory, "workosIdentity.ts");

    try {
      mkdirSync(nestedDirectory);
      mkdirSync(generatedDirectory);
      writeFileSync(allowedFile, "ctx.auth.getUserIdentity()");
      writeFileSync(
        join(nestedDirectory, "protected.ts"),
        "const { getUserIdentity } = auth",
      );
      writeFileSync(
        join(nestedDirectory, "protected.test.ts"),
        "otherAuth.getUserIdentity()",
      );
      writeFileSync(
        join(generatedDirectory, "server.ts"),
        "otherAuth.getUserIdentity()",
      );

      expect(
        findGetUserIdentityUsages({ rootDirectory, allowedFile }),
      ).toEqual([join("nested", "protected.ts")]);
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
