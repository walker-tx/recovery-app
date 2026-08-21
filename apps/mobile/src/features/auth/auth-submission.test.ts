import assert from "node:assert/strict";
import test from "node:test";

import { createSubmissionGuard } from "./auth-submission.ts";

test("two immediate submissions make one auth call", async () => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const guard = createSubmissionGuard();
  const authenticate = async () => {
    calls += 1;
    await pending;
  };

  const first = guard.run(authenticate);
  const second = guard.run(authenticate);
  release();

  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.equal(calls, 1);
});

test("a failed submission unlocks retry without changing entered values", async () => {
  const values = { email: "person@example.com", password: "long-enough" };
  const guard = createSubmissionGuard();

  await assert.rejects(guard.run(async () => {
    throw new Error("provider detail");
  }));

  assert.deepEqual(values, {
    email: "person@example.com",
    password: "long-enough",
  });
  assert.equal(await guard.run(async () => undefined), true);
});
