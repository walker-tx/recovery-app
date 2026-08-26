# WorkOS Local Signup and Recovery Design

## Summary

Replace Convex Auth with WorkOS AuthKit for identity, password, and session ownership. Keep native Expo auth screens and use the WorkOS Authentication API through local Convex. Use WorkOS Emulate for local development and automated tests. Use a small WorkOS staging check before milestone completion. Do not deploy to production.

This milestone supports password signup, six-digit WorkOS email verification, returning-user password sign-in, password recovery with a WorkOS reset token, protected routing, server-owned profiles, onboarding, session restoration, refresh, and sign-out. Console delivery replaces real email. Resend, real inbox delivery, social sign-in, and reset deep links move to future milestones.

WorkOS remains the only owner of user identities, password hashes, verification records, reset tokens, access tokens, refresh tokens, sessions, and session revocation. Convex owns neutral public gateways, temporary encrypted signup intents, local rate limits, application profiles, and application authorization. The app does not run Convex Auth and WorkOS at the same time.

## Scope

### Included

- Native Expo password signup.
- Six-digit WorkOS email verification.
- Returning-user password sign-in.
- WorkOS password recovery with a one-time reset token.
- WorkOS session restoration, refresh, and sign-out.
- Protected Convex data and profile onboarding.
- Local testing with WorkOS Emulate.
- A bounded WorkOS staging verification.
- Console delivery only.

### Excluded

- Production deployment or credentials.
- Resend and real email delivery.
- Google, Apple, or other social sign-in.
- Password-reset deep links.
- Existing local account or profile migration.
- Two active auth or session systems.

Local Convex Auth and profile data can be reset during the migration.

## Product and privacy behavior

### Shared email normalization

One pure function normalizes email for the gateway and WorkOS calls. It removes leading and trailing spaces and converts letters to lowercase. It does not remove dots, plus tags, or other provider-specific parts. The normalized value is used for account lookup, fingerprinting, rate limits, intent binding, and delivery.

### Public boundary

For syntactically valid signup initiation, the public API returns only:

```ts
{ accepted: true, intentId: string }
```

For syntactically valid recovery initiation, the public API returns only:

```ts
{ accepted: true }
```

The client never receives account existence, provider type, delivery status, rate-limit status, a WorkOS user ID, a WorkOS pending-authentication token, a verification code, a reset token, or raw WorkOS errors from initiation. Password-format errors can appear because they do not depend on account state. Sign-in maps unknown-account and wrong-password failures to the same safe error.

The client starts a 60-second resend cooldown after every accepted initiation response. The system does not claim cryptographic timing equality and does not add artificial delays.

### Private guidance

The console adapter is the private delivery channel for this milestone. It can provide account-specific guidance while the public UI and API remain neutral.

- Existing password account: return to password sign-in or use account recovery.
- Future Google-only account: return and select Continue with Google.
- Future Apple-only account: return and select Continue with Apple.

Provider-specific guidance applies to signup and recovery. Social sign-in is not implemented in this milestone.

## Signup

1. The user enters email, password, and password confirmation.
2. The app checks public email and password-format rules.
3. Convex normalizes the email and applies local rate limits.
4. Convex calls WorkOS through the official Node SDK.
5. WorkOS creates or resumes an unverified password account.
6. WorkOS creates a six-digit email verification code.
7. Because default WorkOS email delivery is disabled, Convex retrieves the verification object.
8. The console adapter prints the purpose, masked email, code, and expiry.
9. Convex encrypts the WorkOS pending-authentication token in a short-lived signup intent.
10. Convex returns `{ accepted: true, intentId }`.
11. The app keeps the opaque intent ID in memory only.
12. The user enters the six-digit code.
13. Convex loads the intent and sends the code and pending token to WorkOS.
14. WorkOS verifies the email and creates the session.
15. The app stores the WorkOS access and refresh tokens in Expo SecureStore.
16. The user continues to profile onboarding.

The app does not create its own signup challenge or grant. WorkOS owns the verification credential and its consumption. If the app closes before verification, the intent ID is lost and the user restarts signup. WorkOS keeps abandoned unverified accounts. A later signup request can resume verification. Automatic deletion of unverified WorkOS accounts is outside this milestone.

An existing account receives the same public response shape. Its intent record contains private guidance state but no WorkOS pending-authentication token. Invalid, expired, consumed, and inapplicable intents or codes use one safe error.

## Password recovery

1. The user enters an email.
2. Convex normalizes the email and applies local rate limits.
3. Convex classifies account state only on the server.
4. For an existing password account, WorkOS creates a one-time password-reset token.
5. The console adapter prints the purpose, masked email, reset token or reset URL, and expiry.
6. An unknown address produces no console delivery.
7. A future social-only account produces private provider guidance.
8. Convex always returns `{ accepted: true }`.
9. The user copies the reset token from the console and pastes it into the app.
10. The user enters and confirms a new password.
11. WorkOS resets the password and revokes all active sessions.
12. The app returns the user to sign-in.
13. The user signs in with the new password and creates a new session.

