# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 2. Establish routing and restoration boundaries
- **Next action:** implement
- **Last known-good commit:** `20f06a7` (`Block auth contract after final review`), followed by an operator-approved safe-deferral plan revision
- **Correction cycles for current section:** 0
- **Last successful checks:** Expanded supervisor transition self-test, mobile TypeScript check, backend TypeScript check, shell syntax, and `git diff --check` pass for the operator-approved plan revision.
- **Tests added in current section:** The supervisor self-test now covers approved/deferred review advancement, both correction cycles, and the terminal blocked transition. No application test exists yet for section 2; its first implementation invocation must start with `scripts/test-auth-route-contract.sh` and demonstrate the intended red result.
- **Review status:** Section 1 limitations are accepted as feature-level deferrals, not run-wide blockers. The fixed non-enumeration policy remains unchanged.
- **Blocking condition:** None for remaining safe work. Signup/verification and reset stay unavailable; do not add their routes, controls, providers, or code generation.
- **Next bounded action:** Implement section 2 routing and restoration boundaries only, starting with the declared route-contract red test, then set `Next action` to `review`.

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
