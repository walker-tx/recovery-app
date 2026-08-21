# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 3. Build the password welcome and returning-user sign-in screens
- **Next action:** review
- **Last known-good commit:** The section 3 implementation commit containing this handoff (`Add returning-user password sign-in`).
- **Correction cycles for current section:** 0
- **Last successful checks:** `mise exec -- pnpm --filter @recovery/mobile exec node --experimental-strip-types --test src/features/auth/auth-policy.test.ts src/features/auth/auth-submission.test.ts` passed 5/5; `mise exec -- pnpm --filter @recovery/mobile run check` passed; `mise exec -- pnpm --filter @recovery/backend run check` passed; `bash scripts/test-auth-route-contract.sh` passed with `Auth route contract passed.`; `mise run check` passed 2/2 tasks; `mise run doctor` passed 17/17 checks.
- **Tests added in current section:** `auth-policy.test.ts` recorded the intended red `ERR_MODULE_NOT_FOUND` for the missing normalization, ten-character guidance, and safe-error policy, then passed 3/3. `auth-submission.test.ts` recorded the intended red `ERR_MODULE_NOT_FOUND` for the missing submission guard, then passed 2/2 for immediate duplicate suppression, failure unlock, and value retention.
- **Review status:** Section 3 implementation is green and awaits fresh review. The feature uses local form state, the existing design-system controls, normalized sign-in parameters, a synchronous submission guard, and one sanitized provider-independent failure message. The backend Password profile accepts only returning-user `signIn`, normalizes email server-side, and rejects passwords shorter than the ten-character rule; signup, verification, reset, OAuth, and provider-specific controls remain unavailable.
- **Blocking condition:** None. No code-generating provider or deferred-flow route/control was added. Runtime simulator double-tap, keyboard, compact-layout, enlarged-text, and screen-reader behavior remain unverified and must be assessed during review/hardening rather than inferred from TypeScript.
- **Next bounded action:** Fresh-review only the section 3 implementation commit for correctness, architecture, simplicity, auth privacy/security, backend flow restriction, accessibility, product fidelity, and test quality. Do not edit production code during review.

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
