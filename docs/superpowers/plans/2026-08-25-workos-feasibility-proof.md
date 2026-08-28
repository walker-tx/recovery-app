# WorkOS Feasibility Proof Implementation Plan

> **For the implementing agent:** Use the `executing-plans` skill to run this plan. Use an isolated Git worktree. Stop at each named checkpoint. Do not start the full auth migration.

**Goal:** Prove that WorkOS Emulate and WorkOS staging can support the approved local auth design before the repository removes Convex Auth.

**Architecture:** Build a temporary, backend-only proof around the official WorkOS SDK. Use WorkOS Emulate for deterministic provider tests. Use a conditional Convex custom-JWT configuration for a live local token test. Use one bounded WorkOS staging test with explicit credentials and cleanup. Keep the current Convex Auth configuration active when proof mode is off. Remove temporary public probes before the final commit.

**Technology:** `@workos-inc/node@10.11.0`, `@workos/emulate@0.9.0`, Convex `1.44.0`, Vitest `4.1.11`, Node `24.16.0`, pnpm `11.19.0`.

**Design source:** `docs/superpowers/specs/2026-08-22-workos-local-auth-design.md`

## Safety rules

- Keep Convex local-only. Do not run a cloud or production Convex deploy. Activate `convex-deploy-guard` before every sync or environment command. Mechanically fail unless the selected deployment is classified as local.
- Do not use WorkOS production credentials.
- Do not enable WorkOS email delivery.
- Do not print API keys, passwords, access tokens, refresh tokens, pending-authentication tokens, reset tokens, verification codes, or full email addresses outside the explicit local console proof.
- Use reserved `example.com` addresses for automated and staging test users.
- Delete staging test users in `finally` cleanup.
- Do not remove Convex Auth or change mobile code in this plan.
- Do not hand-edit `convex/_generated`. Use Convex code generation.
- If one required gate item fails, stop. Record the blocker. Do not weaken the design.

## Gate result

The proof passes only if all items pass:

1. The official SDK calls WorkOS Emulate through a custom API host.
2. Local Convex fetches the emulator JWKS.
3. Local Convex accepts a valid emulator access token.
4. Local Convex rejects the wrong issuer.
5. Local Convex rejects the wrong audience.
6. Refresh-token rotation works through a Convex action.
7. Password reset revokes all previous sessions.
8. WorkOS staging returns verification and reset data while email delivery is disabled.
9. Signup and recovery initiation can keep neutral public response shapes.

---

## Task 1: Create the isolated proof workspace

**Files:**

- Read: `AGENTS.md`
- Read: `docs/architecture.md`
- Read: `docs/superpowers/specs/2026-08-22-workos-local-auth-design.md`
- Read: `packages/backend/package.json`
- Modify later: `packages/backend/package.json`
- Modify later: `pnpm-lock.yaml`

### Step 1: Create a worktree

Use the `using-git-worktrees` skill. Create a worktree from the current branch. Do not work in the main checkout.

### Step 2: Verify the baseline

Run:

```sh
mise exec -- pnpm --filter @recovery/backend run check
mise exec -- pnpm --filter @recovery/backend exec vitest run convex/auth-policy.test.ts convex/profiles.test.ts
git status --short
```

Expected result:

- TypeScript passes.
- Current backend tests pass.
- The worktree is clean.

### Step 3: Confirm published package metadata

Run:

```sh
mise exec -- pnpm view @workos-inc/node@10.11.0 version engines --json
mise exec -- pnpm view @workos/emulate@0.9.0 version engines --json
```

Expected result:

- Exact versions exist.
- Both support Node `24.16.0`.

### Checkpoint 1: Dependency consent

Report the exact package changes:

```text
@workos-inc/node 10.11.0 -> backend dependency
@workos/emulate 0.9.0 -> backend development dependency
```

Get approval before the next task.

---

## Task 2: Prove the SDK and emulator boundary

**Files:**

- Modify: `packages/backend/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/backend/convex/workosFeasibilityClient.ts`
- Create: `packages/backend/convex/workosFeasibility.test.ts`