The app does not add a six-digit recovery challenge. The reset token is never stored in a Convex application table. Deep-link handling and real reset email move to the future email milestone. Unknown-address non-delivery can reveal state to a person who controls and observes that mailbox in the future. This accepted tradeoff does not change the neutral public UI and API.

## Session ownership and mobile state

One app-level WorkOS auth provider is the authoritative mobile session owner. It owns:

- SecureStore access.
- Startup restoration.
- Access-token and refresh-token state.
- Refresh serialization.
- Sign-in and sign-out.
- Safe retry state.

Auth feature screens do not own session tokens. Refresh tokens rotate, so the provider permits only one refresh operation at a time. The app sends a refresh token only to a Convex action. The action calls WorkOS with the server secret and returns the rotated token pair. Convex does not store refresh tokens in application tables.

A transient network or WorkOS error during restoration does not delete the stored session. The app keeps the refresh token and shows a retry state. It signs out only when WorkOS reports that the session is invalid or expired. Protected routes do not flash while restoration is unresolved.

Sign-out first asks Convex to revoke the WorkOS session. The app clears SecureStore only after WorkOS confirms revocation. If revocation fails, the app keeps the local session and shows a safe retry error.

## Convex authentication and authorization

Convex uses one `customJwt` auth provider for the selected WorkOS mode. It validates the issuer, WorkOS client ID audience, JWKS, and `RS256` signature.

The selected mode is explicit:

```text
WORKOS_MODE=emulator
```

or:

```text
WORKOS_MODE=staging
```

Local Convex trusts only the selected issuer and key set. A mode change requires a local Convex sync or restart. Convex does not trust emulator and staging tokens at the same time. Production will use a separate configuration in a future milestone.

Protected functions use the validated WorkOS `sub` claim as the profile owner key. Profiles do not use a local user-mapping table. Every public function keeps argument and return validators, derives identity on the server, and checks resource ownership.

## Backend boundaries

Proposed backend files are:

```text
packages/backend/convex/
  auth.config.ts
  workos.ts
  workosAuth.ts
  workosAuthInternal.ts
  authEmailDelivery.ts
  authEmailTemplates.ts
  crons.ts
  profiles.ts
  schema.ts
```

- `auth.config.ts` selects one WorkOS JWT trust configuration.
- `workos.ts` constructs the official SDK client from server-only configuration.
- `workosAuth.ts` exposes narrow public initiation, completion, sign-in, refresh, and sign-out actions.
- `workosAuthInternal.ts` owns private classification, encrypted intent transitions, and rate limits.
- `authEmailDelivery.ts` owns the console delivery adapter and the future delivery interface.
- `authEmailTemplates.ts` owns typed message rendering.
- `crons.ts` schedules bounded cleanup.
- `profiles.ts` uses the WorkOS subject as owner.
- `schema.ts` stores signup intents, rate-limit records, and profiles.

WorkOS API keys and intent cryptographic keys stay in the local Convex environment. They never use `EXPO_PUBLIC_*` variables and never enter repository environment files. Passwords pass through a Convex action to WorkOS but are never stored or logged by the app.

## Mobile boundaries

Proposed mobile files are:

```text
apps/mobile/src/features/auth/
  session/
  signin/
  signup/
  recovery/
  auth-error-policy.ts
  email-policy.ts

apps/mobile/src/app/(auth)/
  sign-in.tsx
  sign-up.tsx
  verify-email.tsx
  forgot-password.tsx
  reset-password.tsx
```

Routes remain composition-only. Feature modules own forms, validation, pending state, safe error mapping, and Convex calls. Shared UI does not import Convex, Expo Router, or feature modules. Access and refresh tokens remain in Expo SecureStore. Signup intent IDs remain in memory. Reset tokens are entered manually and do not appear in route parameters or URLs.

## Delivery and logging

This milestone supports only console delivery. The adapter prints the purpose, masked email, credential or guidance intent, and expiry. Example:

```text
signup j***@example.com code 123456 expires in 10 minutes
```

It does not print the full email address. The console adapter is the only logger that can print verification codes or reset tokens. Other logs can include purpose, keyed email fingerprint, provider mode, outcome category, and rate-limit decision. Other logs must not include passwords, access tokens, refresh tokens, pending-authentication tokens, reset tokens, codes, full email addresses, API keys, encryption keys, or raw sensitive WorkOS payloads.

WorkOS staging default email delivery stays disabled. Resend, WorkOS real email delivery, sender domains, and production email configuration are future work.

## Intent, rate-limit, and cleanup model

Signup intents store an opaque public ID, keyed email fingerprint, purpose, encrypted WorkOS pending-authentication token when applicable, private guidance category when applicable, expiry, and consumed timestamp. The plaintext WorkOS token is never stored. Existing-account intents use the same public shape without a pending token.

