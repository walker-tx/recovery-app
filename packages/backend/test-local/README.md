# Fixture profile cleanup: offline/local overlay only

Scope: #25, profile-only cleanup of an explicitly owned synthetic fixture. This
module is outside `convex/` and is not included in the normal deployed function
set. No account deletion API, Counts purge, schema change, native automation, or
service orchestrator is added. Offline tests use mocked identities, not native
authentication evidence.

Provenance: branch `feat/25-native-fixture-cleanup` starts at Counts-capable
`a01e805`. `scripts/workos-staging.ts`, its Node test file, and the unchanged CLI
are inherited from `ddddba5`; only the helper and tests gain optional app cleanup.
No preflight/state files are needed for this bounded contract.

## Required runner integration (not implemented or deployed here)

1. Use a dedicated disposable local overlay/backend, never the running phone
   preview or a cloud deployment. Preserve the normal Convex tree. In the overlay
   only, stage this module as `convex/fixtureCleanup.ts` and rewrite its two
   `../convex/` imports to `./`. Do not edit generated files. A normal deployment
   must never include this module. Tests instead map this module into convex-test.
2. Validate staging configuration and the actual local server target before any
   side effect. The mutation requires `WORKOS_MODE=staging`, a non-production
   `NODE_ENV`, matching `WORKOS_CLIENT_ID` / `WORKOS_STAGING_CLIENT_ID`, no deploy
   key, and a strictly local/anonymous server-owned `RECOVERY_FIXTURE_DEPLOYMENT`.
   The runner must explicitly set this nonreserved variable in the dedicated
   server environment after validating its local target. `CONVEX_DEPLOYMENT` is
   CLI selection configuration, not a documented server builtin; only the
   unchanged runner-side `stagingGuard` uses it. Missing server deployment or
   built-in `CONVEX_CLOUD_URL` refuses; do not manufacture a cloud URL to bypass
   this check. If the local runtime cannot supply this binding, integration is
   blocked pending a supported local-server contract.
3. Only after the lifecycle validates the newly created WorkOS fixture's exact
   email (`recovery-smoke+<runId>@example.org`), external ID
   (`recovery-smoke:<runId>`), and `metadata.recoverySmokeRun`, and checks the
   password-auth response user ID equals that fixture ID, may the cleanup callback bind
   `RECOVERY_FIXTURE_BINDING` in the dedicated server environment. Its JSON shape
   is `{subject, runId, baseUrl}`. Use the validated fixture subject/run UUID and
   the exact built-in loopback HTTP origin with explicit port. Binding is trusted
   server configuration, never mutation arguments or an app-controlled write.
   Serialize fixture runs; clear stale bindings before starting another run.
4. The callback receives `{subject, runId, accessToken}` in memory. Use a real
   Convex SDK client authenticated with that token, call `fixtureCleanup:cleanup`
   with **only** `{runId}`, then independently query existing `profiles.getMine`
   with the same authenticated SDK client. Return `{status:'absent'}` only when
   that query returns null. Identity subject is always derived server-side using
   existing `requireWorkOSIdentity`; email/name never authorizes deletion.
5. Always clear the server binding in the callback's `finally`, after independent
   absence verification and before returning control to provider cleanup. Use
   bounded SDK/network operations and propagate any verification/binding-removal
   failure without secret-bearing error text. Do not log callback inputs, tokens,
   raw errors, or environment values. Runner owns deadlines and overlay teardown;
   both hook adapters own their transport deadlines. This helper does not
   implement cancellation/service orchestration; a never-settling hook would
   prevent finally cleanup, so adapters must bound and settle every operation.
6. `smoke(env, factory, appCleanup?, exercise?)` calls optional exercise only
   after real SDK authentication validates user ID and captures nonempty access
   and refresh tokens. `FixtureExercise` is
   `(fixture: { subject: string; runId: string; accessToken: string; email: string; password: string }) => Promise<void>`.
   Put native Paste/onboarding work in this fourth-argument adapter, **not** in a
   wrapper around `authenticateWithPassword`: that SDK method must return directly
   so the lifecycle captures its verified token before any native side effects.
   Credentials are memory-only, never logged or persisted. Exercise rejection
   yields fixed `EXERCISE_FAILED`, preserves token-bound app cleanup, and still
   runs provider cleanup. No raw exercise/provider error is exposed.
7. `smoke` calls optional app cleanup before provider session revocation/user
   deletion. Callback rejection or invalid outcome marks `appCleanup=failed` and
   overall non-OK, but provider cleanup still runs. Missing verified auth leaves
   it `not_attempted`, with the existing non-OK auth/ownership result. Omission
   preserves the SDK-only default shape/behavior. Report app absence, provider
   session revocation, and provider deletion separately; none implies the others.

The mutation refuses any Counts owned by the fixture, including when no profile
exists, and refuses duplicate profiles. It deletes at most one indexed profile;
other users and all Counts remain unchanged. Repeated absence is idempotent.

Installed API evidence: Convex 1.44.0 `src/server/api.ts` defines
`makeFunctionReference`; its generated-server template lists `CONVEX_CLOUD_URL`
as a built-in string. convex-test 0.0.56 module loading derives the root from
`_generated`, supporting the test-only import map. This does not prove a live
local server exposes its built-in target binding. The nonreserved deployment
attestation must be explicitly set by the trusted local runner, not inferred
from a CLI variable or supplied by an app caller.

## Offline checks

Run from the repository root through `mise exec -- sh -c`, with subprocess cwd
`.worktrees/native-fixture-cleanup/packages/backend`:

- `node --experimental-strip-types --test scripts/workos-staging.test.ts`
- `pnpm exec vitest run test-local/fixtureCleanup.test.ts convex/profiles.test.ts`
- `pnpm exec tsc --noEmit` (normal backend)
- Added files need a separate check because the existing tsconfig intentionally
  includes only `convex/**/*.ts`:
  `pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --module ESNext --moduleResolution Bundler --target ESNext --allowImportingTsExtensions --types node,vite/client scripts/workos-staging.ts scripts/workos-staging.test.ts scripts/workos-staging-cli.ts test-local/fixtureCleanup.ts test-local/fixtureCleanup.test.ts`


No fixture provisioning, deployment, or native acceptance has been exercised.
