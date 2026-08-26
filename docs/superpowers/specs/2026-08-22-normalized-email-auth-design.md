# Local Email Signup and Recovery Design

## Summary

Add public-response-neutral password signup and account recovery to the local Recovery app. Convex Auth remains the only owner of identity, passwords, sessions, and tokens. Account-specific guidance appears only in the submitted mailbox channel. This milestone uses a local console delivery adapter. Resend and real inbox delivery move to a future milestone.

The work starts with a hard feasibility proof. The installed `@convex-dev/auth` version `0.0.95` does not expose a supported hook that can consume an application challenge in the same transaction as account creation or password replacement. First inspect a targeted Auth package upgrade. If necessary, inspect the minimum compatible Convex stack upgrade. Both signup and recovery must pass the atomicity proof before implementation starts. If no compatible version supports both flows, stop and design a WorkOS replacement.

Direct auth-table writes, a parallel password store, client account lookup, a second session system, and non-atomic challenge reservation are prohibited. Local auth and profile data can be reset after an upgrade or provider change. Production migration is out of scope.

## Product and privacy behavior

### Public boundary

For every syntactically valid signup or recovery email, the public initiation API returns only:

```ts
{ accepted: true }
```

The client never receives account existence, provider type, delivery status, rate-limit state, or raw backend errors. Malformed email can receive a format error because this does not disclose account state. The system does not claim cryptographic timing equality and does not add artificial delays.

The app starts the 60-second resend cooldown after every accepted response. A hidden delivery failure can make the user wait for this cooldown.

### Shared email normalization

One pure function normalizes email for the gateway and Convex Auth. It removes leading and trailing spaces and converts letters to lowercase. It does not remove dots, plus tags, or other provider-specific parts. The normalized value is used for account lookup, challenge binding, fingerprinting, and delivery.

### Signup

1. The user submits an email.
2. The server normalizes it, applies rate limits, and classifies account state internally.
3. A new address receives a six-digit signup code through the configured delivery adapter.
4. An existing password account receives private sign-in and recovery guidance.
5. A future Google-only or Apple-only account receives private guidance that names its linked provider.
6. The app always shows neutral Check your email text.
7. The user submits the code, password, and password confirmation in one operation.
8. The server checks public password rules before it checks the code.
9. Convex Auth consumes the valid challenge atomically with password-account creation.

No grant moves through the client. If account state changes before completion, the request fails with a safe error and does not reveal the new state.

### Recovery

1. The user submits an email.
2. The public response remains `{ accepted: true }`.
3. An existing account for the configured password provider receives a six-digit recovery code.
4. An unknown address receives no delivery.
5. A future Google-only or Apple-only account receives private guidance that names its linked provider.
6. The app always shows: “Check your email. If you have an account with that email, you’ll receive recovery instructions shortly.”
7. The user submits the code, new password, and password confirmation in one operation.
8. The server checks public password rules before it checks the code.
9. Convex Auth consumes the valid challenge atomically with password replacement, signs in the current device, and invalidates all other sessions.

Unknown-address non-delivery reveals state to a person who controls and observes that mailbox. This accepted tradeoff does not change the neutral public UI and API.

### Safe completion errors

Absent, incorrect, expired, consumed, exhausted, and inapplicable codes use one safe error: “That code is invalid or has expired. Request new instructions and try again.” An invalid password does not consume the code and does not count as a code attempt. Raw backend errors never appear in the app.

## Local delivery copy

The console adapter renders the same message intent that a future email adapter will use.

### New-address signup

Subject: `Your Recovery Tracker verification code`

> **Verify your email**  
> Enter this code in Recovery Tracker to continue creating your account:  
> **123456**  
> This code expires in 10 minutes. If you didn’t request this, ignore this message.

### Existing password account

Subject: `Recovery Tracker account information`

> **You already have an account**  
> Return to Recovery Tracker and sign in with your password.  
> If you don’t remember your password, choose **Account recovery**.

### Password recovery

Subject: `Your Recovery Tracker recovery code`

> **Reset your password**  
> Enter this code in Recovery Tracker to choose a new password:  
> **123456**  
> This code expires in 10 minutes. Completing recovery signs out your other sessions.

