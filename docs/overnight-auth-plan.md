# Overnight auth implementation plan

## Objective

Build and validate a local-first password authentication and profile-onboarding flow based on the Recovery Tracker auth artifact, using the repository-owned React Native design system, Expo Router, and the pinned Convex Auth version. Work must finish in reviewable, validated commits and remain recoverable after a provider or process interruption.

Artifact reference: <https://claude.ai/code/artifact/00dd61ff-dd96-4c83-abed-5e88ffbd2638>

## Fixed product decisions

- Password authentication ships before social authentication. Apple and Google are deferred.
- Signup verification and password reset use six-digit codes entered in the app.
- Local development uses a console email provider. Codes are generated normally and printed only in local Convex logs; verification is never bypassed and no universal code exists.
- Resend is the intended future delivery provider, but Resend integration, credentials, and templates are out of scope for this run.
- Unauthenticated UI must never reveal whether an account exists or which provider it uses. The artifact's provider-specific "Account found" screen is omitted.
- A successful password reset signs out all other sessions. The artifact's optional session-revocation toggle is omitted.
- Groups, invitations, recovery-domain data, linked-method management, and production deployment are deferred.
- Only a local Convex deployment is allowed. No cloud development or production deployment may be selected or changed.

## Scope

### Included

- Auth restoration without flashing the wrong route.
- Expo Router partitions for unauthenticated, onboarding, and authenticated users.
- Artifact-aligned welcome, sign-in, sign-up, verification, reset-request, reset-code, new-password, and profile screens.
- Server-enforced normalized email and a minimum password length of ten characters.
- Cryptographically generated six-digit, single-use signup and reset codes.
- Code expiry and resend behavior supported by the installed auth package.
- Console-only local delivery that fails closed unless explicitly enabled in the local Convex environment.
- Server-owned profile data: display name, optional first name, and onboarding completion.
- Protected authenticated placeholder home and sign-out.
- Sanitized, non-color-only errors and accessible busy/disabled states.
- Backend ownership tests and the smallest useful mobile behavior tests supported by the existing toolchain.

### Excluded

- Apple, Google, or any other OAuth provider.
- Provider discovery or provider-specific unauthenticated errors.
- Adding, listing, changing, or removing authentication methods.
- Resend or any real email delivery.
- Groups, membership, invitations, invite codes, join policies, or recovery tracking.
- EAS, CI, a web app, native distribution, production identifiers, and production deployment.
- Hand edits to `packages/backend/convex/_generated`.

## Architecture contract

- Convex Auth owns session identity, restoration, sign-in, verification, reset, and sign-out.
- `ConvexAuthProvider` continues to persist tokens through `expo-secure-store`.
- Expo Router owns route identity and protected route availability.
- Convex owns profile and onboarding completion data.
- Each screen owns only transient form values, validation, pending state, and safe presentation errors.
- Routes compose feature screens; auth behavior lives under `apps/mobile/src/features/auth`, and profile onboarding lives under `apps/mobile/src/features/onboarding`.
- Shared UI remains independent of Expo Router, Convex, and feature modules.
- Every new public Convex function has argument and return validators, derives identity server-side, authorizes the resource, and uses an index for normal lookup.
- Do not introduce a global client store, form library, schema library, or broad barrel export.

## Target route shape

```text
apps/mobile/src/app/
  _layout.tsx
  (auth)/
    _layout.tsx
    index.tsx
    sign-in.tsx
    sign-up.tsx
    verify-email.tsx
    forgot-password.tsx
    reset-code.tsx
    reset-password.tsx
  (onboarding)/
    _layout.tsx
    profile.tsx
  (app)/
    _layout.tsx
    index.tsx
```

The exact number of reset routes may be reduced if the installed Convex Auth API supports a clearer state machine without losing deep-link-free navigation or independent form lifecycles. Keep route files composition-only.

## Local email policy

- Use the installed `@convex-dev/auth` `0.0.95` public/provider APIs; verify exact signatures against installed source and types before editing.
- Generate six numeric digits with a cryptographically secure source. Do not use `Math.random`.
- Never return the code to the mobile client or expose it from a public Convex function.
- Print recipient, purpose, code, and expiration only from the explicitly enabled local console delivery provider.
- A resend replaces the previous code. Codes remain single-use and are verified with the matching normalized email.
- Prefer a ten-minute expiration and a sixty-second client resend cooldown when supported. Do not claim server enforcement that the package does not provide.
- Require an explicit local Convex environment value such as `AUTH_EMAIL_DELIVERY=console`. Missing or unknown delivery configuration must fail closed.
- Before implementing the guard, inspect the pinned Convex CLI/runtime for a trustworthy local-deployment indicator. If none exists, document that console mode is controlled by local deployment configuration and must never be set in cloud or production environments. Do not invent an unreliable production detector.

