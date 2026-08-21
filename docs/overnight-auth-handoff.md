# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 1. Verify pinned APIs and record the concrete flow contract
- **Next action:** correct
- **Last known-good commit:** `06b58a9` (`Record pinned auth flow contract`), reviewed with blocking documentation findings
- **Correction cycles for current section:** 0 completed; the next correction is cycle 1 of 2
- **Last successful checks:** Review inspection of commit `06b58a9` against `e2152c9`; installed-source verification for `@convex-dev/auth` 0.0.95 and Expo Router 57.0.15; `git diff --check e2152c9 06b58a9` (pass). The implementation commit recorded passing mobile/backend checks and its intended documentation red/green check.
- **Tests added in current section:** No tests were added by this review-only transition.
- **Review status:** Changes requested. Architecture and simplicity review found no blockers; the security/privacy, adversarial, product, and test-strategy findings below must be corrected before section 2 starts. Accessibility has no separate blocker because the plan and architecture already retain the broader VoiceOver, TalkBack, layout, keyboard, and text-scaling checks.
- **Blocking condition:** Password reset remains gated, and signup exposure is also gated until its account-dependent behavior is reconciled with the fixed anti-enumeration decision. The pinned package contract also needs the logging, authorization, partial-failure, and executable-strategy corrections below.
- **Next bounded action:** Correct only the section 1 contract and plan/handoff documentation. Turn the findings below into focused static contract checks first, demonstrate the intended red result, make the smallest documentation correction, rerun exact documentation and package checks, commit green, and set Next action to `review`. Do not begin routing implementation.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs. The pinned 0.0.95 `reset` implementation currently fails this gate because absent and existing password accounts have observably different outcomes; keep reset unavailable pending a separately reviewed solution.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Blocking review findings for `06b58a9`

1. **Signup account enumeration (security/product, high):** `docs/auth-flow-contract.md:11,29` describes only new-account signup and says all password auth except reset is unblocked. Installed `createAccountFromCredentials.ts:40-61` and `Password.ts:141-152,228-236` produce observably different outcomes for an unknown email, an existing password account with the wrong password, an existing unverified account with the correct password, and an existing verified account with the correct password. This conflicts with the fixed rule that unauthenticated flows must not reveal account existence. Extend the privacy gate to signup, record these cases, and keep signup exposure blocked unless a supported indistinguishable flow is verified or the product decision is separately revised.
2. **Plaintext package debug logging (security, medium):** The local-email policy says codes are printed only by the explicitly enabled console provider, but installed `mutations/createVerificationCode.ts:27-36` passes the plaintext code to package DEBUG logging independently of `AUTH_EMAIL_DELIVERY`; `implementation/utils.ts:46-68` emits it when `AUTH_LOG_LEVEL=DEBUG`. Qualify the hash statement as database storage only, document this second logging path, and require DEBUG logging to remain disabled outside the explicitly verified local environment.
3. **Unsupported token-length rationale (correctness/security, medium):** `docs/auth-flow-contract.md:21` attributes matching-email authorization to the six-digit token being shorter than 24 characters. Installed `providers/Email.ts:34-59` installs the matching-email `authorize` callback unconditionally, and redemption invokes it without a token-length branch. Remove the unsupported causal claim and state the pinned helper's actual unconditional default behavior.
4. **Section 1 acceptance is not yet met (test quality/product, medium):** `docs/auth-flow-contract.md:45-49` leaves later agents to choose among conditional harnesses and unspecified static/manual fallbacks, while `docs/overnight-auth-plan.md:191` requires a concrete executable red-test strategy or a recorded exception for every upcoming behavior task. Record one bounded command and expected failing assertion per task, or an explicit task-specific verification exception, before retaining the completed checklist state.
5. **Resend delivery partial failure (adversarial/product, medium):** Installed `signIn.ts:129-176` commits code creation before invoking delivery, and `mutations/createVerificationCode.ts:94-108` deletes the prior code before inserting the replacement. A delivery failure therefore invalidates the prior delivered code without delivering the new one. Record this ordering, require a focused failure check, start the client cooldown only after successful delivery, and permit immediate retry after failure.
6. **Committed verification with lost client response (adversarial/product, medium):** Installed `mutations/verifyCodeAndSignIn.ts:73-84,206-230` consumes the code and creates a session before `src/react/client.tsx:238-257` receives and persists tokens. A lost response or SecureStore failure can leave the device unauthenticated with a consumed code. Add this case to the verification strategy and define a safe recovery path, such as returning to a state that can request a fresh code or sign in normally; do not claim reconnect-safe exactly-once behavior without verification.

## Review coverage

Fresh lenses covered architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fit, and test quality against the exact commit and pinned installed source. A separate skeptic confirmed findings 1-6 and downgraded the accessibility-contract candidate to non-blocking because broader requirements already exist in `docs/architecture.md` and sections 3 and 7 of the plan. No production code was edited and no deployment-affecting command was run.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