### Step 1: Write a failing SDK-construction test

Add a test that starts `createEmulator({ port: 0 })`. Parse `emulator.url`. Construct `WorkOS` with:

```ts
new WorkOS({
  apiKey: emulator.apiKey,
  clientId: "client_recovery_test",
  apiHostname: url.hostname,
  port: Number(url.port),
  https: url.protocol === "https:",
  maxRetries: 0,
});
```

Assert that the SDK calls the emulator health or user-management boundary. Do not assert on private SDK fields.

Run:

```sh
mise exec -- pnpm --filter @recovery/backend exec vitest run convex/workosFeasibility.test.ts
```

Expected result: FAIL because the dependencies and client factory do not exist.

### Step 2: Add the exact dependencies

Run:

```sh
mise exec -- pnpm --filter @recovery/backend add @workos-inc/node@10.11.0 --save-exact
mise exec -- pnpm --filter @recovery/backend add -D @workos/emulate@0.9.0 --save-exact
```

Do not update unrelated packages.

### Step 3: Add the narrow client factory

Implement a pure factory that accepts explicit configuration. It must not read environment variables in tests. It must set `maxRetries: 0` for deterministic proof tests. It must not log configuration.

Use this shape:

```ts
type WorkOSClientConfig = {
  apiKey: string;
  clientId: string;
  apiHostname: string;
  port?: number;
  https: boolean;
};

export function createWorkOSClient(config: WorkOSClientConfig): WorkOS;
```

### Step 4: Run the focused test

Run:

```sh
mise exec -- pnpm --filter @recovery/backend exec vitest run convex/workosFeasibility.test.ts
mise exec -- pnpm --filter @recovery/backend run check
```

Expected result: PASS.

---

## Task 3: Prove WorkOS provider behavior in the emulator

**Files:**

- Modify: `packages/backend/convex/workosFeasibility.test.ts`

### Step 1: Add a failing email-verification test

Seed a unique unverified password user. Authenticate with the password. Assert that WorkOS returns the documented email-verification-required state. Retrieve the verification object through the SDK. Submit its six-digit code with the pending-authentication token. Assert that WorkOS returns access and refresh tokens.

Do not print the code or token values.

Run the focused test and confirm RED before the full test logic exists.

### Step 2: Add refresh-rotation assertions

Use the first refresh token once. Assert that WorkOS returns a different refresh token. Reuse the old token. Assert that the emulator rejects it.

### Step 3: Add password-reset and revocation assertions

Create two active sessions for one user. Create a password-reset token. Reset the password. Assert:

- The old password fails.
- Both old refresh tokens fail.
- The new password signs in.
- The reset token cannot be replayed.

This proves WorkOS owns password replacement and old-session revocation.

**Known risk:** Source inspection of published `@workos/emulate@0.9.0` indicates that reset confirmation changes the password and consumes the reset record, but does not revoke existing sessions. Do not change the assertion or add an emulator-only revocation workaround. A failure here is a valid hard-gate result. Record it and stop.

### Step 4: Add cleanup

Close the emulator in `afterEach` or `finally`. Give each test its own emulator instance or deterministic reset boundary. Do not share refresh tokens between parallel tests.

### Step 5: Run focused checks

Run:

```sh
mise exec -- pnpm --filter @recovery/backend exec vitest run convex/workosFeasibility.test.ts
mise exec -- pnpm --filter @recovery/backend run check
```

Expected result:

- SDK, verification, refresh rotation, password change, and reset replay checks can pass.
- Old-session revocation can fail because of the known emulator limitation.

### Checkpoint 2: Emulator provider result

Report pass or fail for gate items 1 and 7. Do not report gate item 6 yet because Task 3 calls WorkOS directly, not through Convex. If old sessions remain valid, stop and write the failure report in Task 7. Do not run Tasks 4 through 6.

---

## Task 4: Prove neutral public result shaping

**Files:**

