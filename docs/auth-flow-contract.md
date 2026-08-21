# Pinned authentication flow contract

This note records the version-sensitive behavior inspected before the overnight auth implementation. Installed source and declarations are authoritative for these exact versions: `@convex-dev/auth` 0.0.95 (with `@auth/core` 0.41.3), Convex 1.44.0, and Expo Router 57.0.15. Reinspect this contract before upgrading any of them.

## Password provider

The mobile client calls `signIn("password", params)` from `useAuthActions`. Its promise resolves to `{ signingIn: boolean, redirect?: URL }`; it does not return provider payloads to render. The supported `flow` values and parameters are:

| Flow | Required parameters | Observed behavior |
| --- | --- | --- |
| `signUp` | `email`, `password` | Creates the password account. With `verify` configured, starts that email provider and does not create an authenticated session yet. |
| `signIn` | `email`, `password` | Retrieves the account and signs in, except an unverified account starts `verify`. |
| `email-verification` | `email`, `code` | Redeems the signup code through `verify`; success creates a session and returns tokens to the auth client. |
| `reset` | `email` | Retrieves the password account and then starts `reset`. This throws before delivery when the account does not exist. |
| `reset-verification` | `email`, `code`, `newPassword` | Verifies through `reset`, changes the password, keeps the newly created session, and invalidates every other session for the user. |

`profile(params, ctx)` runs for every flow and is the supported server-side email-normalization point. `validatePasswordRequirements(password)` runs for `signUp` with `password` and `reset-verification` with `newPassword`; the application must override the package's eight-character default to enforce ten characters. The provider uses Lucia Scrypt unless `crypto` is overridden.

Signup verification and reset are separate `EmailConfig` providers supplied as `verify` and `reset`. An email provider exposes `sendVerificationRequest`, `generateVerificationToken`, `normalizeIdentifier`, and `maxAge`. The delivery callback receives the destination as `identifier`, the code as `token`, and an `expires` date, so console delivery needs no new dependency. The application can set `maxAge: 10 * 60`.

The package calls `generateVerificationToken()` when supplied; otherwise it generates a 32-character token. The application will supply a cryptographically generated six-digit string. The pinned `Email(...)` helper unconditionally installs an `authorize` callback that requires the redemption parameters to contain the matching email. Redemption invokes that callback whenever it is defined; there is no token-length branch. Do not override the matching-email check.

A verification code is stored as a SHA-256 hash in the database. Creating another code for the same account deletes the existing code before inserting the replacement. Verification checks the hash, provider, matching-email authorization, and expiration, then deletes the code after all checks pass. Codes are therefore expiring, replaced on resend, and single-use. `Email(...)` defaults to one hour; the lower-level fallback is 24 hours when a provider supplies no `maxAge`. The package does not impose a resend cooldown, so the planned sixty-second cooldown is client-side UX only and must not be described as server enforcement.

Code creation commits before `sendVerificationRequest` runs. On resend, this invalidates the previously delivered code before delivery of the replacement is attempted. If delivery fails, the old code is already unusable and the new code exists in the database but was not delivered. A focused failure-path check must cover this ordering. The client starts its cooldown only after delivery succeeds and permits immediate retry after a delivery failure.

Successful code redemption consumes the code and creates a session before the client receives and persists tokens. A lost response or SecureStore write failure can therefore leave the device unauthenticated after the code has been consumed. The verification UI must recover safely by returning to a state that can request a fresh code, or by allowing normal sign-in for an already verified account; it must not claim reconnect-safe exactly-once behavior.

## Signup and reset privacy gate

The pinned `signUp` implementation is observably account-dependent. An unknown email creates an account and starts verification; an existing password account with the wrong password throws an account-exists error; an existing unverified account with the correct password starts verification again; and an existing verified account with the correct password signs in. Sanitizing displayed error text does not remove the different completion, delivery, and authentication outcomes. Signup exposure is blocked unless a separately reviewed supported flow makes these cases indistinguishable or the fixed product decision is separately revised.

The pinned `reset` implementation is also observably account-dependent: it calls `retrieveAccount` and destructures its result before invoking the reset email provider. An absent password account therefore rejects while an existing password account proceeds to delivery and resolves without signing in. Uniform UI wording cannot normalize this protocol-level difference.

Sections 3-4 may implement provider-independent sign-in and safe preparatory UI, but must not expose signup while its privacy gate fails. Section 6 must not expose reset while its gate fails. Do not add an account-discovery endpoint, inspect auth tables from the client, or claim enumeration resistance based only on presentation text.

The pinned `reset-verification` implementation does satisfy the session policy after successful verification: it updates the credential, calls `invalidateSessions` with the newly created session in `except`, and returns that session so the current device signs in while other sessions are removed.