## Privacy and reset gate

The mobile app must always show the same reset-request result whether the address is absent, password-based, or social-only. Raw provider errors must not reach the user.

Before considering reset complete, inspect and test the installed Password reset initiation behavior. If `@convex-dev/auth` exposes account existence through its public response or another observable application-level result that cannot be safely normalized with supported APIs:

1. Do not add an unsafe account-discovery endpoint.
2. Do not query auth tables from the client.
3. Leave the reset feature disabled or incomplete behind a clearly recorded blocker.
4. Commit only safe preparatory UI or provider-independent work.
5. Record the exact package limitation and a proposed separately reviewed solution.

Uniform wording alone must not be described as protocol-level enumeration resistance.

## Test-driven delivery and review loop

Every behavior-changing implementation task follows a bounded red/green/refactor/review state machine:

1. **Specify:** translate the task's acceptance criteria into the smallest meaningful behavioral test. Prefer observable user or registered Convex behavior over snapshots and implementation details.
2. **Red:** run the new test and confirm it fails for the intended missing behavior, not because the harness, imports, or environment are broken. The red state is transient and is never committed.
3. **Green:** implement the smallest coherent production change that makes the new test pass.
4. **Refactor:** remove duplication and improve names or boundaries without expanding scope; rerun the focused test after each material refactor.
5. **Verify:** run the focused test, the package check, and any directly affected tests. Commit only when green.
6. **Fresh review:** the next invocation reviews the completed commit before new feature work begins. It inspects correctness, architecture, simplicity, security/privacy, accessibility, and product fidelity. Backend auth changes also use the Convex reviewer/authz skills.
7. **Correct:** actionable review findings become regression tests first, followed by the smallest fix, full focused verification, and a correction commit. The corrected commit receives another fresh review.
8. **Approve:** only after review has no blocking findings may the runner advance to the next implementation task.

Tests-first applies wherever behavior can be observed deterministically. Pure configuration, generated-code setup, documentation, and visual-only layout work may start with a static contract check, type failure, or bounded bundle/screenshot comparison when a meaningful automated red test would require testing the framework rather than the application. Any exception is recorded in the handoff; it is not permission to skip verification.

The loop is finite: allow at most two correction cycles for one implementation task. If blocking findings remain after the second correction review, stop and record the unresolved findings rather than iterating indefinitely. "Golden" means the declared acceptance criteria pass, required checks are green, and a fresh review reports no blocking findings; it does not mean open-ended polishing.

## Durable handoff protocol

Agents hand off through repository state, not through private conversation history. `docs/overnight-auth-handoff.md` is the durable control record and is updated in the same commit as completed work or a verified review result. It records:

- current implementation checklist section;
- next action: `implement`, `review`, `correct`, `blocked`, or `complete`;
- last known-good commit;
- tests added and their observed red/green result;
- checks run and their exact outcome;
- review findings and correction-cycle count;
- assumptions, blockers, and the next bounded action.

A fresh agent must verify the handoff against `git status`, `git log`, and the actual files. The repository wins when prose and code disagree. Review agents do not silently fix findings: they record them and hand off to a correction invocation, preserving an independent review lens.

## Runner contract

The overnight runner must first verify that every manual preflight item is checked. It must never perform or mark a manual preflight item autonomously. Each Kit invocation performs exactly one state transition from the durable handoff: one implementation, one fresh review, or one correction. Every invocation must:

1. Read `AGENTS.md`, `docs/architecture.md`, and this document.
2. Inspect `git status`, recent commits, and relevant files before editing.
3. Treat existing uncommitted changes as potentially completed by an interrupted invocation; verify rather than overwrite them.
4. Activate the relevant Expo or Convex skills before specialized work.
5. Make the smallest coherent change for one task.
6. Run the smallest relevant check.
7. Update the checklist and durable handoff only after the required state transition succeeds; the external runner owns the runtime log.
8. Create one focused commit for completed implementation/correction work or a verified review handoff. Never commit the transient red state.
9. Exit after that one commit, after recording a blocker, or when all tasks are complete.

The runner, not the model session, owns retries. It uses fresh Kit sessions by default so a failed stream or retired subagent does not carry critical state. On a provider transport failure it retries up to three times with increasing backoff. Before retrying, the next invocation must inspect repository state because edits or commands may already have completed. If it finds a valid green commit, it advances to review rather than repeating implementation. If it finds uncommitted red/partial work, it reconstructs the intended test from the handoff and diff, then either completes the same state transition or records a blocker without destructive cleanup.