- Modify: `packages/backend/convex/workosFeasibility.test.ts`
- Do not create a production `workosPublicBoundary.ts` module during this proof.

### Step 1: Write failing table-driven tests

Cover these internal outcomes:

```text
new password account
existing password account
unverified password account
future Google-only account
future Apple-only account
unknown recovery account
rate limited
provider unavailable
```

For signup, every syntactically valid request must return only:

```ts
{ accepted: true, intentId: string }
```

For recovery, every syntactically valid request must return only:

```ts
{ accepted: true }
```

Assert that signup intent IDs have one public format for all outcomes. Do not put account state into the ID. Assert that public values contain no provider error, user ID, delivery state, code, token, or guidance category.

Write these as proof-only tests first. Confirm RED because no test helper shapes the results.

### Step 2: Add the smallest test-local boundary wrapper

Keep the wrapper in `workosFeasibility.test.ts`. It can create or accept a random opaque intent ID. It must catch the real emulator outcomes used by the tests and return only the approved public shape. It must not become production gateway code.

### Step 3: Run focused checks

Run:

```sh
mise exec -- pnpm --filter @recovery/backend exec vitest run convex/workosFeasibility.test.ts
mise exec -- pnpm --filter @recovery/backend run check
```

Expected result: PASS. This proves gate item 9 at the provider adapter boundary. It does not claim timing equality. Delete the test-local wrapper with other proof-only code if the gate fails.

---

## Task 5: Prove local Convex JWT validation

**Files:**

- Create: `packages/backend/convex/workosAuthConfig.ts`
- Modify: `packages/backend/convex/auth.config.ts`
- Create temporarily: `packages/backend/convex/workosIdentityProbe.ts`
- Create temporarily: `packages/backend/convex/workosRefreshProbe.ts`
- Create: `packages/backend/scripts/workos-local-jwt-proof.mts`
- Create: `packages/backend/scripts/tsconfig.json`
- Generate: `packages/backend/convex/_generated/*` through Convex only

### Step 1: Write config-policy tests first

Add plain tests for a configuration builder. Assert:

- Default mode returns the current Convex Auth provider.
- `emulator` mode returns one `customJwt` provider.
- The provider has the expected issuer, client-ID audience, JWKS URL, and `RS256`.
- Missing values fail closed.
- Unknown mode fails closed.
- Emulator and staging are never both returned.

Run the focused test. Confirm RED.

### Step 2: Implement conditional proof configuration

Keep the current configuration when proof mode is absent. Select one WorkOS provider only when the explicit proof mode is set. Do not put secrets in `auth.config.ts`. Use `satisfies AuthConfig`.

The proof mode must not enable Convex Auth and WorkOS together.

### Step 3: Add a temporary authenticated query

Add one public query with empty argument and narrow return validators. It must reject an unauthenticated caller. It returns only:

```ts
{ subject: string, issuer: string }
```

Do not return the raw token or all claims. This query exists only for the live proof.

### Step 4: Add a temporary refresh action

Add one Node action with narrow validators. It requires a valid WorkOS identity, accepts a refresh token, calls WorkOS, and returns only the rotated access and refresh tokens. It does not log arguments or results. It exists only to prove the approved server-secret boundary.

### Step 5: Add one orchestrating local proof driver

Use one process to own the complete sequence. The driver must:

1. Parse the selected deployment without printing its value. Fail unless it is local.
2. Start a primary emulator on a fixed free port selected before Convex sync.
3. Use a temporary RSA signing key.
4. Set a fixed test issuer.
5. Set the proof-mode issuer, audience, and JWKS values in the child process environment for `auth.config.ts`.
6. After local-target confirmation, set the emulator API configuration in the local Convex deployment environment for the temporary refresh action.
7. Run `convex dev --once` as a child process after the emulator is ready.
8. Seed or create one verified test user.
9. Obtain a valid access token and refresh token for the configured client ID.
10. Call the local Convex query with `ConvexHttpClient.setAuth`.
11. Assert that the returned subject matches the WorkOS user ID.
12. Call the temporary Convex refresh action. Assert token rotation and old-token rejection.
13. Obtain a token with a different client ID and assert Convex rejection.
14. Start a second emulator with the same signing key and a different issuer.
15. Obtain a token from it and assert Convex rejection by the primary configuration.
16. Redact all token values from output.
17. Restore default auth mode with a second local `convex dev --once` in `finally`.
18. Remove all temporary emulator values from the local Convex deployment environment in `finally`.
19. Close both emulators and remove the temporary RSA key in `finally`.

