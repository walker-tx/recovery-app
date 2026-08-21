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

The package calls `generateVerificationToken()` when supplied; otherwise it generates a 32-character token. The application will supply a cryptographically generated six-digit string. Because a six-character token is shorter than 24 characters, the package's `Email` helper requires the matching email during redemption. Do not override that authorization check.

A verification code is stored only as a SHA-256 hash. Creating another code for the same account deletes the existing code before inserting the replacement. Verification checks the hash, provider, matching-email authorization, and expiration, then deletes the code after all checks pass. Codes are therefore expiring, replaced on resend, and single-use. `Email(...)` defaults to one hour; the lower-level fallback is 24 hours when a provider supplies no `maxAge`. The package does not impose a resend cooldown, so the planned sixty-second cooldown is client-side UX only and must not be described as server enforcement.

## Reset privacy gate

The pinned `reset` implementation is observably account-dependent: it calls `retrieveAccount` and destructures its result before invoking the reset email provider. An absent password account therefore rejects while an existing password account proceeds to delivery and resolves without signing in. Uniform UI wording cannot normalize this protocol-level difference.

Section 6 remains blocked from exposure unless a separately reviewed supported solution removes that difference. Do not add an account-discovery endpoint, inspect auth tables from the client, or claim enumeration resistance based only on presentation text. The remainder of password auth is not blocked.

The pinned `reset-verification` implementation does satisfy the session policy after successful verification: it updates the credential, calls `invalidateSessions` with the newly created session in `except`, and returns that session so the current device signs in while other sessions are removed.

## Expo Router protection

Expo Router 57.0.15 declares `Stack.Protected` with `{ guard: boolean; children?: ReactNode }`. Protected groups can therefore be expressed as sibling entries in the root stack, for example a protected `(auth)` screen when unauthenticated and protected `(onboarding)` / `(app)` screens when authenticated and profile state permits. The root layout must defer rendering those guards until Convex Auth restoration finishes. Route protection remains navigation UX, not backend authorization.

## Local console delivery boundary

Convex 1.44.0 has CLI-side knowledge of local deployment selection, but no documented server runtime flag available to an action that reliably proves the deployment is local. `CONVEX_AGENT_MODE=anonymous` affects CLI selection and is not a trustworthy server-runtime production detector. Console delivery must therefore fail closed unless `AUTH_EMAIL_DELIVERY=console` is explicitly configured in the already verified local deployment. That value must never be configured in cloud or production. The deployment guard and supervisor remain responsible for proving the CLI target before deployment-affecting commands.

## Executable verification strategy

No test dependency is added during this documentation task. Adding a placeholder harness would not test application behavior. The bounded strategies for later sections are:

- **Routing/restoration:** introduce the smallest mobile render test only if the installed Expo/React Native versions admit a focused harness without broad setup; otherwise use a TypeScript/static route-contract red check and record the framework-behavior verification exception, then perform bounded simulator verification.
- **Sign-in/sign-up UI:** extract pure normalization, validation, and safe-error mapping only when implemented; test those observable policies with Node's built-in test runner or the smallest compatible interaction harness chosen at that task.
- **Verification/reset backend:** add `convex-test` with the first backend behavior and drive registered auth behavior against the generated API. Focus on incorrect, replaced, expired, and consumed codes without exposing code values.
- **Profiles:** use `convex-test` for unauthenticated rejection, owner success, cross-user isolation, validation, persistence, and narrow return shape.
- **Accessibility and duplicate submission:** add a mobile interaction harness only when the controls exist and it can assert accessible roles/labels and pending behavior; otherwise record bounded simulator checks rather than speculative tooling.

Current baseline commands are:

```sh
mise exec -- pnpm --filter @recovery/mobile run check
mise exec -- pnpm --filter @recovery/backend run check
```

Sources inspected in the installed packages include `src/providers/Password.ts`, `src/providers/Email.ts`, `src/server/implementation/signIn.ts`, `createVerificationCode.ts`, `verifyCodeAndSignIn.ts`, `invalidateSessions.ts`, `src/react/client.tsx`, Auth.js `providers/email.d.ts`, and Expo Router `build/views/Protected.d.ts` / `build/layouts/JSStack.d.ts`.
