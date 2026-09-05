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

Overlapping replacement requests have a second unsafe ordering. Request A can commit its code, request B can replace it, and delivery B can finish before delivery A; the last delivered code (A) is then stale. A per-screen pending guard does not cover another client, restart, or retry. Signup verification and resend therefore have a concurrent-resend safety gate in addition to the privacy gate: before exposure, a backend concurrency test must force reversed delivery completion and prove that the last delivered code is redeemable. If the supported implementation cannot enforce that property, keep signup/resend unavailable rather than relying on client serialization.

Successful code redemption consumes the code and creates a session before the client receives and persists tokens. The client retries network failures, so a lost successful response can be retried with an already consumed code. Token installation is also non-atomic: it updates the in-memory access token, then writes the access token and refresh token separately to SecureStore before publishing authenticated React state. Restoration can accept a residual valid access token without a refresh-token pair, so application code cannot honestly promise pair-atomic persistence or fail-closed cleanup under selective SecureStore write/removal failures. This is a pinned provider session-consistency limitation, not evidence of cross-user authorization: backend token validation remains authoritative. The operator accepts deferral rather than a custom token-storage fork for this milestone. Signup and verification remain unavailable; a future milestone must explicitly accept, wrap, or replace this behavior before exposure.

## Signup and reset privacy gate

The pinned `signUp` implementation is observably account-dependent. An unknown email creates an account and starts verification; an existing password account with the wrong password throws an account-exists error; an existing unverified account with the correct password starts verification again; and an existing verified account with the correct password signs in. Sanitizing displayed error text does not remove the different completion, delivery, and authentication outcomes. Signup exposure is blocked unless a separately reviewed supported flow makes these cases indistinguishable or the fixed product decision is separately revised.

The pinned `reset` implementation is also observably account-dependent: it calls `retrieveAccount` and destructures its result before invoking the reset email provider. An absent password account therefore rejects while an existing password account proceeds to delivery and resolves without signing in. Uniform UI wording cannot normalize this protocol-level difference.

The operator accepts signup/verification and reset as reviewed feature-level deferrals for this milestone. Sections 2-3 and 5-8 proceed with provider-independent returning-user sign-in, routing, onboarding, protected home, sign-out, and hardening, but must not expose signup, verification, or reset controls. Do not add an account-discovery endpoint, inspect auth tables from the client, or claim enumeration resistance based only on presentation text.

The pinned `reset-verification` implementation does satisfy the session policy after successful verification: it updates the credential, calls `invalidateSessions` with the newly created session in `except`, and returns that session so the current device signs in while other sessions are removed.

## Expo Router protection

Expo Router 57.0.15 declares `Stack.Protected` with `{ guard: boolean; children?: ReactNode }`. Protected groups can therefore be expressed as sibling entries in the root stack, for example a protected `(auth)` screen when unauthenticated and protected `(onboarding)` / `(app)` screens when authenticated and profile state permits. The root layout must defer rendering those guards until Convex Auth restoration finishes. Route protection remains navigation UX, not backend authorization.

## Local console delivery boundary

Convex 1.44.0 has CLI-side knowledge of local deployment selection, but no documented server runtime flag available to an action that reliably proves the deployment is local. `CONVEX_AGENT_MODE=anonymous` affects CLI selection and is not a trustworthy server-runtime production detector. Console delivery must therefore fail closed unless `AUTH_EMAIL_DELIVERY=console` is explicitly configured in the already verified local deployment. That value must never be configured in cloud or production. The deployment guard and supervisor remain responsible for proving the CLI target before deployment-affecting commands.

The database stores only the code hash, but the pinned package separately passes the plaintext code in the arguments logged by `createVerificationCodeImpl` when `AUTH_LOG_LEVEL=DEBUG`. That call does not use `maybeRedact`, so `AUTH_LOG_SECRETS` cannot make this particular DEBUG record safe. This path is independent of the application's console delivery callback. `AUTH_LOG_LEVEL` and `AUTH_LOG_SECRETS` must remain unset whenever authentication codes can be generated. No code-generating email provider is enabled in this milestone, so the path is currently unreachable; before a future provider is enabled, a bounded local environment check and observed-log smoke test must prove that the intended delivery callback is the only plaintext-code output.

## Executable verification strategy

No test dependency is added during this documentation task. Adding a placeholder harness would not test application behavior. Each later section starts by adding the named behavioral check, running the exact bounded command below, and observing the stated assertion failure before production changes:

