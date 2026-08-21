# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 1. Verify pinned APIs and record the concrete flow contract
- **Next action:** implement
- **Last known-good commit:** `f000f0c` (`Add overnight auth supervisor`)
- **Correction cycles for current section:** 0
- **Last successful checks:** Backend TypeScript check; bounded anonymous-local Convex sync/codegen; console email environment verification; Expo and Convex endpoint checks; iOS bundle compilation with the local Convex URL; `bash -n` for both supervisor scripts; isolated fake-Kit supervisor self-test; `git diff --check`.
- **Tests added in current section:** `scripts/test-agent-overnight.sh` now covers anonymous-local deployment pinning, agent-mode pinning, conflicting inherited values, and cloud rejection without invoking Kit or a deployment.
- **Review status:** Manual preflight is complete. The supervisor accepts and pins the CLI's anonymous-local deployment while continuing to reject cloud targets.
- **Blocking condition:** None.
- **Next bounded action:** Inspect pinned Convex Auth and Expo Router APIs, record the concrete flow contract, run baseline checks, commit the implementation transition, and set the next action to `review`.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