The runner preserves stdout/stderr and attempt metadata under an ignored `.agent-overnight/` runtime directory. It records each successfully printed Kit session ID in a private append-only `.agent-overnight/sessions.tsv` manifest with the run ID, iteration, action, exit status, start/end commits, next action, and attempt-log filename; `-` records an invocation that failed before Kit printed a session ID. It compares `HEAD`, the working-tree fingerprint, and handoff state between attempts. A deterministic test/build failure is retried only after a code or configuration change. Two identical non-provider no-progress failures, three provider-transport attempts, or two correction cycles stop the run and preserve the last inspectable state.

## Deployment safety

- Before any command that selects, starts, configures, pushes to, or changes a Convex deployment, activate and follow the Convex deployment guard.
- The only authorized target is a local Convex deployment.
- If the current target is cloud development, preview, production, unknown, or ambiguous, stop and record a blocker. Do not switch it autonomously.
- Prefer bounded `convex dev --once` or equivalent validation once the local deployment has been selected manually. Do not leave an unmonitored long-running backend process as though it were a durable job.
- Never run `convex deploy`, production environment commands, destructive data commands, or migrations.

## Manual preflight before starting the overnight runner

These are operator steps and must not be guessed by an unattended agent:

- [x] Confirm the Git working tree is clean.
- [x] Create or select the branch intended for overnight commits.
- [x] Initialize the pinned CLI's anonymous-local deployment with `CONVEX_AGENT_MODE=anonymous mise exec -- pnpm --dir packages/backend exec convex dev --once`.
- [x] Confirm the resulting backend environment/configuration identifies an `anonymous:...` local deployment.
- [x] Configure `AUTH_EMAIL_DELIVERY=console` on that local deployment using the Convex CLI while the local backend is running.
- [x] Run one bounded local backend sync/codegen successfully.
- [x] Set the mobile app's uncommitted local environment to the local Convex URL reported by the CLI.
- [x] Verify the intended simulator can reach the local Convex backend.
- [x] Keep the host awake, connected to power, and on a stable network for the run (for example, wrap the supervisor with macOS `caffeinate`).
- [x] Keep real secrets out of the repository; no Resend key is needed.

Do not start unattended work until this preflight is complete.

## Implementation checklist

### 1. Verify pinned APIs and record the concrete flow contract

- [ ] Inspect installed Convex Auth `0.0.95` Password and Email provider source/types. Record exact signup-verification and reset flow names, arguments, expiry behavior, resend replacement behavior, session invalidation behavior, and supported token generation hook in this document or a focused adjacent note.
- [ ] Inspect Expo Router `57.0.15` installed types for `Stack.Protected` and confirm the route-group guard shape.
- [ ] Confirm the local console provider can be implemented without a new delivery dependency.
- [ ] Establish version-compatible mobile interaction and Convex test commands only where they immediately support the first behavior tests; do not add placeholder tests or unrelated infrastructure.
- [ ] Run existing mobile and backend checks.

Acceptance: the plan contains no guessed version-sensitive API, baseline checks pass, and each upcoming behavior task has a concrete executable red-test strategy or a recorded verification exception.

### 2. Establish routing and restoration boundaries

- [ ] Add auth, onboarding, and app route groups with focused layouts.
- [ ] Wait for Convex Auth restoration before evaluating guards.
- [ ] Preserve the missing-Convex-URL state without calling auth hooks outside the provider.
- [ ] Keep exactly one route matching `/`.
- [ ] Remove the obsolete segmented auth route after replacement routes exist.

Acceptance: cold restoration renders neither auth nor authenticated content prematurely; unauthenticated users cannot render app routes; authenticated users cannot remain on auth routes; TypeScript passes.

### 3. Build the password welcome, sign-in, and sign-up screens

- [ ] Implement artifact-aligned native screens using existing `Screen`, `Button`, `TextField`, `Typography`, and `Card` primitives.
- [ ] Keep sign-in and sign-up as independent route-local form lifecycles.
- [ ] Normalize email and enforce client guidance matching the ten-character server rule.
- [ ] Prevent duplicate submission and preserve entered values after failure.
- [ ] Map expected failures to sanitized user-facing messages; never render raw provider payloads.
- [ ] Omit Apple and Google buttons rather than displaying nonfunctional controls.

Acceptance: existing password sign-in works; signup reaches the next state supported at that point; labels, autocomplete, keyboard settings, busy states, alerts, touch targets, safe areas, font scaling, and keyboard reachability are preserved; mobile check passes.

### 4. Configure local console signup verification

- [ ] Add the server-side ten-character password requirement.
- [ ] Configure Password signup verification with a secure six-digit code and explicit console delivery mode.
- [ ] Ensure missing delivery configuration fails closed.
- [ ] Add the verification screen, resend cooldown, change-email path, pending state, and safe errors.
- [ ] Ensure signup does not enter authenticated onboarding until verification succeeds.

