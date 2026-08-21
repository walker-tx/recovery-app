# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 1. Verify pinned APIs and record the concrete flow contract
- **Next action:** review
- **Last known-good commit:** pending correction commit (parent `88fcf5e`)
- **Correction cycles for current section:** 1
- **Last successful checks:** Focused six-finding static contract check (red: all six assertions failed before correction; green: `PASS: six blocking contract findings`); `mise exec -- pnpm --filter @recovery/mobile run check` (pass); `mise exec -- pnpm --filter @recovery/backend run check` (pass); `git diff --check` (pass).
- **Tests added in current section:** No test dependency was added for this documentation correction. The focused Python static contract check covered signup privacy, plaintext DEBUG logging, unconditional email authorization, concrete section strategies, resend delivery failure, and lost-response recovery.
- **Review status:** Correction transition complete and awaiting fresh review. All six findings from review commit `397f8e9` are addressed in the contract and plan without production-code changes.
- **Blocking condition:** Signup and reset exposure remain gated because pinned `@convex-dev/auth` 0.0.95 has account-dependent outcomes. This does not block fresh review of section 1 or later provider-independent routing/sign-in work.
- **Next bounded action:** Freshly review this correction commit against installed source for correctness, architecture, simplicity, auth security/privacy, accessibility, product fidelity, and executable test quality. Do not begin routing implementation in the review invocation.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs. The pinned 0.0.95 `reset` implementation currently fails this gate because absent and existing password accounts have observably different outcomes; keep reset unavailable pending a separately reviewed solution.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Corrections applied for review findings on `06b58a9`

1. Signup now has the same explicit privacy gate as reset, with all four observed account-dependent outcomes recorded; signup controls remain unavailable pending a supported indistinguishable flow or separately reviewed product revision.
2. Hashing is qualified as database storage, and the independent plaintext `AUTH_LOG_LEVEL=DEBUG` path is documented and prohibited outside the explicitly verified local environment.
3. Matching-email authorization is described as the unconditional default callback installed by the pinned `Email(...)` helper, without the unsupported token-length rationale.
4. Sections 2-7 now each name an exact bounded red command and expected assertion, with explicit static/simulator exceptions where the current toolchain cannot meaningfully mount framework behavior.
5. Replacement-code creation-before-delivery ordering is recorded, with a focused failure check, post-success cooldown, and immediate delivery-failure retry requirement.
6. Code consumption/session creation before client token persistence is recorded, with lost-response/SecureStore recovery through fresh-code request or normal sign-in and no exactly-once claim.

## Review coverage

Fresh lenses covered architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fit, and test quality against the exact commit and pinned installed source. A separate skeptic confirmed findings 1-6 and downgraded the accessibility-contract candidate to non-blocking because broader requirements already exist in `docs/architecture.md` and sections 3 and 7 of the plan. No production code was edited and no deployment-affecting command was run.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
