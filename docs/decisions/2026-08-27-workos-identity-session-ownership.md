# ADR: WorkOS owns identity and sessions

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

The mobile-only application replaced Convex Auth during the local WorkOS feasibility milestone. Running two identity or session owners would make restoration, revocation, authorization, and migration behavior ambiguous.

## Decision

WorkOS is the sole owner of user identities, credentials, verification and reset records, access and refresh tokens, sessions, and revocation. `WorkOSSessionProvider` is the mobile session authority and persists only versioned WorkOS credentials in SecureStore. Convex owns application authorization and subject-owned profiles, not identity or sessions.

Convex trusts exactly one client-scoped WorkOS custom JWT provider:

- issuer: `https://api.workos.com/user_management/<WORKOS_CLIENT_ID>`
- JWKS: `https://api.workos.com/sso/jwks/<WORKOS_CLIENT_ID>`
- algorithm: `RS256`
- `applicationID`: intentionally omitted because WorkOS access tokens do not provide the standard `aud` claim Convex expects

Omitting `applicationID` is acceptable only with the client-scoped issuer and JWKS above and mandatory server-side enforcement that every protected function validates `client_id === WORKOS_CLIENT_ID` through the shared identity helper. Directly trusting `ctx.auth.getUserIdentity()` is not permitted.

Profiles are owned by the validated WorkOS subject (`ownerSubject`). This local cutover is destructive: legacy local Convex Auth sessions and profile data are not migrated, legacy SecureStore keys are deleted, and local profiles are recreated under WorkOS subjects. Production migration requires a separate approved plan.

Verification codes, reset tokens, and account-specific guidance may be delivered only to the console of an actual loopback Convex runtime. Both Convex-provided cloud and site runtime URLs must be present, parseable, and loopback; mode flags are not sufficient. Public initiation responses remain neutral. Credentials are configured only in the local Convex environment and are never committed or bundled into Expo.

## Consequences

- Session restoration, refresh, sign-out, token persistence, and protected-route readiness have one owner.
- Convex remains the authorization boundary and keys user data by validated WorkOS subject.
- Provider-indeterminate sign-out failures retain the local session for retry; an already-invalid provider session is terminal success.
- Console delivery fails closed outside local Convex, so real delivery requires a future explicit design.
- Staging/local assumptions must not be reused for production without a new decision.

## Rollback

Rollback is repair-forward, not dual-auth fallback. Disable the affected WorkOS entry points, preserve evidence and subject-owned application data, correct the WorkOS/session integration, and ship a new migration or decision. Do not re-enable Convex Auth alongside WorkOS or restore legacy session records.
