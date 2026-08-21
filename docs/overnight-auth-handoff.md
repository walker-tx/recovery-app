# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 1. Verify pinned APIs and record the concrete flow contract
- **Next action:** review
- **Last known-good commit:** pending commit for this transition (parent `e2152c9`)
- **Correction cycles for current section:** 0
- **Last successful checks:** `mise exec -- pnpm --filter @recovery/mobile run check` (pass); `mise exec -- pnpm --filter @recovery/backend run check` (pass); documentation contract check `test -f docs/auth-flow-contract.md` (pass after the intended missing-file red); `git diff --check` (pass).
- **Tests added in current section:** No test dependency or placeholder test was added. This documentation-only API-verification task used the permitted static contract check: `test -f docs/auth-flow-contract.md` failed with exit 1 before the note existed, then passed after it was added.
- **Review status:** Implementation transition complete and awaiting fresh review. Installed `@convex-dev/auth` 0.0.95, Auth.js 0.41.3, Convex 1.44.0, and Expo Router 57.0.15 behavior is recorded in `docs/auth-flow-contract.md`.
- **Blocking condition:** Password reset exposure is gated: the pinned `reset` flow rejects for an absent password account before delivery but proceeds for an existing account, which is an observable account-dependent result. Other sections are not blocked.
- **Next bounded action:** Freshly review the section 1 contract against installed source for correctness, completeness, security/privacy, architecture, simplicity, and executable test strategy. Do not begin routing implementation in the review invocation.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs. The pinned 0.0.95 `reset` implementation currently fails this gate because absent and existing password accounts have observably different outcomes; keep reset unavailable pending a separately reviewed solution.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
