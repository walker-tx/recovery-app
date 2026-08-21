# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 1. Verify pinned APIs and record the concrete flow contract
- **Next action:** blocked
- **Last known-good commit:** `aec9774` (`Complete auth contract corrections`)
- **Correction cycles for current section:** 2
- **Last successful checks:** Focused five-finding static contract check (red: all five assertions failed before correction; green: all five passed); `mise exec -- pnpm --filter @recovery/mobile run check` (pass); `mise exec -- pnpm --filter @recovery/backend run check` (pass); `git diff --check` (pass). Fresh review independently confirmed the target diff is documentation-only, the working tree was clean, and `git diff --check a59a61f aec9774` passed.
- **Tests added in current section:** No test dependency was added for this documentation correction. The focused Python static contract check covered logging flags, section 3 submission behavior, split section 4 test layers, reversed delivery completion, and partial token-persistence recovery.
- **Review status:** Blocked after fresh review of correction cycle 2 of 2. Architecture and simplicity had no findings; the Convex authorization scan found no app-defined public query or mutation matching the four targeted authz defect shapes. Two blocking section 1 contract findings remain and a third correction cycle is prohibited.
- **Blocking condition:** First, restart is not fail-closed after a selective partial token write plus cleanup failure: pinned `@convex-dev/auth` `0.0.95` restores authentication from a residual access token without requiring a refresh-token pair. Second, the package DEBUG plaintext-code prohibition has no assigned executable section 4 configuration/log-output check or recorded verification exception. Signup also remains unavailable behind the account-enumeration privacy and concurrent-resend safety gates; reset remains unavailable behind its privacy gate.
- **Next bounded action:** Operator decision is required because two correction cycles are exhausted. Do not begin section 2 or request a third correction cycle. A separately authorized plan revision must address fail-closed token persistence/restoration and assign an executable local logging-configuration/output check before section 1 can be approved.

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

## Fresh review findings on `aec9774`

1. **Blocking — partial token persistence is not fail-closed on restart.** The pinned client writes access and refresh tokens sequentially, removes them sequentially during sign-out, restores from the access-token key alone, and considers any restored access token authenticated. If the refresh-token write fails and later access-token removal also fails, restart can render protected routes despite the contract's fail-closed claim. The contract would need pair-consistency or a durable quarantine plus selective write/remove/restart fault cases.
2. **Blocking — plaintext package logging lacks an executable verification owner.** The package directly logs verification-code creation arguments at DEBUG, while the section 4 strategy assigns no bounded check to verify local deployment logging configuration and observed output. A future strategy must prove the intended console provider is the only plaintext-code path or record a precise verification exception.

The accessibility candidate was rejected as outside this correction's diff scope: existing plan acceptance already covers labels, busy states, alerts, touch targets, font scaling, keyboard reachability, and non-color errors. Runtime VoiceOver, TalkBack, focus, announcement, Dynamic Type, and exact touch-target behavior remain future device-verification gaps, not findings on this documentation correction.

## Review coverage

Fresh read-only lenses covered architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fit, test quality, Convex review, and the deterministic Convex authz scan. A separate skeptic confirmed both blocking findings and rejected the accessibility candidate. Review inspected the exact pinned source for logging, token writes/removals, restoration, and auth-state publication. No production code was edited, no deployment-affecting command was run, and runtime/device behavior remains unverified.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