### Future non-password account guidance

When Google or Apple sign-in exists, signup and recovery requests send private guidance that names the linked provider, such as “Return to the app and select Continue with Google.” Social sign-in and account linking are not part of this milestone.

## Architecture

### Backend boundaries

```text
packages/backend/convex/
  auth.ts
  authEmailIntents.ts
  authEmailIntentsInternal.ts
  authEmailDelivery.ts
  authEmailTemplates.ts
  crons.ts
  schema.ts
```

- `auth.ts` configures Convex Auth and the supported atomic challenge hooks.
- `authEmailIntents.ts` exposes narrow, validator-backed initiation and completion APIs.
- `authEmailIntentsInternal.ts` owns private account classification, challenge transitions, and rate limits.
- `authEmailDelivery.ts` owns the console adapter and a narrow interface for a future email adapter.
- `authEmailTemplates.ts` owns typed message rendering.
- `crons.ts` schedules bounded cleanup.
- `schema.ts` adds challenge and rate-limit records with required indexes.

Every public Convex function declares argument and return validators. Account classification never crosses the public boundary. Public application functions continue to derive identity on the server and authorize owned resources.

### Mobile boundaries

```text
apps/mobile/src/features/auth/
  signup/
  recovery/
  email-intent-policy.ts

apps/mobile/src/app/(auth)/
  sign-up.tsx
  verify-email.tsx
  forgot-password.tsx
  reset-password.tsx
```

Routes remain composition-only. Feature modules own form state, validation, pending state, safe error mapping, and Convex calls. The signup completion screen collects code and password together. The recovery completion screen does the same. No grant is stored in memory, SecureStore, route parameters, or URLs. Shared UI stays independent of Expo Router, Convex, and feature modules. Convex Auth continues to own session state, and `ConvexAuthProvider` continues to own SecureStore token persistence.

## Challenge model

```ts
{
  emailFingerprint: string,
  purpose: "signup" | "recovery",
  codeHash: string,
  encryptedCode: string,
  expiresAt: number,
  resendAfter: number,
  failedAttempts: number,
  consumedAt?: number,
  deliveredAt?: number,
}
```

- The code is six cryptographically random digits and is handled as a string.
- `emailFingerprint` is a keyed HMAC of the normalized email.
- `codeHash` verifies submitted codes.
- `encryptedCode` permits safe reuse of the same active code.
- Fingerprint and encryption keys are separate.
- A key change invalidates all active challenges. This milestone does not support key versions.
- No password or account/provider classification is stored in the challenge.
- One active challenge exists per normalized email and purpose.
- Passwords remain transient auth input and do not enter challenge storage.

The server must consume the challenge in the same transaction as the supported credential operation. There is no separate grant record or plaintext grant.

## Request orchestration and concurrency

A public Convex action orchestrates initiation:

1. Normalize the email.
2. Ask an internal mutation to classify account state, enforce limits, and prepare or reuse an active challenge.
3. Invoke the console delivery adapter when delivery is appropriate.
4. Record a redacted outcome internally.
5. Return `{ accepted: true }`.

Signup emits a code or private existing-account guidance for each accepted request that passes internal limits. Recovery emits a code only for a password account. Future social accounts emit provider-specific guidance. Unknown recovery addresses emit nothing.

Initial limits per normalized email fingerprint are:

- 5 initiation requests per 15 minutes.
- 60-second resend cooldown.
- 5 incorrect code attempts per active challenge.
- 10-minute code lifetime.
- One active challenge per email and purpose.

A resend reuses the same active code and does not reset failed attempts. A delivery timeout or uncertain result also reuses that code. This can cause duplicate messages, but all messages contain the same valid code. After five incorrect attempts, the challenge is invalid. A new request remains subject to the normal cooldown and rate limit. IP limiting is excluded because the server does not have a trusted original client IP.

Tests force simultaneous initiation, reversed delivery completion, uncertain delivery and retry, racing completion, challenge replay, account creation between issuance and completion, and password recovery racing another session or reset. A race must not authorize another email or purpose or reveal account state.

## Delivery adapter and logging

