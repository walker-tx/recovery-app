# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** Manual preflight
- **Next action:** blocked
- **Last known-good commit:** `cdaeb4c` (`Initial commit`)
- **Correction cycles for current section:** 0
- **Last successful checks:** `bash -n` for both supervisor scripts; isolated fake-Kit self-test covering valid implement→review, inherited deployment rejection, detached-HEAD rejection, single-instance lock rejection, dry-run, one-invocation mode, clean commit enforcement, and private runtime permissions, and explicit Kit session-ID manifest capture; `git diff --check`.
- **Tests added in current section:** `scripts/test-agent-overnight.sh` exercises the supervisor without invoking the real Kit provider or any deployment.
- **Review status:** Two fresh read-only reliability reviews were completed. Their process-group, deployment pinning, state-transition, correction-limit, resume, retry, locking, detached-HEAD, log-permission, dry-run, and `--once` findings were corrected. A final operator review and committed baseline are still required.
- **Blocking condition:** The operator must review and commit the plan/runner, then complete every manual preflight checkbox in `docs/overnight-auth-plan.md`.
- **Next bounded action:** Commit the reviewed supervisor baseline, create the overnight branch, complete local Convex preflight interactively, mark and commit the preflight checklist, then change this action to `implement`.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
