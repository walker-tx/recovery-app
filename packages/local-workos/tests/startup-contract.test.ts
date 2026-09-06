import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider } from "../src/provider.ts";

test("bootstrap-owned generation and port survive restart and reject mismatched state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workos-startup-"));
  const generation = randomUUID();
  const options = { database: join(dir, "state.sqlite"), apiKey: "sk_test_startup", providerGeneration: generation };
  let provider: Awaited<ReturnType<typeof startProvider>> | undefined;
  try {
    provider = await startProvider(options);
    assert.equal(provider.issuer, `https://local-workos.invalid/instances/${generation}`);
    assert.equal(provider.providerGeneration, generation);
    const port = provider.port;
    await provider.close();
    provider = undefined;
    await assert.rejects(startProvider({ ...options, providerGeneration: randomUUID() }), /generation/i);
    provider = await startProvider({ ...options, port });
    assert.equal(provider.port, port);
    assert.equal(provider.issuer, `https://local-workos.invalid/instances/${generation}`);
    await assert.rejects(startProvider({ ...options, port }), (error: unknown) =>
      error instanceof Error && (error.cause as NodeJS.ErrnoException)?.code === "EADDRINUSE");
  } finally {
    await provider?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid explicit startup generation and ports are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workos-startup-invalid-"));
  const options = { database: join(dir, "state.sqlite"), apiKey: "sk_test_startup" };
  try {
    for (const port of [-1, 65536, 0.5, NaN]) {
      await assert.rejects(async () => {
        const unexpected = await startProvider({ ...options, port });
        await unexpected.close();
      }, /port/i);
    }
    await assert.rejects(async () => {
      const unexpected = await startProvider({ ...options, providerGeneration: "not-a-uuid" });
      await unexpected.close();
    }, /generation/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