This milestone supports only:

```text
AUTH_EMAIL_DELIVERY=console
```

Missing or unknown delivery configuration fails closed internally while public initiation stays neutral. The console adapter prints the purpose, masked email, six-digit code or guidance intent, and expiry. Example:

```text
signup j***@example.com code 123456 expires in 10 minutes
```

It does not print the full email address. Other logs can include purpose, keyed fingerprint, delivery mode, outcome category, and rate-limit decision. Other logs must not include passwords, codes, full email addresses, secrets, or raw sensitive payloads. Resend, real inbox delivery, sender-domain setup, and production email configuration are a future milestone.

## Cleanup

A scheduled Convex cron performs bounded cleanup of expired or consumed challenges and expired rate-limit records. The implementation plan will define its interval, batch size, indexes, retention boundary, and retry-safe behavior. The cron must not require a cloud or production deployment.

## Feasibility gate

Before schema, delivery, or UI implementation:

1. Inspect version-current Convex Auth release notes, source, types, and peer requirements.
2. First evaluate a targeted `@convex-dev/auth` upgrade.
3. If required, evaluate the minimum compatible Convex stack update.
4. Do not upgrade Expo, React, or React Native for this work.
5. Prove that signup consumes a challenge atomically with password-account creation.
6. Prove that recovery consumes a challenge atomically with password replacement, current-device sign-in, and other-session invalidation.
7. Prove single-use behavior under racing requests.
8. Prove that the design uses no direct auth-table writes, client account lookup, parallel password database, or second token/session system.

Both signup and recovery must pass. Partial implementation is not permitted. Do not change dependencies until a candidate version proves the required hook and compatibility. If no compatible Convex Auth version supports both flows, stop and present a WorkOS design. Do not fall back to a non-atomic reservation model.

The local Convex auth and profile data can be reset after an approved package or provider change. Existing local account migration is not required.

## Verification strategy

### Backend automation

Tests cover neutral initiation, internal-only classification, password-only recovery eligibility, future provider-guidance selection boundaries, shared normalization, HMAC fingerprinting, secure six-digit generation, hash verification, encrypted code reuse, key-change invalidation, expiry, attempts, cooldown, rate limits, scheduled cleanup, challenge replay, account-state races, session invalidation, validators, narrow return shapes, and redacted logs. Delivery uses a fake or captured console adapter.

Tests also prove that invalid passwords are rejected before code verification and do not consume a challenge or increment failed attempts.

### Mobile automation

Tests cover neutral result states, shared email policy, combined code-and-password validation, duplicate-submit prevention, value retention, cooldown after every accepted initiation, safe error mapping, route transitions, and absence of raw backend errors.

### Local manual verification

With local Convex and console delivery, verify:

1. New-address signup code and account creation.
2. Existing-account signup guidance.
3. Existing password-account recovery and password replacement.
4. Unknown recovery emits no delivery while the app stays neutral.
5. Code expiry, resend reuse, and attempt exhaustion.
6. Signup continues into profile onboarding.
7. Recovery signs in the current device and invalidates prior sessions.
8. Console output masks email, and other logs contain no password, code, full email, or secret.
9. The cleanup cron removes bounded expired records.

No Resend call, cloud Convex deployment, production database, EAS build, or production DNS change is included.

## Delivery sequence

1. Complete the upgrade and atomicity feasibility proof.
2. If the proof fails, stop and present a WorkOS design.
3. If the proof passes, obtain approval for the exact dependency change.
4. Add challenge and rate-limit behavior through tests.
5. Add console delivery and templates.
6. Add the cleanup cron.
7. Add combined signup UI.
8. Add combined recovery UI.
9. Add multi-user and session verification.
10. Complete local manual verification and fresh security, authorization, accessibility, and product review.

## Completion criteria

The milestone is complete only when both signup and recovery use neutral public initiation, private account-specific console intents, secure and rate-limited challenges, atomic Convex Auth credential operations, correct session invalidation, scheduled cleanup, passing focused/package checks, and local manual evidence. Resend and production delivery are explicitly deferred. If the feasibility proof fails, implementation stops with a precise compatibility report and a proposed WorkOS design.