Do not commit the temporary RSA key. This single driver is the only owner of emulator ports and proof-mode environment values.

### Step 6: Type-check the driver

Create `packages/backend/scripts/tsconfig.json`. Extend the backend TypeScript settings and include `./**/*.mts`. Run:

```sh
mise exec -- pnpm --filter @recovery/backend exec tsc -p scripts/tsconfig.json --noEmit
```

Expected result: PASS. The normal backend check does not include `scripts/`, so this command is mandatory.

### Step 7: Run against local Convex only

Activate `convex-deploy-guard`. Mechanically classify the selected deployment from local configuration. Announce it. Do not continue unless it is local. The proof driver performs both the proof-mode sync and the default-mode restoration sync.

Run with a bounded timeout:

```sh
mise exec -- node --experimental-strip-types packages/backend/scripts/workos-local-jwt-proof.mts
```

Do not start a separate emulator. Do not run a separate proof-mode sync. The driver owns both operations. Do not add Tailscale, a tunnel, or TLS bypass unless a separate design is approved. If local Convex cannot fetch emulator JWKS, stop and report the exact network or protocol blocker.

### Step 8: Confirm default mode and remove probes

Confirm that the driver's `finally` restoration succeeded. If it did not, manually restore default mode only after `convex-deploy-guard` confirms the local target. Then delete `workosIdentityProbe.ts` and `workosRefreshProbe.ts`. Run Convex code generation. Do not hand-edit generated files.

Run:

```sh
mise exec -- pnpm --filter @recovery/backend run codegen
mise exec -- pnpm --filter @recovery/backend run check
mise exec -- pnpm --filter @recovery/backend exec vitest run convex/auth-policy.test.ts convex/profiles.test.ts
```

Expected result: PASS.

### Checkpoint 3: Local JWT result

Report pass or fail for gate items 2 through 5. Include the issuer, audience category, algorithm, and JWKS location. Do not include keys or tokens. If one item fails, stop and write the failure report.

---

## Task 6: Prove the WorkOS staging boundary

**Files:**

- Create temporarily: `packages/backend/convex/workosStagingProof.ts`
- Do not create or modify repository environment files with secrets.

### Step 1: Pause for staging prerequisites

Require explicit confirmation that the selected WorkOS environment is staging. Require these values outside Git:

```text
WORKOS_API_KEY
WORKOS_CLIENT_ID
```

Confirm in the WorkOS dashboard that default verification and password-reset email delivery is disabled. Do not proceed with a production key.

### Step 2: Write the bounded internal action

Create an `internalAction` that reads the staging API key and client ID from the local Convex environment. It performs the full bounded test inside Convex and returns only a redacted object of boolean checks. It must not accept an email, password, API key, code, or token as an argument.

Use a unique reserved address such as:

```text
recovery-proof+<random>@example.com
```

The script must:

1. Create an unverified password user.
2. Authenticate with the password and capture the verification-required error.
3. Retrieve the email-verification object.
4. Assert that a six-digit code and expiry exist without printing them.
5. Complete email verification and assert that tokens exist.
6. Decode the access token only inside the action. Assert the expected issuer, audience, and subject without returning claim values.
7. Refresh once. Assert rotation and rejection of the old refresh token.
8. Create a second active session.
9. Create a password-reset object.
10. Assert that a reset token and expiry exist without printing them.
11. Reset the password.
12. Assert that both pre-reset refresh tokens fail.
13. Assert that reset-token replay fails.
14. Delete the staging test user in `finally`.

