import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { UserIdentity } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => vi.stubEnv("WORKOS_MODE", "staging"));
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

describe('local identity binding', () => {
  afterEach(() => vi.unstubAllEnvs());
  const generation = '12345678-1234-4234-8234-123456789abc';
  const localClient = `client_local${generation.replaceAll('-', '')}`;
  const localIssuer = `https://local-workos.invalid/instances/${generation}`;
  it.each([{}, { issuer: issuer }, { client_id: clientId }, { subject: ' ' }])('validates local claims %j', async (overrides) => {
    const env = {
      WORKOS_MODE: 'local', WORKOS_CLIENT_ID: localClient,
      LOCAL_AUTH_STACK_ID: '87654321-1234-4234-8234-123456789abc',
      LOCAL_AUTH_PROVIDER_GENERATION: generation,
      WORKOS_ISSUER: localIssuer, WORKOS_AUDIENCE: localClient,
      WORKOS_JWKS_URL: 'http://127.0.0.1:6100/jwks', WORKOS_API_URL: 'http://127.0.0.1:6100',
      CONVEX_CLOUD_URL: 'http://127.0.0.1:6101', CONVEX_SITE_URL: 'http://127.0.0.1:6102', CONVEX_DEPLOY_KEY: '',
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const result = requireWorkOSIdentity(contextWith(identity({ issuer: localIssuer, client_id: localClient, ...overrides })));
    if (Object.keys(overrides).length === 0) await expect(result).resolves.toEqual({ subject: 'user_123' });
    else await expect(result).rejects.toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
  });
});
