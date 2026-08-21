# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 1. Verify pinned APIs and record the concrete flow contract
- **Next action:** review
- **Last known-good commit:** pending correction commit (parent `a59a61f`)
- **Correction cycles for current section:** 2
- **Last successful checks:** Focused five-finding static contract check (red: all five assertions failed before correction; green: all five passed); `mise exec -- pnpm --filter @recovery/mobile run check` (pass); `mise exec -- pnpm --filter @recovery/backend run check` (pass); `git diff --check` (pass).
- **Tests added in current section:** No test dependency was added for this documentation correction. The focused Python static contract check covered logging flags, section 3 submission behavior, split section 4 test layers, reversed delivery completion, and partial token-persistence recovery.
- **Review status:** Correction cycle 2 of 2 is complete and awaiting fresh review. The five findings from review commit `a844438` are addressed in the contract and plan without production-code changes.
- **Blocking condition:** Signup remains unavailable behind both the pinned package's account-enumeration privacy gate and a concurrent-resend safety gate; reset remains unavailable behind its privacy gate. These gates do not block fresh review of section 1 or later provider-independent routing/sign-in work.
- **Next bounded action:** Freshly review this correction commit against installed source for correctness, architecture, simplicity, auth security/privacy, accessibility, product fidelity, and executable test quality. Because the correction count is already 2, set Next action to `blocked` if any blocking section 1 finding remains; otherwise approve section 1, reset the correction count to 0 for section 2, and set Next action to `implement`. Do not begin routing implementation in the review invocation.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs. The pinned 0.0.95 `reset` implementation currently fails this gate because absent and existing password accounts have observably different outcomes; keep reset unavailable pending a separately reviewed solution.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Corrections applied for review findings on `6e1024e`

1. The contract now requires both `AUTH_LOG_LEVEL=DEBUG` and `AUTH_LOG_SECRETS=true` to remain unset for every code-generating run, including local console delivery, and records that the code-creation DEBUG call bypasses `maybeRedact`.
2. Section 3 keeps normalization, password guidance, and safe-error mapping in pure policy tests, moves duplicate-submit behavior to a focused submission state-machine test, and requires a bounded simulator double-tap wiring check.
3. Section 4 now separates backend code-lifecycle/concurrency tests from mobile verification-state tests and records a bounded SecureStore fault-injection simulator exception for provider-owned token writes.
4. The contract and plan add a concurrent-resend safety gate with a forced reversed-delivery-completion test; signup/resend remains unavailable unless the last delivered code is redeemable across overlapping clients and retries.
5. Lost-response and partial token-write states now require no protected navigation before success, discarded verification state, awaited best-effort sign-out, fail-closed restoration if cleanup fails, and normal password sign-in as the supported recovery. A fresh code and exactly-once completion are explicitly not promised.

## Review coverage

The correction was checked against the exact pinned source paths cited by review, including logging redaction, replacement-code ordering, session/code consumption, client network retries, token persistence, and sign-out cleanup. No production code was edited, no deployment-affecting command was run, and runtime/device behavior remains unverified by this documentation correction. A fresh review is required before section 1 can be approved.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