- **Section 2 — routing/restoration:** add `scripts/test-auth-route-contract.sh`; run `bash scripts/test-auth-route-contract.sh`. **Expected red:** the contract reports the missing restoration wait, protected `(auth)` / `(onboarding)` / `(app)` groups, or non-unique `/` route. This is a static-contract exception because mounting Expo Router would test framework internals and require broad mobile test infrastructure; follow green static and TypeScript checks with bounded simulator restoration verification.
- **Section 3 — sign-in/signup UI policy:** add pure policy tests in `apps/mobile/src/features/auth/auth-policy.test.ts`; run `mise exec -- pnpm --filter @recovery/mobile exec node --experimental-strip-types --test src/features/auth/auth-policy.test.ts`. **Expected red:** normalized-email, ten-character guidance, or safe-error mapping assertions fail against missing policy code. Separately add `apps/mobile/src/features/auth/auth-submission.test.ts` around the submission state machine and run the same command with that file; **expected red:** two immediate submit attempts produce one auth call and retain values after failure. A bounded simulator double-tap check verifies the rendered handler is wired to that state machine because the repository has no interaction renderer. Signup controls remain unavailable while the privacy gate above fails.
- **Section 4 — accepted signup/verification deferral:** no provider or placeholder test harness is added. The installed-source contract and fresh reviews establish the privacy, concurrent-resend, and provider token-persistence limitations. **Verification exception:** assert statically that no signup/verification route or control and no code-generating email provider is registered. Before any future provider is enabled, add backend lifecycle/concurrency tests, mobile state tests, a bounded SecureStore fault-injection decision, and a local environment/log-output smoke check proving `AUTH_LOG_LEVEL` and `AUTH_LOG_SECRETS` are unset and only the delivery callback emits plaintext codes.
- **Section 5 — profiles:** add `packages/backend/convex/profiles.test.ts`; run `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/profiles.test.ts`. **Expected red:** unauthenticated rejection, owner-scoped success, cross-user isolation, validation, persistence, or narrow-return-shape assertions fail before profile functions exist.
- **Section 6 — reset:** add a reset privacy regression to `packages/backend/convex/auth.test.ts`; run `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/auth.test.ts -t "reset privacy"`. **Expected red:** absent and existing account requests do not have indistinguishable application-level outcomes. This intentional red confirms the task-specific verification exception: leave reset unavailable and record the blocker rather than weakening the assertion.
- **Section 7 — hardening/accessibility:** add `apps/mobile/src/features/auth/auth-interactions.test.ts`; run `mise exec -- pnpm --filter @recovery/mobile exec node --experimental-strip-types --test src/features/auth/auth-interactions.test.ts`. **Expected red:** safe-error, accessible-name, or alert-contract assertions fail. Recheck rendered duplicate-submit wiring together with compact layout, keyboard visibility, enlarged text, and screen-reader order in explicit bounded simulator checks because the current repository has no interaction renderer; add one only if section 7 demonstrates that static/state-machine checks cannot cover an implemented contract.

Current baseline commands are:

```sh
mise exec -- pnpm --filter @recovery/mobile run check
mise exec -- pnpm --filter @recovery/backend run check
```

Sources inspected in the installed packages include `src/providers/Password.ts`, `src/providers/Email.ts`, `src/server/implementation/signIn.ts`, `createVerificationCode.ts`, `verifyCodeAndSignIn.ts`, `invalidateSessions.ts`, `src/react/client.tsx`, Auth.js `providers/email.d.ts`, and Expo Router `build/views/Protected.d.ts` / `build/layouts/JSStack.d.ts`.

## WorkOS session lifetime (#30, approved #12 extension)

The historical Convex Auth notes above are not the current mobile session owner.
`createWorkOSSessionOwner` owns a process-local, non-identity `lifetime` discriminator.
Establishing/restoring/replacing a session and terminal invalidation/revocation advance it;
authenticated token rotation, transient refresh failure, and retry retain it. Credential
operations are serialized through persistence, with single-flight refresh and no refresh
during revocation, so old refresh writes cannot overwrite a replacement session.

Auth actions use the installed SDK's independent, unauthenticated `ConvexHttpClient`
transport. Refresh takes a refresh-token argument, not the current user's JWT, and must
complete while the sync client's authentication manager has stopped its WebSocket.
The session owner and persistence serialization do not depend on the sync client.

The lifetime keys a fresh sync client, Convex auth provider, and protected route subtree.
Clients are created in effect setup, not render; every cleanup retires its client and
closes it after descendant auth cleanup. StrictMode setup allocates another client rather
than reviving a closed one. Token callbacks check the authoritative lifetime before and
after awaiting, so an old client cannot obtain replacement credentials. Each new
lifetime must obtain `useConvexAuth` server confirmation before reading `profiles.getMine`;
that query does not identify its owner and must not be carried across lifetimes. Only a
confirmed, onboarding-complete result establishes a lifetime-local readiness latch. Initial
restoration, sign-in, and incomplete onboarding remain gated. This is presentation readiness,
not authentication authority: all Convex authorization remains server-enforced.

Once ready, transient authentication refresh and profile-query retry leave the protected
Stack, Counts draft owners, and pending submission owners mounted. The profile observer has
its own sibling error boundary; retry remounts only that observer. Refresh retry is sibling
presentation, not a replacement navigator. Successful sign-out, terminal invalidation, and
account replacement discard the keyed subtree and readiness. Failed revocation retains the
existing session and sync client (including pending same-lifetime requests) for retry.
Retained UI state is not a cross-session offline queue: unsent requests from a retired
client are never transferred to the replacement client. Closing a client does not undo
already-sent or committed server writes, nor establish whether a lost response committed.
Those uncertain writes remain governed by server authorization at execution time; this
change does not claim cancellation or add identity binding. Pending screen state belongs
to the discarded subtree; late completion cannot mount its navigation effect.
No profile/identity store, persistent offline cache,
new dependencies, or backend authorization changes are introduced.

Reducer/policy/session-owner tests exercise lifetime and operation behavior. Installed-SDK
HTTP and stopped-WebSocket stubs demonstrate independent refresh; client-factory tests
exercise retirement, setup/cleanup replay, stable retry clients, and stale-token rejection.
These are local transport/lifecycle probes, not deployed-network or mounted React tests. TSX source
contracts are structural checks, not evidence of mounted Expo navigation or native recovery.
Device disconnect/reconnect, native draft persistence, and actual Convex-provider effect
ordering still require runtime validation and independent review.

After the server confirms invalidation/revocation, SecureStore deletion failure cannot
restore authenticated presentation: the in-memory session is discarded and lifetime advances.
Residual credentials on disk remain subject to mandatory server validation on restart.