Acceptance: the code appears only in local backend logs, an incorrect code fails safely, a resent code replaces the prior code, a successful code signs the user in exactly once, and mobile/backend checks pass.

### 5. Add server-owned profile onboarding

- [ ] Add a minimal profile table with owner ID, display name, optional first name, and onboarding-completion state.
- [ ] Add the owner-first index required by the query contract.
- [ ] Add narrow authenticated `getMine` and completion/update behavior with validators and server-derived identity.
- [ ] Add backend tests for unauthenticated rejection, owner success, cross-user isolation where applicable, validation, persistence, and public return shape.
- [ ] Add the artifact-aligned profile screen and route authenticated incomplete users through it.
- [ ] Route completed users into the minimal authenticated home.

Acceptance: profile state is Convex-owned, onboarding survives restart, no caller can read or mutate another profile, auth restoration and profile loading are distinct states, and backend/mobile checks pass.

### 6. Add safe password reset when the privacy gate permits

- [ ] Verify reset initiation behavior against the privacy gate above before exposing the feature.
- [ ] Configure a separate console reset provider with secure six-digit codes.
- [ ] Add request, neutral sent/code-entry, and new-password states.
- [ ] Apply the same ten-character rule and safe error mapping.
- [ ] State that successful reset signs out other devices; do not offer a toggle.
- [ ] Verify successful reset signs in the current user and invalidates previous sessions according to package behavior.

Acceptance: absent and existing addresses receive indistinguishable application-level responses where supported; codes remain server-only except for local logs; previous sessions are invalidated; checks pass. If the package cannot meet the privacy gate safely, record the blocker and leave reset unavailable.

### 7. Harden behavior and accessibility

- [ ] Add the smallest justified mobile tests for validation, safe error mapping, duplicate-submit prevention, and accessible labels/alerts if a compatible test harness can be introduced without broad infrastructure. Otherwise document bounded manual checks rather than adding speculative tooling.
- [ ] Test compact layouts, keyboard visibility, enlarged text, and logical screen-reader order on the available simulator.
- [ ] Confirm sign-out removes protected app routes from navigation history.
- [ ] Confirm no console code or sensitive auth data is returned by a public function or displayed in ordinary UI.

Acceptance: automated checks pass, manual-only gaps are explicit, and no known high-severity auth or accessibility issue remains hidden.

### 8. Final local verification and handoff

- [ ] Run `mise exec -- pnpm --filter @recovery/mobile run check`.
- [ ] Run `mise exec -- pnpm --filter @recovery/backend run check`.
- [ ] Run relevant tests.
- [ ] Run a bounded local Convex sync/codegen against the already confirmed local target.
- [ ] Run `mise run check` for the cross-package change.
- [ ] Run Expo Doctor only if dependencies or Expo configuration changed.
- [ ] Run bounded iOS and Android export smoke checks.
- [ ] Confirm `git status` is clean and summarize completed, deferred, blocked, and manually unverified behavior.

Acceptance: every completed task has a validated commit, no production/cloud action occurred, and the handoff identifies the exact next manual step.

## Stop conditions

Stop unattended work and record a blocker when any of the following occurs:

- The selected Convex deployment is not unambiguously local.
- A command requests production, cloud deployment, destructive data access, secrets, OAuth credentials, or interactive product input.
- The installed API cannot implement a required security property without undocumented auth-table writes or an unauthenticated account-discovery endpoint.
- Two attempts fail with the same provider, package, build, or test error without measurable progress.
- The working tree contains unrelated or ambiguous changes that cannot be attributed safely.
- A check fails and the cause cannot be corrected within the current bounded task.
- The agent would need to weaken authentication, bypass verification, use a fixed code, expose a code to the client, or display raw provider errors.
- All checklist tasks are complete.

## Commit policy

- One coherent completed checklist task per commit.
- Use imperative messages such as `Add protected auth routes` or `Add local signup verification`.
- Do not commit failing work, runtime logs, local environment files, local deployment data, secrets, generated export output, or temporary artifact extraction files.
- Do not amend or rewrite prior commits during unattended execution.
- If a task is blocked, update the durable handoff and plan in a dedicated documentation commit only when the recorded information is verified and useful; otherwise preserve the inspectable repository state and exit. The ignored runtime log is owned by the external runner and is never committed.
- Implementation and correction commits include tests and production code together; never commit a deliberately failing red test. Review-only commits may update only the plan/handoff.
- Every feature commit must receive a fresh review state transition before the next feature task begins.

## Completion definition

The run succeeds when password signup, six-digit local verification, display-name onboarding, returning sign-in, safe password reset (or an explicit verified package blocker), protected home, and sign-out work against a local Convex deployment; required checks pass; completed work is committed; and all deferred or manual integration work is plainly documented.
