# Normalized Email Signup and Recovery Design

## Summary

Add public-response-neutral email signup and account recovery to the Recovery app while retaining Convex Auth as the identity, password, session, and token owner. Account-specific guidance is disclosed only through email. Resend is integrated and exercised from the local Convex deployment; cloud and production deployment remain out of scope.

The implementation begins with a hard feasibility proof against the pinned `@convex-dev/auth` `0.0.95` APIs. It must prove that verified, single-use application grants can authorize password-account creation and password replacement through supported hooks. Direct auth-table writes, a parallel password store, client account lookup, and a forked token store are prohibited. Unsupported flows remain unavailable until an upgrade or provider decision is separately approved.

## Product and privacy behavior

### Public boundary

For every syntactically valid signup or recovery email, the public initiation API returns only:

```ts
{ accepted: true }
```

The client never receives account existence, provider type, delivery status, Resend identifiers, or raw provider errors. Malformed email may be rejected because format validation discloses no account state. Rate limits, delivery failures, and account classification remain internal.

The system follows the same broad server path for valid addresses but does not claim cryptographic timing indistinguishability and does not add artificial sleeps.

### Signup

1. The user submits an email.
2. The server normalizes it, rate-limits the intent, and classifies account state internally.
3. A new address receives a six-digit signup code.
4. An existing address receives private sign-in and account-recovery guidance.
5. The app always displays:

> **Check your email**  
> We sent instructions to the address you provided. Follow the email to continue.

6. A valid new-account code yields a short-lived, single-use signup grant.
7. The user chooses a password.
8. Convex Auth creates the password account only after consuming the verified grant through a supported hook.

The signup result screen offers Enter verification code, Use a different email, and Return to sign in. Absent, incorrect, expired, consumed, and inapplicable codes share the safe message: “That code is invalid or has expired. Request new instructions and try again.”

### Recovery

1. The user submits an email.
2. The public response remains `{ accepted: true }`.
3. An eligible existing password account receives a six-digit recovery code.
4. An unknown address receives no email.
5. The app always displays:

> **Check your email**  
> If you have an account with that email, you’ll receive recovery instructions shortly.

6. A valid recovery code yields a short-lived, single-use recovery grant.
7. Convex Auth replaces the password through a supported hook, signs in the current device, and invalidates other sessions.

The recovery result screen offers Enter recovery code, Use a different email, and Return to sign in. Code failures use the same safe invalid-or-expired message as signup.

Not sending mail for unknown recovery addresses reveals account absence to someone who controls and observes that mailbox, but public UI and API responses remain non-enumerating. This is an explicitly accepted privacy tradeoff.

## Email copy

### New-address signup

Subject: `Your Recovery Tracker verification code`

> **Verify your email**  
> Enter this code in Recovery Tracker to continue creating your account:  
> **123456**  
> This code expires in 10 minutes. If you didn’t request this, ignore this email.

### Existing-account signup

Subject: `Recovery Tracker account information`

> **You already have an account**  
> Return to Recovery Tracker and sign in with your password.  
> If you don’t remember your password, choose **Account recovery** from the sign-in screen.  
> If you didn’t request this, you can ignore this email.

### Existing-account recovery

Subject: `Your Recovery Tracker recovery code`

> **Reset your password**  
> Enter this code in Recovery Tracker to choose a new password:  
> **123456**  
> This code expires in 10 minutes. Completing recovery signs out your other sessions.  
> If you didn’t request this, you can ignore this email.

Templates provide plain text and minimal escaped HTML. Future provider-specific mailbox guidance is out of scope until social auth and account-linking policy are designed.

## Architecture

### Backend boundaries

```text
packages/backend/convex/
  auth.ts
  authEmailIntents.ts
  authEmailIntentsInternal.ts
  authEmailDelivery.ts
  authEmailTemplates.ts
  schema.ts
```

- `auth.ts` configures Convex Auth and the supported grant-consumption hooks.
- `authEmailIntents.ts` exposes narrow, validator-backed neutral initiation and code-verification APIs.
- `authEmailIntentsInternal.ts` owns account classification, challenge/grant transitions, and rate limits.
- `authEmailDelivery.ts` owns console and Resend delivery adapters.
- `authEmailTemplates.ts` owns typed message rendering.
- `schema.ts` adds challenge, grant, and bounded rate-limit storage with required indexes.

Every public Convex function declares argument and return validators. Account classification never crosses the public boundary. Public profile/application functions continue deriving identity server-side and authorizing owned resources.

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
  reset-code.tsx
  reset-password.tsx
