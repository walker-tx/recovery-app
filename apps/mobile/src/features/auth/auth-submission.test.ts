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

  const values = { email: "person@example.com", password: "password" };
  const first = guard.run(values, authenticate);
  const second = guard.run(values, authenticate);
  release();

  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.equal(calls, 1);
});

test("a failed submission unlocks retry without changing submitted values", async () => {
  const values = { email: "person@example.com", password: "password" };
  const guard = createSubmissionGuard();
  let receivedValues: typeof values | undefined;

  await assert.rejects(
    guard.run(values, async (submittedValues) => {
      receivedValues = submittedValues;
      throw new Error("provider detail");
    }),
  );

  assert.equal(receivedValues, values);
  assert.deepEqual(values, {
    email: "person@example.com",
    password: "password",
  });
  assert.equal(await guard.run(values, async () => undefined), true);
});
