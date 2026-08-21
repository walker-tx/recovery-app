# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 5. Add server-owned profile onboarding
- **Next action:** review
- **Last known-good commit:** `57fdc50` is the approved section 3 handoff state; the section 5 backend feature commit containing this handoff awaits fresh review.
- **Correction cycles for current section:** 0
- **Last successful checks:** `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/profiles.test.ts` passed 3/3; `mise exec -- pnpm --filter @recovery/backend exec node --experimental-strip-types --test convex/auth-policy.test.ts` passed 2/2 with only the existing package-module-type warning; `mise exec -- pnpm --filter @recovery/backend run check` passed; bounded local `CONVEX_AGENT_MODE=anonymous mise exec -- pnpm --dir packages/backend exec convex dev --once` completed against `anonymous:anonymous-agent`; and `git diff --check` passed.
- **Tests added in current section:** `profiles.test.ts` exercises the registered generated API for unauthenticated read/write rejection, absent-profile behavior, normalized create/update persistence, cross-user isolation, single-profile ownership, blank-name validation, and narrow public return shape. Its initial run failed 3/3 for the intended missing `profiles` module.
- **Review status:** The first section 5 backend slice is implemented and green but not yet reviewed. The mobile profile screen, onboarding routing, and authenticated home remain unchecked and must not begin before this feature commit is approved.
- **Blocking condition:** None.
- **Next bounded action:** Fresh-review only the section 5 backend feature commit. Activate Convex reviewer and authz skills; inspect correctness, architecture, simplicity, validators, ownership/index behavior, privacy, generated-code provenance, test quality, and the narrowly necessary auth-policy module rename/test tooling changes. Do not edit production code during review.

## Section 5 backend profile implementation

The backend now owns one profile per authenticated user in a `profiles` table indexed by `ownerId`. Public `getMine` and `complete` functions derive the user ID from Convex Auth, declare argument and return validators, use the owner index, return no owner metadata, normalize names, reject blank display names, and upsert only the caller's profile in one transaction. The generated API was refreshed by the local Convex CLI; no generated file was hand-edited.

The new behavior test initially failed all three cases with `Could not find module for: "profiles"`, demonstrating the intended missing registered capability; no red state was committed. The green run passed 3/3 and covers unauthenticated rejection, absent-profile behavior, owner create/update persistence, cross-user isolation, a single owned row, blank display-name rejection, and public shape through `api.profiles`. The existing auth policy tests still pass 2/2.

The first local sync exposed that the existing hyphenated `auth-policy.ts` filename was not a valid Convex module path, so it was renamed without behavior changes to `authPolicy.ts`. The colocated Convex test harness adds exact `convex-test`, Vitest, and Vite development dependencies plus their required TypeScript types. After those bounded setup corrections, backend TypeScript passed, the local-anonymous sync completed, generated API types include `profiles`, and `git diff --check` passed. No cloud or production deployment was selected or changed.

## Section 3 correction cycle 2 final review

No actionable blocking findings survived verification. The reducer is the authoritative owner used by `SignInScreen`, its authentication-failure transition preserves both credentials while accepting only a sanitized error message, duplicate submission remains synchronously guarded, and no production backend or public Convex contract changed. The deterministic Convex authorization scan found no application-defined public query/mutation, client-supplied identity, document-ownership, PII-by-ID, or parent-container write shape.

The shared field primitive does not yet programmatically associate field errors with inputs, and invalid submission does not focus the first invalid field. Both behaviors predate `dab694c`, were not worsened by the correction, and remain nonblocking section 7 accessibility hardening work alongside mounted retention/double-tap checks, compact layout, keyboard, enlarged text, and VoiceOver/TalkBack verification. The inherited account-dependent provider timing/error behavior remains a package-level limitation; the mobile UI renders only a fixed sanitized failure, and signup/reset remain unavailable under the accepted deferral.

Fresh review reran the focused mobile auth command (6/6), the mobile TypeScript check passed, and `git diff --check` passed; focused tests emitted only the existing package-module-type warnings. No production code, dependency, Expo configuration, generated Convex file, or deployment state changed during review.

## Section 3 correction cycle 2

The new regression first failed with the intended `ERR_MODULE_NOT_FOUND` because the screen-owned sign-in state transition did not yet exist as a testable boundary; no red state was committed. The screen now owns email, password, and form error in one reducer, and its authentication-failure action changes only the sanitized error. This makes credential retention an explicit tested transition rather than an assertion over an unrelated submission object.

