# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 1. Verify pinned APIs and record the concrete flow contract
- **Next action:** correct
- **Last known-good commit:** `6e1024e` (`Correct pinned auth flow contract`), reviewed with blocking documentation findings
- **Correction cycles for current section:** 1
- **Last successful checks:** Review inspection of `6e1024e` against `88fcf5e`; installed-source verification for `@convex-dev/auth` 0.0.95; `git diff --check 88fcf5e 6e1024e` (pass). The correction commit recorded passing focused static, mobile, backend, and diff checks.
- **Tests added in current section:** No tests were added by this review-only transition.
- **Review status:** Changes requested. Architecture, simplicity, and accessibility found no blockers. Security/privacy, adversarial behavior, product fit, and test quality found the five blocking contract gaps below.
- **Blocking condition:** Section 1 cannot be approved until the logging policy, test-layer strategies, concurrent replacement-code race, and partial token-persistence/lost-response behavior are corrected. Signup and reset exposure remain gated independently by account-dependent outcomes in pinned 0.0.95.
- **Next bounded action:** Perform correction cycle 2 of 2 for section 1 documentation only. Turn each finding below into a focused static contract assertion and demonstrate red; correct the contract, plan, and handoff; rerun focused and package checks; commit green; set Next action to `review`; do not begin routing implementation.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs. The pinned 0.0.95 `reset` implementation currently fails this gate because absent and existing password accounts have observably different outcomes; keep reset unavailable pending a separately reviewed solution.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Blocking review findings for `6e1024e`

1. **Plaintext package DEBUG logging remains permitted (security/privacy, P2):** `docs/auth-flow-contract.md:47` allows `AUTH_LOG_LEVEL=DEBUG` in the verified local environment, while the plan requires plaintext codes to be printed only by the explicitly enabled console provider. Pinned `mutations/createVerificationCode.ts:27` passes the plaintext code to package logging independently of `AUTH_EMAIL_DELIVERY`, and `implementation/utils.ts:65-68` emits it at DEBUG. Require package DEBUG logging and `AUTH_LOG_SECRETS` to remain disabled whenever auth codes can be generated, including local console-delivery runs.
2. **Section 3 test is at the wrong behavior boundary (test quality/product, P2):** `docs/auth-flow-contract.md:54` assigns duplicate-submit prevention to a pure policy test. Such a test cannot prove that the rendered handler synchronously enters pending state and makes only one auth call after two taps. Use a focused mobile interaction/state-machine test, defer it to the section 7 interaction harness, or record an explicit task-specific simulator exception; keep the pure test for normalization, password guidance, and safe error mapping only.
3. **Section 4 backend test overclaims mobile coverage (test quality/product, P2):** `docs/auth-flow-contract.md:55` assigns client cooldown, lost-response recovery, and SecureStore failure recovery to `convex/auth.test.ts`. Backend tests can verify replacement, consumption, and delivery ordering, but cannot observe React Native cooldown state, client retry/navigation, or SecureStore faults. Split backend and mobile strategies or record explicit bounded simulator/fault-injection exceptions for the mobile-only cases.
4. **Overlapping replacement requests can deliver a stale code last (adversarial/product, P2):** Pinned `signIn.ts:124-153` commits each replacement code before awaiting delivery, and `mutations/createVerificationCode.ts:94-108` deletes the prior code. Two overlapping actions can commit A then B but deliver B then A, leaving the last-delivered code invalid. Extend the contract and section 4 strategy/acceptance to cover reversed delivery completion; one-screen duplicate-submit prevention does not cover retries, restarts, or multiple clients.
5. **Lost response and SecureStore failure have unmodeled partial states (adversarial/product, P2):** Pinned `verifyCodeAndSignIn.ts:73-84,206-230` commits session creation and code consumption before the response, while `react/client.tsx:98-120,175-206` retries network failures and installs in-memory, access, and refresh tokens non-atomically. A retry can see a consumed code, and storage failure can leave mixed in-memory/persisted/rendered state. Document deterministic cleanup or re-authentication, test or explicitly except these fault paths, and use normal sign-in as the clearly supported recovery after successful signup verification rather than claiming a fresh verification code is always available.

## Review coverage

Fresh lenses covered architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fit, and test quality against exact commit `6e1024e` and pinned installed source. An independent skeptic confirmed all five deduplicated findings as P2 blockers. No production code was edited, no deployment-affecting command was run, and runtime/device behavior remains unverified by this static review.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