Email fingerprints use a keyed HMAC of the normalized email. Intent encryption uses a separate key. A key change invalidates active signup intents. Multiple key versions are not supported in this milestone.

Initial gateway limits are:

- 5 initiation requests per 15 minutes for each keyed email fingerprint.
- A 60-second client resend cooldown after each accepted response.
- WorkOS provider limits as a second layer.
- No claimed IP limit because ordinary Convex functions do not provide a trusted original client IP.

Rate-limit decisions stay private. A scheduled Convex cron removes bounded batches of expired or consumed signup intents and expired rate-limit records. The implementation plan defines the interval, indexes, retention boundary, batch size, and retry-safe behavior.

## WorkOS Emulate and staging

The backend uses pinned versions of the official `@workos-inc/node` SDK and `@workos/emulate`. The emulator is a backend development dependency. Automated tests start isolated in-process emulator instances. A Mise task starts a standalone emulator for manual testing. No Homebrew or Docker installation is required.

WorkOS Emulate provides seeded users, password authentication, email verification, password reset, access and refresh tokens, refresh rotation, session revocation, JWKS, deterministic state, and failure injection. It is in-memory, performs no real authentication, and must never receive production data or secrets.

A bounded WorkOS staging check is required before milestone completion. It uses a staging API key and client ID in the local Convex environment. Default WorkOS email delivery remains disabled. Convex retrieves verification and reset credentials for console delivery. Production credentials and deployment are excluded.

## Hard feasibility gate

Before Convex Auth removal or WorkOS migration, a small proof must show:

1. The official WorkOS SDK can use WorkOS Emulate through a custom base URL.
2. Local Convex can fetch the emulator JWKS.
3. Convex accepts a valid emulator access token.
4. Convex rejects a token with the wrong issuer.
5. Convex rejects a token with the wrong audience.
6. Refresh-token rotation works through a Convex action.
7. WorkOS password reset revokes all previous sessions.
8. WorkOS staging returns verification and reset credentials while default email delivery is disabled.
9. Signup and recovery initiation keep their neutral public response shapes.

The proof must include package versions, configuration shape, and focused evidence. It must not change the full auth architecture. If any required item fails, stop the migration and return to design.

## Verification strategy

### Emulator-backed backend tests

Tests cover signup, resumed verification, existing-account guidance, recovery eligibility, unknown recovery, password reset, old-session revocation, sign-in error normalization, token refresh rotation, replay failure, issuer and audience rejection, shared email normalization, encrypted intent handling, HMAC fingerprints, expiry, rate limits, scheduled cleanup, narrow validators, and redacted logging. Each parallel worker uses an isolated emulator and user.

### Convex authorization tests

Tests drive at least two WorkOS subjects. They prove unauthenticated rejection, owner-scoped profile access, cross-user read/write refusal, onboarding persistence, and narrow return shapes.

### Mobile tests

Tests cover startup restoration, no route flash, refresh serialization, transient retry, invalid-session sign-out, guarded sign-out, SecureStore behavior, neutral initiation screens, password-format validation, in-memory signup intent handling, code validation, manual reset-token input, safe error mapping, duplicate-submit prevention, and protected routing.

### Manual emulator verification

Verify new signup, resumed signup, existing-account guidance, returning sign-in, unknown recovery non-delivery, password reset, old-session revocation, post-reset sign-in, profile onboarding, restoration, refresh, guarded sign-out, masked console output, and cleanup.

### Manual staging verification

Verify the SDK boundary, custom email-disabled verification retrieval, password reset retrieval, token claims, refresh rotation, session revocation, and neutral public responses. Do not use production credentials or send real email.

## Delivery sequence

1. Complete the WorkOS Emulate and staging feasibility proof.
2. If the proof fails, stop and return to design.
3. If it passes, obtain approval for exact dependency and configuration changes.
4. Add the WorkOS SDK adapter and emulator-backed contract tests.
5. Replace Convex JWT trust and profile ownership.
6. Replace the mobile session provider and SecureStore flow.
7. Add signup intents, console verification, rate limits, and cleanup.
8. Add native signup and verification screens.
9. Add recovery initiation and manual reset-token completion.
10. Add multi-user, refresh, revocation, and race tests.
11. Complete emulator and staging manual verification.
12. Complete fresh security, authorization, accessibility, simplicity, and product review.

## Completion criteria

The milestone is complete only when WorkOS is the sole auth owner; signup, verification, sign-in, recovery, refresh, sign-out, protected routing, profiles, and onboarding work through local Convex; public initiation stays neutral; tokens and secrets follow the storage rules; old sessions are revoked after reset; focused and package checks pass; emulator manual verification passes; and the bounded WorkOS staging check passes. Real email and production delivery remain explicitly deferred.