## Expo Router protection

Expo Router 57.0.15 declares `Stack.Protected` with `{ guard: boolean; children?: ReactNode }`. Protected groups can therefore be expressed as sibling entries in the root stack, for example a protected `(auth)` screen when unauthenticated and protected `(onboarding)` / `(app)` screens when authenticated and profile state permits. The root layout must defer rendering those guards until Convex Auth restoration finishes. Route protection remains navigation UX, not backend authorization.

## Local console delivery boundary

Convex 1.44.0 has CLI-side knowledge of local deployment selection, but no documented server runtime flag available to an action that reliably proves the deployment is local. `CONVEX_AGENT_MODE=anonymous` affects CLI selection and is not a trustworthy server-runtime production detector. Console delivery must therefore fail closed unless `AUTH_EMAIL_DELIVERY=console` is explicitly configured in the already verified local deployment. That value must never be configured in cloud or production. The deployment guard and supervisor remain responsible for proving the CLI target before deployment-affecting commands.

The database stores only the code hash, but the pinned package separately passes the plaintext code in the arguments logged by `createVerificationCodeImpl` when `AUTH_LOG_LEVEL=DEBUG`. This path is independent of the application's console delivery callback. Keep package DEBUG logging disabled except in the same explicitly verified local environment, and never enable it in cloud or production. Ordinary console delivery remains the only intentional plaintext-code output.

## Executable verification strategy

No test dependency is added during this documentation task. Adding a placeholder harness would not test application behavior. Each later section starts by adding the named behavioral check, running the exact bounded command below, and observing the stated assertion failure before production changes:

- **Section 2 — routing/restoration:** add `scripts/test-auth-route-contract.sh`; run `bash scripts/test-auth-route-contract.sh`. **Expected red:** the contract reports the missing restoration wait, protected `(auth)` / `(onboarding)` / `(app)` groups, or non-unique `/` route. This is a static-contract exception because mounting Expo Router would test framework internals and require broad mobile test infrastructure; follow green static and TypeScript checks with bounded simulator restoration verification.
- **Section 3 — sign-in/signup UI policy:** add pure policy tests in `apps/mobile/src/features/auth/auth-policy.test.ts`; run `mise exec -- pnpm --filter @recovery/mobile exec node --experimental-strip-types --test src/features/auth/auth-policy.test.ts`. **Expected red:** normalized-email, ten-character guidance, safe-error mapping, or duplicate-submit assertions fail against missing policy code. Signup controls remain unavailable while the privacy gate above fails.
- **Section 4 — signup verification:** after adding `convex-test` and Vitest to the backend package with the first substantive backend test, run `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/auth.test.ts`. **Expected red:** secure six-digit generation, fail-closed delivery, incorrect/replaced/expired/consumed-code, delivery-failure retry, or lost-response recovery assertions fail. Do not expose signup merely to turn these green while its privacy gate is blocked.
- **Section 5 — profiles:** add `packages/backend/convex/profiles.test.ts`; run `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/profiles.test.ts`. **Expected red:** unauthenticated rejection, owner-scoped success, cross-user isolation, validation, persistence, or narrow-return-shape assertions fail before profile functions exist.
- **Section 6 — reset:** add a reset privacy regression to `packages/backend/convex/auth.test.ts`; run `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/auth.test.ts -t "reset privacy"`. **Expected red:** absent and existing account requests do not have indistinguishable application-level outcomes. This intentional red confirms the task-specific verification exception: leave reset unavailable and record the blocker rather than weakening the assertion.
- **Section 7 — hardening/accessibility:** add `apps/mobile/src/features/auth/auth-interactions.test.ts`; run `mise exec -- pnpm --filter @recovery/mobile exec node --experimental-strip-types --test src/features/auth/auth-interactions.test.ts`. **Expected red:** safe-error, duplicate-submit, accessible-name, or alert-contract assertions fail. Compact layout, keyboard visibility, enlarged text, and screen-reader order remain explicit bounded simulator checks because the current repository has no interaction renderer; add one only if section 7 demonstrates that static/pure checks cannot cover an implemented contract.

Current baseline commands are:

```sh
mise exec -- pnpm --filter @recovery/mobile run check
mise exec -- pnpm --filter @recovery/backend run check
```

Sources inspected in the installed packages include `src/providers/Password.ts`, `src/providers/Email.ts`, `src/server/implementation/signIn.ts`, `createVerificationCode.ts`, `verifyCodeAndSignIn.ts`, `invalidateSessions.ts`, `src/react/client.tsx`, Auth.js `providers/email.d.ts`, and Expo Router `build/views/Protected.d.ts` / `build/layouts/JSStack.d.ts`.