After implementation, the combined focused mobile auth command passed 6/6, the mobile TypeScript check passed, and `git diff --check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 3 correction cycle 1 fresh review of `b37f7d6`

One P2 blocking finding remains: `apps/mobile/src/features/auth/auth-submission.test.ts` passes a standalone object through `createSubmissionGuard` and proves callback identity, object non-mutation, and retry unlock, but it never observes the controlled `email` and `password` state in `SignInScreen`. Adding `setEmail("")` and `setPassword("")` to the screen's failure path would not fail this regression. The next correction must cover state actually owned by that failure path without adding broad interaction infrastructure.

The password correction is approved: mobile sign-in now requires only a nonempty password, backend profile normalization accepts legacy eight- and nine-character credentials, and the pinned 0.0.95 source confirms `validatePasswordRequirements` runs only for `signUp` and `reset-verification`. The ten-character creation/reset rule therefore remains intact. Deterministic Convex authz review found no client-supplied identity, resource-ownership, PII-by-ID, or unchecked parent-container write in application backend code. No raw provider error is displayed, and unsupported password flows remain fail-closed.

Nonblocking gaps remain assigned to hardening: mounted-screen retention and double-tap coverage, direct-entry Back fallback, stale form-error clearing, local-backend sign-in, compact layout, keyboard, enlarged text, and assistive-technology checks. The inherited account-dependent sign-in errors/timing and mixed-case legacy-account compatibility question remain documented limitations, not blockers for the current safe work. No production code was edited and no deployment-affecting command ran during review.

## Section 3 correction cycle 1

Regression-first evidence covered both review blockers. Before production changes, the mobile focused command failed 3/5 for the intended reasons: the policy still rejected an eight-character password and the submission guard did not accept or pass the form values into its callback. The backend focused command failed with the intended `ERR_MODULE_NOT_FOUND` for the absent profile-policy module. No red state was committed.

The correction now validates only that a returning-user password is present on mobile, permits existing eight- and nine-character credentials through the backend profile normalization boundary, and preserves the ten-character rule in the provider's creation/reset hook. The submission guard now passes a read-only snapshot of the screen-owned email/password state to the callback that invokes Convex Auth; its failure test verifies that exact object drives the callback, remains unchanged, and can be retried.

After implementation, focused mobile tests passed 5/5 and focused backend tests passed 2/2. Mobile TypeScript passed. The first backend TypeScript run exposed `TS5097` for the new explicit `.ts` test import; enabling the same no-emit TypeScript import option already used by mobile resolved it, after which backend TypeScript and `mise run check` passed (2/2 workspace tasks). No deployment-affecting command ran.

## Section 3 fresh review of `62bd24f`

Two blocking findings require one correction cycle:

1. **P2 correctness/product — sign-in revalidates legacy credentials.** `apps/mobile/src/features/auth/auth-policy.ts` and `packages/backend/convex/auth.ts` reject every password shorter than ten characters before credential verification. Pinned Auth 0.0.95 previously allowed creation with its eight-character default, and its `validatePasswordRequirements` hook intentionally runs only for `signUp` and `reset-verification`. The returning-user flow must not lock out an otherwise valid existing eight- or nine-character credential. Preserve the ten-character rule for future credential creation/reset without applying it during sign-in.
2. **P2 test quality — value retention is not tested.** `auth-submission.test.ts` compares a standalone `values` object that is never passed to the guard, callback, or screen. The assertion necessarily passes even if the rendered form clears both fields. Replace it with regression coverage over state that the sign-in flow actually owns; keep the meaningful retry-unlock assertion.

Nonblocking findings and residual gaps: direct-entry Back fallback and stale form-error clearing are P3 hardening candidates; rendered double-tap, successful local-backend sign-in, keyboard, compact-layout, enlarged-text, and assistive-technology checks remain unverified. Pinned Auth's direct public sign-in action has account-dependent error/timing behavior inherited from the parent provider configuration; the mobile flow does not display those raw errors, and the accepted protocol-level deferrals remain limited to signup/verification/reset. Deterministic Convex authz scanning found no client-supplied identity, missing document-ownership check, PII-by-ID query, or unchecked parent-container write in application Convex code. No production code was edited during review, and no deployment-affecting command ran.

Fresh read-only lenses covered correctness, architecture, simplicity, security/privacy, Convex authorization, accessibility, adversarial behavior, product fidelity, tooling, and test quality. An independent skeptic confirmed both blockers after inspecting the repository contract and pinned provider source.

## Section 3 implementation

The welcome and returning-user sign-in routes now compose capability screens under `features/auth`. The sign-in screen preserves email/password values after failure, disables editable controls while pending, blocks immediate duplicate auth calls synchronously, supplies email/password autofill and keyboard metadata, and renders validation/provider failures as non-color-only alerts without displaying raw provider errors. The provider profile is the server-side normalization boundary and rejects every Password flow except `signIn`, preserving the accepted signup/reset deferrals.

Red evidence was captured before production files existed. Both test commands failed specifically because their imported policy/submission modules were absent; no red state was committed. After implementation, the combined focused run passed all five assertions. An initial mobile TypeScript check exposed missing Node test types and an invalid typed absolute route; adding the section's test type dependency/config and using the typed relative route resolved those failures before the final green checks. No deployment-affecting command was run.

## Section 2 review

Fresh read-only lenses covered correctness, architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fit, and test quality for `542d904`. No backend code changed, so Convex authorization review was not applicable. The independent skeptic confirmed the only candidate: returning `null` during restoration removed the prior labeled loading indicator. It classified this as a non-blocking P3 accessibility gap owned by section 7 rather than a failure of section 2 routing acceptance. No production code was edited during review.

## Operator-approved safe deferral

The operator approved safe deferral after the final section 1 review. This decision supersedes the prior run-wide block without weakening any security requirement:

- Signup/verification and reset are accepted as unavailable for this milestone because pinned 0.0.95 cannot meet the non-enumeration policy and signup also fails the concurrent-resend gate.
- Provider-owned non-atomic token persistence is documented as an inherited session-consistency limitation. A residual token remains subject to backend validation; this milestone does not fork or replace Convex Auth token storage.
- No code-generating email provider is enabled, so package DEBUG code logging is currently unreachable. Before a future provider is enabled, a bounded environment and observed-log check must be added.
- Routing, returning-user sign-in, profile onboarding, protected home, sign-out, and hardening may proceed. Reviewed feature-level deferrals advance rather than setting the whole run to `blocked`.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs. The pinned 0.0.95 `reset` implementation currently fails this gate because absent and existing password accounts have observably different outcomes; keep reset unavailable pending a separately reviewed solution.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Historical corrections applied for review findings on `6e1024e`

1. The contract now requires both `AUTH_LOG_LEVEL=DEBUG` and `AUTH_LOG_SECRETS=true` to remain unset for every code-generating run, including local console delivery, and records that the code-creation DEBUG call bypasses `maybeRedact`.
2. Section 3 keeps normalization, password guidance, and safe-error mapping in pure policy tests, moves duplicate-submit behavior to a focused submission state-machine test, and requires a bounded simulator double-tap wiring check.
3. Section 4 now separates backend code-lifecycle/concurrency tests from mobile verification-state tests and records a bounded SecureStore fault-injection simulator exception for provider-owned token writes.
4. The contract and plan add a concurrent-resend safety gate with a forced reversed-delivery-completion test; signup/resend remains unavailable unless the last delivered code is redeemable across overlapping clients and retries.
5. Lost-response and partial token-write states now require no protected navigation before success, discarded verification state, awaited best-effort sign-out, fail-closed restoration if cleanup fails, and normal password sign-in as the supported recovery. A fresh code and exactly-once completion are explicitly not promised.

## Historical final-review findings resolved by operator deferral

1. **Blocking — partial token persistence is not fail-closed on restart.** The pinned client writes access and refresh tokens sequentially, removes them sequentially during sign-out, restores from the access-token key alone, and considers any restored access token authenticated. If the refresh-token write fails and later access-token removal also fails, restart can render protected routes despite the contract's fail-closed claim. The contract would need pair-consistency or a durable quarantine plus selective write/remove/restart fault cases.
2. **Blocking — plaintext package logging lacks an executable verification owner.** The package directly logs verification-code creation arguments at DEBUG, while the section 4 strategy assigns no bounded check to verify local deployment logging configuration and observed output. A future strategy must prove the intended console provider is the only plaintext-code path or record a precise verification exception.

The accessibility candidate was rejected as outside this correction's diff scope: existing plan acceptance already covers labels, busy states, alerts, touch targets, font scaling, keyboard reachability, and non-color errors. Runtime VoiceOver, TalkBack, focus, announcement, Dynamic Type, and exact touch-target behavior remain future device-verification gaps, not findings on this documentation correction.

## Review coverage

Fresh read-only lenses covered architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fit, test quality, Convex review, and the deterministic Convex authz scan. A separate skeptic confirmed both blocking findings and rejected the accessibility candidate. Review inspected the exact pinned source for logging, token writes/removals, restoration, and auth-state publication. No production code was edited, no deployment-affecting command was run, and runtime/device behavior remains unverified.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