```

Routes remain composition-only. Feature modules own form state, validation, pending state, safe error mapping, and Convex calls. Existing shared UI remains independent of Expo Router, Convex, Resend, and feature modules. Convex Auth continues to own session state, and `ConvexAuthProvider` continues to own SecureStore token persistence.

## Challenge and grant model

### Challenges

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

- `emailFingerprint` is a keyed HMAC of normalized email, not an unkeyed hash.
- `codeHash` verifies submitted codes.
- `encryptedCode` permits safe reuse during the active resend window, preventing reordered email completion from making the last delivered code stale.
- The encryption key is separate from the Resend API key and fingerprint key.
- No password or account/provider classification is stored.
- Records are indexed by fingerprint and purpose, with bounded cleanup of expired/consumed data.

### Grants

```ts
{
  tokenHash: string,
  emailFingerprint: string,
  purpose: "signup" | "recovery",
  expiresAt: number,
  consumedAt?: number,
}
```

The plaintext grant is returned once after successful mailbox-code verification. Its stored hash is bound to normalized email and purpose. It expires, is single-use, is never logged or placed in a URL, and must be consumed atomically with the supported credential operation. Passwords remain transient client input passed directly to Convex Auth and never enter challenge/grant storage.

## Request orchestration and concurrency

A public Convex action orchestrates external delivery:

1. Normalize the email.
2. Ask an internal mutation to classify account state, enforce rate limits, and prepare or reuse an active challenge.
3. If delivery is appropriate, decrypt the reusable code inside the action and invoke the selected delivery adapter.
4. Record a redacted delivery result internally.
5. Return the neutral public response.

Signup sends either a code or existing-account guidance for every accepted, non-rate-limited request. Recovery sends only for an eligible existing password account. The action and internal functions never return classification publicly.

Initial limits per normalized email fingerprint are:

- 5 initiation requests per 15 minutes.
- 60-second resend cooldown.
- 5 code attempts per active challenge.
- 10-minute code lifetime.
- 10-minute grant lifetime.
- One active challenge and one active grant per email and purpose.

After the attempt limit, the challenge is invalidated. Public initiation remains neutral. IP-based limiting is excluded because ordinary Convex functions may not expose a trustworthy original client IP.

Concurrency tests force simultaneous initiation, reversed Resend completion, delivery failure and retry, racing verification attempts, grant replay, account creation between challenge and grant consumption, and recovery racing another session/reset request. Races fail safely without authorizing another email or purpose or revealing account state.

## Delivery adapter and configuration

The backend package owns the Resend dependency. Application code sends only typed messages:

```ts
type AuthEmailMessage =
  | { kind: "signup-code"; to: string; code: string; expiresAt: number }
  | { kind: "existing-account"; to: string }
  | { kind: "recovery-code"; to: string; code: string; expiresAt: number };
```

Supported modes:

```text
AUTH_EMAIL_DELIVERY=console
AUTH_EMAIL_DELIVERY=resend
```

Resend mode requires deployment environment secrets:

```text
RESEND_API_KEY
AUTH_EMAIL_FROM
AUTH_EMAIL_CODE_KEY
AUTH_EMAIL_FINGERPRINT_KEY
```

Missing or unknown configuration fails closed internally while public initiation remains neutral. Secrets never use `EXPO_PUBLIC_*` variables or repository environment files. This milestone exercises Resend from local Convex only; cloud/production Convex deployment and production DNS changes are excluded.

## Logging and observability

Redacted server logs may include intent purpose, keyed email fingerprint, delivery mode, Resend request ID, outcome category, and rate-limit decision. They must not include passwords, grants, API keys, full email addresses in ordinary logs, raw sensitive provider payloads, or codes outside the explicitly selected console adapter. Resend mode never logs codes.

## Feasibility gate

Before adding schema, delivery, or UI, inspect and test the exact installed Convex Auth source/types to prove:

1. A verified signup grant can gate password-account creation through a supported provider hook.
2. A verified recovery grant can gate password replacement while preserving current-device sign-in and other-session invalidation.
3. Grant consumption can be single-use and tied to the credential operation.
4. No direct auth-table write, client account lookup, parallel password database, or token-store fork is required.

The proof remains throwaway until all claims pass. If signup is supported but recovery is not, signup may proceed while recovery stays unavailable. If neither is supported, stop and compare a targeted Convex Auth upgrade with a managed auth provider before implementing challenge infrastructure.

## Error handling

- Valid initiation always resolves to `{ accepted: true }`.
- Malformed email receives a format error.
- Code absence, mismatch, expiry, consumption, attempt exhaustion, and inapplicability map to one safe invalid-or-expired error.
- Delivery and Resend failures are redacted internally and never rendered raw.
- Grant failures do not reveal whether the account changed between challenge and consumption.
- Pending guards prevent duplicate client submission but are not treated as cross-client serialization.

## Verification strategy

### Backend automation

Tests cover neutral initiation, internal-only classification, delivery selection, no-email unknown recovery, HMAC fingerprinting, secure six-digit generation, hash verification, encrypted resend reuse, expiry, attempt limits, cooldown, rate limits, reversed delivery completion, delivery retry, challenge/grant replay, email/purpose mismatch, credential races, session invalidation, validators, narrow return shapes, and redacted logs. Delivery is injected/faked; automated tests never call Resend.

### Mobile automation

Tests cover neutral result states, email normalization, code/password validation, duplicate-submit prevention, value retention, cooldown behavior, safe error mapping, route transitions, and absence of raw backend/Resend errors.

### Live local verification

Against local Convex and a Resend test or verified domain, manually verify:

1. New-address signup code and account creation.
2. Existing-account signup guidance.
3. Existing-account recovery and password replacement.
4. Unknown-account recovery sends no email while public UI remains neutral.
5. Expiry and resend behavior.
6. Signup flows into profile onboarding.
7. Recovery signs in the current device and invalidates prior sessions.
8. Logs contain no password, grant, full email, API key, or code outside console mode.

No cloud Convex deployment, production database, EAS build, or production DNS change is included.

## Delivery sequence

1. Complete the pinned-API feasibility proof.
2. Add challenge/grant schema and backend behavior tests.
3. Add the console adapter.
4. Add Resend and templates.
5. Add signup UI.
6. Add recovery UI.
7. Add multi-user/session verification.
8. Exercise real local-backend inbox delivery.
9. Complete fresh security, authorization, accessibility, and product review.

## Completion criteria

The milestone is complete when supported signup and recovery flows retain neutral public initiation, private account-specific email behavior, secure/rate-limited challenges and grants, Resend delivery from local Convex, verified Convex Auth credential/session semantics, passing focused and package checks, and explicit live-inbox evidence. Any unsupported credential operation remains unavailable with a precise pinned-API blocker; privacy is not weakened to force completion.