Use `maxRetries: 0` so failures are bounded and visible. Mask the test email in normal output. Never print WorkOS response bodies.

### Step 3: Run through local Convex with a short timeout

Activate `convex-deploy-guard`. Confirm and announce the local target. Set staging secrets only in the local Convex deployment environment. Sync staging proof mode to local Convex, then invoke the internal action with the Convex CLI.

Representative invocation:

```sh
mise exec -- pnpm --filter @recovery/backend exec convex run workosStagingProof:run
```

Expected result: PASS with redacted boolean checks only. Restore default auth mode, remove local staging secrets, delete `workosStagingProof.ts`, run code generation, and sync the restored local backend in the immediate cleanup step. Do not call WorkOS staging directly from a standalone repository script.

If credentials are not available, report the gate as blocked. Do not call the milestone complete.

### Checkpoint 4: Staging result

Report pass, fail, or blocked for gate item 8. Confirm that cleanup succeeded. Do not include the test email, user ID, token, code, or API key.

---

## Task 7: Record the result and restore a safe repository state

**Files:**

- Create: `docs/workos-feasibility-report.md`
- Delete: `packages/backend/scripts/workos-local-jwt-proof.mts` if it has no continuing test value
- Delete: `packages/backend/scripts/tsconfig.json` if no proof script remains
- Confirm deleted: `packages/backend/convex/workosIdentityProbe.ts`
- Confirm deleted: `packages/backend/convex/workosRefreshProbe.ts`
- Confirm deleted: `packages/backend/convex/workosStagingProof.ts`
- Confirm no production `workosPublicBoundary.ts` module was added
- Review: `packages/backend/package.json`
- Review: `pnpm-lock.yaml`
- Review: `packages/backend/convex/auth.config.ts`

### Step 1: Write the report

Record:

- Date and branch.
- Exact package versions.
- Local Convex classification.
- Each gate item as pass, fail, or blocked.
- Commands that produced evidence.
- Redacted behavior evidence.
- Any emulator difference from staging.
- Final recommendation.

Do not record secrets or sensitive provider payloads.

### Step 2: Apply the pass or fail rule

If all items pass:

- Keep the narrow reusable WorkOS client factory and deterministic emulator tests.
- Keep conditional configuration only if default mode still preserves the current app and the configuration has direct value in the approved migration.
- Keep the exact dependency changes uncommitted until the user approves the full migration dependency change.
- Recommend the full WorkOS migration plan.

If one item fails or is blocked:

- Remove proof-only dependencies and lockfile changes unless they are needed to reproduce the blocker.
- Remove conditional WorkOS auth configuration.
- Restore the current Convex Auth configuration.
- Remove all proof-only boundary helpers, probes, actions, and scripts.
- Keep only the report and safe deterministic evidence that explains the blocker.
- Return to design.

### Step 3: Run final verification

Run:

```sh
git diff --check
mise exec -- pnpm --filter @recovery/backend exec vitest run convex/auth-policy.test.ts convex/profiles.test.ts
mise exec -- pnpm --filter @recovery/backend run check
git status --short
```

If package changes remain after a passed proof, also run:

```sh
mise exec -- pnpm install --frozen-lockfile
```

Expected result:

- Existing backend tests pass.
- TypeScript passes.
- The current app is not left in a half-migrated state.
- The report matches the evidence.

### Checkpoint 5: User decision

Present the report. Ask the user to approve or reject the exact WorkOS dependency and configuration changes. Do not begin the full migration in the same step.

## Explicit stop conditions

Stop immediately if:

- The selected Convex deployment is not local.
- The WorkOS environment is production.
- WorkOS email delivery cannot stay disabled.
- The SDK cannot target the emulator.
- Local Convex cannot fetch emulator JWKS without an unapproved tunnel or trust bypass.
- Convex accepts a wrong issuer or audience.
- Old refresh tokens remain valid after password reset.
- Staging cannot return verification or reset credentials with email disabled.
- Neutral initiation requires account state in the public response.
- A test would print or commit a secret or token.
