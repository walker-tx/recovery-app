# Local WorkOS-compatible development provider

Status: Approved by the user, including concrete local defaults. Issue-backed planning and a documentation-only PR are authorized. Implementation and production changes require separate authorization.

## Purpose and scope

Replace real WorkOS for everyday local development and repeatable native tests without replacing Recovery's native authentication flow or bypassing application authorization. This explicitly supersedes the earlier prohibition on a mock IdP for local development only. Real WorkOS remains a separate contract-check target. No production changes are authorized.

Use private workspace package `packages/local-workos`, named `@recovery/local-workos`. An Effect-based HTTP server implements only the WorkOS subset Recovery consumes. Keep the real WorkOS Node SDK, configured to call that server. The developer console uses Foldkit and `@foldkit/ui`; it is development tooling, not a Recovery web application. No hosted application login/signup pages, session/profile injection, SSO, organizations, enterprise policies, arbitrary failure-injection UI, or full WorkOS clone.

Native screens, HTTP requests, SecureStore, onboarding, and authenticated Convex operations remain real. Offline local tests cannot claim parity with WorkOS's live breached-password checks. Any deterministic local password-policy approximation must be documented and covered separately by real-WorkOS contract checks, rather than calling a real breach service during offline operation. Convex owns Recovery profiles, Counts, and application authorization. The local provider owns synthetic identities, passwords, verification/reset records, sessions, refresh credentials, and signing keys.

## Approved visual references

Static, synthetic-data design artifacts are preserved alongside this specification:

- [User inspector](../../design/local-workos/user-inspector.html)
- [Create-user and revoke-all dialogs](../../design/local-workos/user-forms-confirmation.html)
- [Sessions and deletion with inline copy tooltip](../../design/local-workos/sessions-and-user-deletion.html)

These HTML files are design references, not Foldkit implementation. The inspector's native-only email note reflects the later ownership decision. No preview-server keys, state, or logs are included.

## Evidence and compatibility authority

Repository source is the consumer contract; the pinned SDK supplies wire serialization/deserialization; current WorkOS documentation and separate real-provider contract checks supply provider semantics. Local behavior must not become its own definition of WorkOS compatibility.

Inspected sources:

- `packages/backend/package.json`: WorkOS SDK 10.11.0; Convex 1.44.0.
- `packages/backend/convex/workos.ts`, `workosGateway.ts`, and `workosErrorPolicy.ts`: gateway calls, conversions, classification, and challenge/error handling.
- `packages/backend/convex/auth.config.ts`, `workosAuthConfig.ts`, and `workosIdentity.ts`: two independent issuer checks and the client-ID claim check.
- `packages/backend/convex/authEmailDelivery.ts`: Recovery-owned templates and existing loopback-only Mailpit HTTP delivery.
- `apps/mobile/src/features/auth/session/workos-session-storage.ts`: version-1 credentials have no environment binding.
- `docs/architecture.md` and `docs/decisions/2026-08-27-workos-identity-session-ownership.md`: state ownership and backend authorization.
- Installed SDK 10.11.0 in the root checkout, inspected read-only because this worktree has no installed backend dependencies: constructor supports `apiHostname`, `port`, and `https`.
- https://foldkit.dev/ui/overview and https://foldkit.dev/llms.txt: `@foldkit/ui` provides headless accessible components, not a ready-styled dashboard.
- https://docs.convex.dev/auth/advanced/custom-jwt: issuer and JWKS are separately configured; documentation also describes data-URI JWKS, but this design requires serving JWKS and does not silently substitute embedded keys.

Documentation/source evidence is distinct from runtime proof. The separately authorized disposable JWKS probe is recorded below. Remaining implementation acceptance checks must pass before claiming the local provider works; they are not claimed complete by this specification.

## Architecture and configuration

The mobile app talks to its dedicated local Convex backend. Convex calls the real WorkOS SDK, which reaches the local provider. The provider returns signed access tokens and refresh credentials through the existing authentication path. Convex verifies signatures and enforces identity and resource authorization normally.

Treat these settings as distinct:

- SDK API destination and local-only SDK credential, backend-only.
- Stable provider instance identity, expected token issuer, expected client ID, and JWKS retrieval address.
- Explicit persistent or disposable SQLite state location.
- Independent administration secret and browser sessions.
- Local Convex target and mobile authentication-environment identity.

Local configuration must be complete and fail closed. Never fall back to real WorkOS or infer trusted issuers from request headers. Local Convex trusts only its paired local issuer. Existing real-WorkOS staging trust stays pinned; production must reject local tokens without this work changing production configuration. An arbitrary issuer environment override is not an adequate deployment boundary.

Both the Convex JWT configuration and `requireWorkOSIdentity` must derive matching expectations from the selected, explicitly local configuration. Retain subject and client-ID validation and all resource-level ownership checks. A local token must fail against a different local instance as well as real-WorkOS environments.

Secrets remain in permitted local state/configuration; no `.env` files or secret `EXPO_PUBLIC_*` values. Signing keys never leave the server. Persisted password credentials require a standard password-hashing implementation; opaque refresh/admin credentials should be stored as verifiers where their protocol permits. Authentication bodies and credentials must be excluded from logging.

### Concrete local configuration contract

Approved local configuration defaults:

- Generate a random stack UUID and separate provider-generation UUID. Derive canonical issuer `https://local-workos.invalid/instances/<provider-generation-uuid>` without a trailing slash. This reserved, non-resolving hostname is an identifier, not a service destination.
- Local client ID is `client_local` followed by the provider-generation UUID with hyphens removed. JWT `iss` equals that issuer; `aud` and `client_id` equal the local client ID. Configure local Convex `applicationID` to that ID and retain Recovery's explicit `client_id`, issuer, and subject checks. These extra audience requirements apply to the local configuration only; do not change real-WorkOS staging claims or trust.
- The nonsecret mobile environment ID combines stack UUID and provider-generation UUID. A whole-stack recreation changes both; provider-identity destruction changes the generation. Ordinary user clearing, restarts, or port/route changes change neither. Never derive an issuer, client ID, or mobile environment ID from the selected branch or request host.
- Generate a local SDK credential for this provider, distinct from its admin secret. WorkOS-compatible endpoints validate the expected credential and client ID in the places the real SDK supplies them; JWKS alone is public to its configured local consumers. Never reuse a real WorkOS API key.
- A registry-owned bootstrap targets the local backend using explicit loopback URL, allocated cloud/site ports, expected local instance identity, and synthetic local admin credential. It verifies readiness identity before applying configuration. Refuse inherited cloud deploy keys, an unexpected remote target, or legacy/shared-state fallback. Do not invoke an unqualified deployment-selection command.
- The local trust builder accepts local issuer/JWKS overrides only in the explicit local mode and requires local Convex cloud/site runtime URLs to be loopback. SDK and Mailpit destinations are also loopback for the co-located v1 stack. Phone-facing tailnet URLs do not replace those backend-runtime values. Existing staging configuration rejects local overrides and retains fixed WorkOS issuer/JWKS construction. This is fail-closed configuration discipline, not protection against an operator deliberately changing trusted server code.
- Keep local settings and secrets in the worktree's permitted `mise.local.toml` and owner-only instance state. Generate/update only owned keys; do not copy another checkout's secret configuration. Mobile public settings contain only destination and nonsecret environment identity, never SDK/admin credentials.

## Loopback and Tailscale operation

Support fully offline loopback development and Tailscale-enabled phone/browser access with the same server implementation and daily-development state.

All services bind to loopback. Remote mode explicitly manages tailnet HTTPS routes for local Convex and the protected developer console/Mailpit surface. No public listeners or Tailscale Funnel. The phone does not require direct access to provider mutation endpoints when Convex is their caller. JWKS reachability is configured explicitly for the local verifier.

Enabling remote access must not change the instance issuer, keys, users, or identity environment. API destination, issuer identity, and JWKS retrieval location are separate concepts. Loopback mode must not require Tailscale or external DNS/network access. Remote-mode startup reports failed routes rather than silently declaring success. Teardown removes only resources owned by this instance, never unrelated phone previews or routes.

An explicitly authorized disposable probe proved HTTP query authentication using a stable HTTPS issuer identifier independent of a loopback HTTP JWKS retrieval URL on the cached backend identified below. Use a configured `http://127.0.0.1:<allocated-port>/…` JWKS endpoint and exactly matching canonical issuer strings across tokens, verifier configuration, and Recovery's additional identity check, not verifier normalization behavior. Use the canonical per-instance naming defined in the configuration contract above. The issuer need not host a server; the verifier fetches the separately configured JWKS.

### Disposable JWKS feasibility evidence

- Backend cache build: `precompiled-2026-08-25-7cce8fb`; binary reports `local_backend unknown`. SHA-256: `3fefa471e11eab56aabf86039ddf825ed1b4dbadadec2df6b88b6ffd9d604400`. Installed client/source version: Convex 1.44.0.
- Fresh temporary state; backend bound explicitly to `127.0.0.1`; synthetic instance/admin credentials and RSA keys; beacon disabled; no package downloads or cloud deployment selection.
- Custom JWT config: RS256, issuer `https://disposable-issuer.invalid/stable`, audience/application ID `probe-audience`, JWKS `http://127.0.0.1:62562/jwks.json` (ephemeral probe address, not a future stack assignment).
- A disposable, validated query called `ctx.auth.getUserIdentity()`. An HTTP `/api/query` request with the valid token returned 200/success and the expected issuer/subject. Wrong issuer returned 401/`NoAuthProvider`; wrong RSA key with the same `kid` returned 401/`InvalidAuthHeader`; a token expired by 3,600 seconds returned 401/`InvalidAuthHeader`. The JWKS server observed three HTTP requests.
- The probe used an audience claim and configured application ID. It did not test Recovery's separate `client_id` authorization check; that remains a distinct application integration proof obligation.
- Owned backend and JWKS processes were stopped and temporary state deleted in cleanup. No repository implementation, existing services, devices, or real credentials were used.
- This closes the basic independent-issuer/HTTP-JWKS feasibility question for this binary. It does not prove WebSocket authentication, phone reachability, key rotation/cache behavior, real-WorkOS parity, or production suitability. All probe request URLs were loopback and no downloads were needed, but external network access was not OS-blocked or packet-captured; do not claim a fully network-isolated test.

## Worktree-safe stack lifecycle

Each worktree owns a persistent, generated stack identity independent of its branch name. A branch switch within the same worktree retains that identity; a new worktree gets a new one. Start stacks on demand, not automatically on every worktree creation. Do not require a specific agent harness or worktree manager.

The stack owns its local Convex instance/application data, provider SQLite database and signing identity, admin credentials, Mailpit state, service ports, process identities, logs, and optional tailnet routes. Disposable test runs use separate child instances. No shared mutable authentication, application, or inbox state by default. Dependency/build caches may be shared where safe.

Extend the existing Mise/Pitchfork workflow instead of introducing another orchestration system:

| Entry point | Contract |
| --- | --- |
| `mise run zero` | Prepare or resume this worktree's loopback stack, noninteractively, with bounded readiness |
| `mise run zero:tailnet` | Prepare or resume with explicitly managed remote access |
| `mise run status` | Report instance identity, service readiness, URLs, logs, and actionable failure state; support machine-readable output |
| `mise run stop` | Stop only this instance's owned processes/routes while preserving persistent state |
| Explicit local destruction commands | Distinguish provider-identity destruction from whole-worktree-stack destruction; enumerate the selected target and affected data before confirmation |

These are intended command contracts, not claims about current implementation. Startup is idempotent: reuse healthy services and stable configuration; do not routinely recreate databases, reseed users, or reinstall unchanged dependencies. Preparation failure is distinct from a ready stack. No detached agent task is treated as a durable service supervisor; persistent services belong to the existing process-management workflow.

Coordinate sibling resource allocations through a small locked registry scoped to the repository's shared worktree context. Retain reservations for stopped instances. Check OS socket availability too; an allocation record cannot reserve an unbound socket against unrelated applications. Service bind failures require bounded recovery and consistent updates of dependent URLs, never killing an unknown listener. Serialize startup/configuration updates for the same instance and prevent two agents from preparing it simultaneously.

Generate worktree-specific configuration through the repository's permitted Mise setup and preserve unrelated manual values. Do not wholesale copy a root checkout's secrets, Convex target, provider database, or signing identity. Separate nonsecret ownership bookkeeping from credential storage. Branch names are display labels, not authoritative identity keys. Stale records, moved/deleted worktrees, and crashed processes require ownership checks before reclamation; PID alone is insufficient authority to kill a process.

Convex 1.44.0 already supports project-local state at `.convex/local/default/`, relative to the CLI project directory. Fix that working directory explicitly and reject unexpected fallback to legacy home-directory state. Use its supported local cloud/site port options rather than assuming port 3210. Disposable child backends need separate project directories or another proven isolation mechanism; deployment names alone do not create independent storage slots. Record the selected local backend binary version as well as the CLI version, since CLI 1.44.0 does not identify the Rust verifier build.

Namespace all service ownership, not only the provider. Existing fixed Metro and backend port assumptions must be removed from the supported stack path. Configuration changes must propagate together to local Convex, SDK destination, Expo, Mailpit, readiness checks, and status output. Moving a service port does not rotate provider identity.

Tailscale configuration is host-wide, so route allocation/modification needs host-level coordination in addition to sibling worktree locking. Never overwrite an occupied route or globally reset Serve configuration. Verify route ownership and current target before removal. Report capacity/conflict errors clearly if the supported Tailscale routing layout cannot expose another stack. Preserve unrelated previews.

Starting a stack never takes over a simulator or physical device. Native automation explicitly selects and exclusively claims its simulator for the run, or returns a busy result. A parallel backend stack does not make concurrent control of one installed app safe. Physical-phone use remains explicit and must not be disrupted by agent startup.

Normal status exposes instance/worktree identity, healthy/starting/failed services, application/console/inbox/Metro addresses, log paths, and a precise resume or repair command. It excludes credentials and unlock codes. One-time unlock generation remains an explicit command.

### Gram reference and deliberate differences

Read-only research in `speakeasy-api/gram` inspected `.config/wt.toml`, `.mise-tasks/git/workinit.sh`, `workboot.sh`, `worksync.sh`, and `.mise-tasks/zero/remap-ports.mts`. Useful patterns are per-worktree identity, persisted port assignments that account for stopped siblings, preserving assignments on sync, boot/readiness status, and ownership-scoped cleanup. These are observations of the inspected sources, not a claim that Gram was tested locally.

Recovery does not copy Gram's infrastructure stack, wholesale local-configuration copying, or automatic prepare/boot/pause hook. Its default is on-demand startup with fast resume. No second management UI is added; lifecycle remains local tooling, while the Foldkit console stays focused on identities and sessions.

## WorkOS-compatible surface

The compatibility inventory includes:

| SDK operation | Required behavior |
| --- | --- |
| `listUsers`, `getUser`, `getUserIdentities` | SDK-compatible user/list/identity responses, bounded lookup and pagination as consumed by Recovery |
| `createUser` | Password user creation and duplicate/validation errors |
| `authenticateWithPassword` | Signed session or compatible verification challenge/error |
| `getEmailVerification` | Verification ID, code, user, and expiry consumed by Recovery |
| `authenticateWithEmailVerification` | Validate pending authentication and code, then issue a real local session |
| `createPasswordReset`, `resetPassword` | Single-use reset workflow and SDK-compatible result/error behavior |
| `authenticateWithRefreshToken` | Persisted session, expiry, refresh and rotation/reuse semantics |
| `revokeSession` | Revoke provider session with compatible already-invalid behavior |
| `deleteUser` | Provider identity deletion; not Recovery application-account deletion |

SDK source confirms authentication uses `/user_management/authenticate`; user operations use `/user_management/users`; reset creation and confirmation use `/user_management/password_reset` and `/user_management/password_reset/confirm`.

The gateway requires a nonempty `sid` in access tokens. Authorization requires a nonempty subject, matching issuer, and matching `client_id`. Use RS256 with `kid`, publish public keys through JWKS, and include protocol-appropriate time claims. Claims follow the concrete local configuration contract. SDK-deserialization and gateway-error tests must assert the wire cases below; passing local tests is not proof of real-provider parity.

The verification-required response must survive SDK exception conversion: Recovery reads `code`, `pendingAuthenticationToken`, and `rawData.email_verification_id`. Returning merely a plausible HTTP error is insufficient.

Classification preserves the existing gateway behavior: no identities means password/unverified-password depending on verification; one `GoogleOAuth` or `AppleOAuth` identity means the corresponding social-only account; other supported synthetic combinations exercise unknown/recovery behavior. These are metadata fixtures, not working Google/Apple authentication. Admin fixtures may create these cases without real social-provider setup. The console need not expose fixture-specific choices in v1.

Unsupported operations fail explicitly; no silent success or generic authenticated response. Version-1 local wire decisions below are SDK-compatible targets and must be checked through SDK 10.11.0. Where provider documentation does not establish exact idempotency or tenant policy, these local choices are not advertised as full WorkOS parity.

- Authentication uses `POST /user_management/authenticate` with `client_id` and `client_secret` supplied by the SDK. Password grant is `password`; refresh grant is `refresh_token`. Verification grant is `urn:workos:oauth:grant-type:email-verification:code`, with `pending_authentication_token` and `code`.
- Revocation uses `POST /user_management/sessions/revoke` with `session_id`. Reset confirmation uses `token` and `new_password`; success returns `{ user }`. Delete uses `DELETE /user_management/users/<id>`. User/list/identity JSON must include fields consumed by SDK deserializers, not just fields visible in the gateway return value.
- Valid credentials for an unverified user produce HTTP 400 with `code: email_verification_required`, `pending_authentication_token`, and `email_verification_id`. SDK tests must prove `AuthenticationException`/raw-data conversion produces the gateway's exact challenge shape. No challenge is issued for a wrong password.
- Invalid password/refresh and invalid verification grants return HTTP 400 OAuth errors with `error: invalid_grant` and a nonsecret `error_description`. Invalid/used reset token returns a confirmed HTTP 400 rejection. Duplicate email creation returns 409; invalid user/password input returns 422. Unknown resource lookup, unknown-email provider reset creation, repeated deletion, or already-invalid revocation returns 404. The native gateway preserves its existing neutral initiation and terminal-session policies; do not expose admin errors through a new public account-discovery API.
- Each pending-authentication challenge is bound to its user, purpose, expiry, and random pending token. Six-digit verification codes use cryptographic randomness. Allow at most five failed code attempts per challenge, then invalidate it. A new password-auth attempt creates a distinct challenge rather than silently overwriting a different active attempt. Reset tokens are opaque high-entropy single-use credentials; successful reset invalidates other outstanding reset/verification records for that user as a local policy.
- The gateway must still classify 429 as `rateLimited`, transport/408/5xx as `providerUnavailable`, and operation-specific confirmed 4xx rejections as invalid credentials/verification/reset/session. Malformed challenge data stays `providerUnavailable`. No arbitrary error-injection console is added; test protocol errors at the normal HTTP boundary.
- Document observed differences when separate real-WorkOS contract checks disagree with a chosen local approximation. Material behavior changes return for design review; never alter application authorization to make local tests pass.

## Approved prerelease dependency baseline

Registry and published-source review found a concrete version constraint: `foldkit@0.158.0` and `@foldkit/ui@0.158.0` require `effect@4.0.0-rc.112`. The server and SQLite packages' default `latest` tags still target Effect 3; do not combine those defaults with current Foldkit. Matching `@effect/platform-node@4.0.0-rc.112` and `@effect/sql-sqlite-node@4.0.0-rc.112` are published. Pin the selected coherent set exactly for this private development tool; dependency updates require a compatibility check. The user approved this pinned prerelease baseline for the private development tool. This is dependency-design approval, not authorization to install or implement; the set is not yet installed or runtime-tested.

The published SQLite RC uses Node's built-in `node:sqlite`, WAL, and `BEGIN IMMEDIATE` transactions. Its synchronous busy wait can block the event loop; keep work bounded, use one owned database per instance, and use a deliberately short busy timeout rather than inheriting the five-second default without review. No separate native SQLite driver, ORM, database service, or worker architecture is justified initially. The repository pins Node 24.16.0; check that exact runtime in the implementation proof, not only package engine declarations.

Propose Node's asynchronous `crypto.scrypt` with random salts for password hashing and `timingSafeEqual` for verifier comparisons, and a maintained JOSE library (`jose`, registry version 6.2.12 reviewed) for RS256/JWKS rather than hand-building JWT signatures. Password hashing is independent of password acceptance policy. The explicit local password-policy defaults below are proposed approximations, not a claim of matching WorkOS tenant policy. Do not expose passwords in administration reads. Persist signing private keys with owner-only filesystem access and redact secret-bearing objects from diagnostics.

Published `@effect/platform-node` also declares a Redis peer. That does not establish a need for a Redis service in this design. Verify the narrow HTTP import/install behavior before selecting the final dependency manifest; do not add unrelated infrastructure merely to satisfy a broad package surface. Separate browser/server entry points so Node, database, and signing modules cannot enter the console bundle.

Evidence: npm registry manifests for the versions above and the published `@effect/sql-sqlite-node@4.0.0-rc.112` tarball's `src/SqliteClient.ts`; Foldkit UI overview at https://foldkit.dev/ui/overview. No package installation or service startup was performed for this research.

## Persistence and session behavior

SQLite persists users, identity metadata, verification/reset records, sessions, signing identity, and necessary administration state. Daily-development state survives restart. Tests use explicitly isolated disposable state and the same implementation, never a fallback to the daily database.

Session behavior follows real elapsed time. The following are explicit **local development policy defaults**, not claims about WorkOS tenant defaults: access token 5 minutes; refresh session 7 days from sign-in (absolute, refresh does not extend it); verification challenge 10 minutes; password-reset token 30 minutes; administration browser session 8 hours absolute; one-time browser unlock 5 minutes. Preserve the documented refresh replay grace of 30 seconds. No fake clock or runtime failure-injection controls.

Disposable test startup may shorten these lifetimes to positive whole seconds without changing protocol semantics. Reject zero, negative, nonfinite, fractional, or greater-than-30-day durations; require access lifetime not exceed session lifetime and bound every issued access token to its remaining session lifetime. Do not shorten the refresh replay grace as a shortcut for parity tests; an expired/revoked session takes precedence over replay availability. A test can select a sufficiently long session when testing the full replay window. Daily-development configuration uses the fixed defaults unless explicitly overridden in local configuration.

Local password policy defaults to at least 12 characters with a bounded maximum of 128 Unicode code points. This is an explicit offline approximation; no breached-password lookup or password-history service. Real-WorkOS checks retain responsibility for tenant-specific minimum/complexity/breach behavior. Passwords are never trimmed or silently normalized. Cap request-body size independently. Exact numeric defaults are part of final specification approval, not previously verified WorkOS facts.

WorkOS's current session-resilience documentation specifies rotation on refresh and a 30-second replay grace period: replaying the exchanged refresh token returns the same rotated token pair. After grace, the old token returns HTTP 400 `invalid_grant`; revoked or expired refresh credentials are terminal as well. Do not infer undocumented descendant/session-family revocation from late replay. Persist a short-lived, recoverable replay result so an interrupted response can be retried across provider restart; refresh-token hashes alone cannot reproduce the returned token pair. Restrict access to this sensitive replay material and delete it when no longer usable. Source: https://workos.com/docs/authkit/session-resilience.md.

Successful password reset consumes the one-time reset token, changes the password, verifies an unverified email, and revokes active sessions as a coherent atomic transition. Sources: https://workos.com/docs/reference/authkit/password-reset/reset-password.md and installed SDK `resetPassword` documentation.

Refresh rotation, code/reset consumption, revocation, and competing requests must have atomic outcomes. Session revocation prevents further refresh; an already-issued JWT can remain accepted until expiry unless an existing live check rejects it. Key removal is not an immediate-invalidation guarantee because verifiers can cache JWKS.

Deleting/recreating a user must allocate a new subject even for the same email. Subject IDs must never be reused after any bulk provider clear, database recreation, or identity teardown either. Clearing provider records while preserving signing keys can leave already-issued JWTs authorized against preserved Convex records until expiry; deleting keys is not an immediate revocation guarantee because verifiers can cache them. Never reconnect new identities to old Convex data by email or reused IDs.

## Mobile session boundary

Define a stable, nonsecret authentication-environment ID tied to the provider signing-identity generation and paired stack, not to a backend URL or branch name. The startup-generated mobile configuration must select that ID, expected issuer/client ID, and backend destination as one consistent pair. Ordinary port changes and enabling Tailscale preserve it; creating a distinct provider identity generates a new one.

Keep one active stored session, not an environment/account switcher. Bind its versioned SecureStore record to the expected authentication environment before any restoration/refresh request. Switching local versus real WorkOS, or between distinct local instances, clears the former credentials through normal storage handling and requires fresh sign-in. No credential may be sent to the new backend before that check.

Changing reachability for the same instance does not change its identity environment. An unbound legacy record must not be guessed to belong to the current environment. Erasure failure must block cross-environment reuse and surface a recoverable error; do not claim device erasure without verification.

## Email boundary

Preserve Recovery's current ownership of templates and delivery. Existing code already sends messages to Mailpit's HTTP API and rejects non-loopback runtime/delivery URLs. Keep that server-local delivery path even when a phone reaches Convex through Tailscale.

Do not duplicate provider-generated messages. Where the emulated WorkOS operation actually owns delivery, support only the required behavior after confirming its contract. Local operation cannot use a real delivery service or silently fall back to one.

Tests read verification/reset messages through their isolated Mailpit API and complete the actual native flow; obtaining credentials through an admin shortcut is not verification/reset coverage. Console verification-state changes are explicit setup actions, not evidence of that workflow.

Console email initiation is deferred from v1 by user approval. Verification and password-reset emails start through Recovery's native application flows, preserving their existing backend template/delivery owner. The console retains verification-state overrides and the Mailpit link, but no send-verification/reset-email controls or separate administrative email delivery path. The earlier inspector mockup's ‘Send reset email’ control is superseded by this decision; its layout remains approved.

## Identity-provider console

Use Foldkit with `@foldkit/ui` primitives and modest application-owned styling. Do not add React or another component system to this console. Server state remains authoritative; Foldkit owns browser interaction/loading/error state. Support desktop and phone browsers, keyboard navigation, labeled controls, focus restoration, and clear destructive confirmations.

Selected visual direction: a desktop users list with a side-by-side inspector (option B). Selecting a user keeps the list visible on wide screens. On phones, open the inspector full-width with back navigation that restores the list's search and selection context. The user approved the refined inspector as shown: identity and verification controls first, sessions and revocation next, and a visually separated user-deletion section last. Keep identity and sessions together in one scrollable inspector rather than separate tabs. Use the restrained styling and hierarchy in the `user-inspector.html` visual-companion mockup as the design reference, adapted through Foldkit UI primitives. Mock controls are not evidence of available session-device metadata. The earlier mockup's reset-email button is excluded from v1 by the subsequent email-ownership decision.

Approved create-user and revoke-all dialog direction (`user-forms-confirmation.html`): password user creation with email/password and optional first-name and last-name fields; verification override off by default; no social-fixture selector, session injection, or application-data creation. Revoke-all identifies the user and instance, states that provider identity/application data remain unchanged, and explains access-token expiry and device-storage limits. No typed confirmation for revocation. Dialogs adapt to phone viewports, prevent duplicate submissions, restore focus, and report failures without implying success. V1 exposes optional first and last names in create/edit forms, corresponding to the installed SDK's `first_name` and `last_name` fields. Empty name fields are omitted on creation; editing may clear a name. Apply the explicit local password policy above. Subsequent compatibility checks verify this specified behavior; material changes return for approval rather than silently changing form scope.

Approved Sessions and deletion direction: a searchable cross-user active-session list with per-session revocation and links to user inspectors; no instance-wide kill switch or bulk-selection toolbar. Session rows stack on phones. User deletion identifies the user and instance, explains preserved application/inbox/device data, and requires the selected user's email in a separate confirmation input. Preserve the original inline confirmation wording and styling: ‘Type <email> to confirm’. Only the inline email is a semantic, keyboard-accessible copy button styled as ordinary inherited text, without button chrome or a copy icon. Provide a pointer cursor and visible keyboard focus. Successful copying displays a small, transient ‘Copied’ tooltip anchored above the inline email, without shifting layout; announce the outcome to assistive technology as well. Copy failure gets truthful feedback, not a success tooltip. Respect reduced motion. Copying does not auto-fill, submit, or delete. Pasting is supported. This confirmation checks the intended target, not whether the user typed each character manually.

Scope:

- List/search/create/inspect/delete synthetic users and edit supported basic identity information.
- Manage verification state as an explicit administrative setup action; initiate verification/reset email through the native app, not the console.
- Inspect session metadata and revoke one or all sessions for a user.
- Link to the separate Mailpit inbox.
- Show a small read-only instance label.

No session creation, raw-token display, profiles/Counts, device cleanup, infrastructure dashboard, route management, bulk environment reset, or browser-accessible instance teardown. User deletion explicitly warns that Convex data remains. No second management UI is needed.

## Administration and browser unlock

Separate protected administration endpoints from the WorkOS-compatible API. SDK credentials do not grant administration access; administration credentials are not application identities. Tailnet membership alone does not authorize administration.

Use a persistent per-instance high-entropy administration secret with manual browser unlock as a fallback. Automation uses the isolated instance's credential directly. Browser unlock establishes an expiring HttpOnly cookie; use Secure cookies for tailnet HTTPS, explicit local-origin handling for loopback mode, SameSite restrictions, origin/CSRF checks, and no permissive cross-origin administration. Validate hosts/origins against configuration rather than arbitrary request headers.

Approved v1 threat boundary: sibling worktree services running under the developer's OS account are trusted local processes, not hostile tenants. Prevent accidental browser-session collision with an instance-specific `/dev/<instance-id>/` path shared by that console and its proxied Mailpit, an instance-specific cookie name scoped to that path, independent admin secrets, and server-side session binding to the instance. Reject foreign-instance sessions. Exact origin and CSRF checks remain mandatory. Cookies are not port-scoped and paths do not isolate credentials from malicious sibling services; hostile-tenant isolation is explicitly outside v1.

A local command can display a short-lived, single-use URL such as `https://host/dev/<instance-id>/#unlock=<code>`. Never place the persistent secret in a URL. The browser captures and removes the fragment before other navigation, then exchanges the code through POST; consumption must be atomic. Tokens remain sensitive despite fragment placement. Do not place them in routine startup logs, instance-info responses, telemetry, or persistent browser storage. Rotation of the admin secret invalidates admin sessions and outstanding unlock grants. Ordinary provider reset preserves admin access.

Console and Mailpit share one browser unlock through a protected developer origin/proxy. Protect Mailpit API and UI, not only its landing page. No alternate tailnet route may bypass protection. Mailpit exposes `--webroot` / `MP_WEBROOT` for both UI and API, and current Tailscale Serve source supports path mounting and arbitrary valid HTTPS listener ports rather than Funnel's restricted set. These facts support, but do not runtime-prove, the proposed protected subpath. Verify asset/API/websocket forwarding and that no route bypasses authentication. A Mailpit webroot change also changes Recovery's email-delivery API URL.

## Reset and lifecycle semantics

Local tooling owns lifecycle and bulk reset, not the console or a remotely callable teardown endpoint.

| Operation | Changes | Preserves |
| --- | --- | --- |
| Revoke sessions | Selected provider sessions become non-refreshable | Identity, signing keys, Convex data |
| Delete user | Provider identity and associated authentication records | Convex data, device storage, inbox |
| Clear provider data | Users, sessions, verification/reset records | Issuer, signing keys, admin access, Convex data, device storage, inbox |
| Clear isolated inbox | Explicitly selected instance's Mailpit messages | Provider/Convex/device state |
| Destroy provider identity | Explicit local teardown of provider state and signing keys; a new identity requires deliberate trust re-pairing | Convex data, Mailpit state, device storage, unrelated instances |
| Destroy worktree stack | Remove the selected stack's provider state/keys, local Convex data, Mailpit state, owned processes and routes; release its reservations after ownership-checked teardown | Device storage, unrelated instances and previews |

Whole-stack destruction is explicitly approved as a design capability, not authorized for execution in this session. Its confirmation names the stack and enumerates provider, Convex, and inbox deletion. Subsequent startup creates a fresh stack/authentication identity. It never runs as part of ordinary stop, restart, or provider reset.

No provider reset silently changes trust targets, resets Convex, erases SecureStore/native fields, or clears Mailpit. Tests clean only resources they own. Partial cleanup must be reported by domain, not presented as a successful global reset. Preserved Convex records can become orphaned after provider deletion; this is intentional rather than silently deleting or reassigning them.

## Validation requirements

These are design proof obligations, not an implementation plan:

- Exercise wire contracts through the pinned real WorkOS SDK, including exception deserialization and negative cases.
- Prove local tokens work only with their paired local backend; wrong issuer/client/subject/signature, expired tokens, and cross-instance tokens fail. Resource ownership checks still reject the wrong user.
- Prove restart persistence and isolation of daily/test state, keys, users, mail, and cleanup.
- Start two sibling worktree stacks concurrently and verify distinct state, trust, ports, processes, and remote routes. Starting one twice must reuse its healthy services. Stopping or destroying one must leave the other and any unrelated phone preview untouched.
- Exercise concurrent allocation, occupied reserved ports, interrupted startup, stale ownership records, and worktree removal. Recovery must be bounded and must never kill an unknown process or remove another instance's routes.
- Verify machine-readable status excludes secrets and reports partial failure accurately. Verify native automation refuses a simulator already claimed by another run.
- Exercise real password, verification, reset, refresh/expiry, revocation, deletion, onboarding, and authorized application operations through the native/network/storage boundaries.
- Prove loopback-only operation without Tailscale or external network access, then phone/browser reachability over explicitly managed routes.
- Check admin authorization, CSRF/origin enforcement, unlock expiry/replay/concurrency, cookie handling, redaction, and absence of unprotected Mailpit routes.
- Verify cross-environment storage handling before refresh; preserve evidence about actual erasure separately from authentication success.
- Keep real-WorkOS contract checks separate. Local-provider native results are not real-WorkOS end-to-end coverage.

The real-credential XCTest investigation remains blocked and is not reopened. Draft PR #43 and unrelated root/phone-preview work remain preserved. Prior field/SecureStore erasure was not verified; no statement here changes that checkpoint.

## Implementation acceptance gates (not yet executed)

1. Exercise the specified wire/error fixtures through SDK 10.11.0, verify documented refresh/reset semantics and atomic concurrency outcomes, and record explicit local-policy differences in separate real-provider contract checks. Full WorkOS parity is not a v1 claim.
2. Basic independent-issuer/loopback-HTTP-JWKS authentication is proven for the recorded backend binary. Verify the specified per-instance audience/client-ID policy through actual Recovery identity checks and WebSocket authentication. Full offline-stack operation remains distinct from the completed loopback HTTP probe.
3. Prove local bootstrap rejects remote/mismatched targets and inherited real deployment credentials; test both JWT trust and application identity rejection. A mode string alone is not deployment attestation.
4. Confirm Mailpit protected subpath behavior for UI/assets/API/websockets. Console-triggered email is explicitly deferred; Recovery remains the native-flow email owner.
5. Validate the approved exact Foldkit/Effect RC dependency set on the pinned Node runtime, including HTTP imports and SQLite behavior. Published peer/source compatibility is verified; installation/typechecking/runtime compatibility is not. The password/signing implementation recommendations still require final specification review. No dependencies were installed.
6. Verify version-specific Convex and Pitchfork instance isolation, configurable Expo/Metro ports, host-wide Tailscale route allocation, concurrent startup, stale-owner recovery, and ownership-scoped cleanup. Do not bypass route conflicts or substitute shared state when a platform constraint is encountered.

## Independent consistency review

Review found five material ambiguities. Stable mobile authentication-environment identity and reset-wide subject non-reuse/JWT caveats have now been made explicit. Provider versus whole-stack destruction is now explicitly approved and distinguished in the reset table. Trusted-local-process browser isolation is also approved and specified above. Console email initiation is now explicitly deferred from v1, preserving Recovery's existing ownership. All five identified semantic ambiguities have explicit resolutions; the separate compatibility/runtime gates above are not thereby proven.

The approved visual hierarchy does not settle these service/security semantics.

## Review result

Final independent review found two residual inconsistencies: a password-policy parity overclaim and undecided optional name-field scope. Both were corrected: password acceptance is explicitly a local approximation, and v1 exposes optional first/last names, supported by SDK 10.11.0 serialization. The reviewer otherwise found the candidate suitable for complete-specification approval after those corrections. No runtime acceptance checks are implied by this review.

Self-review identified and corrected console-reset scope, the second issuer check, unbound mobile credentials, headless-versus-styled Foldkit UI assumptions, revocation/erasure overclaims, ambiguous destruction domains, cookie isolation, and email ownership. The final-review candidate now supplies concrete local defaults and distinguishes documented provider semantics from explicit local approximations. The user approved the complete specification, including the concrete local defaults. Implementation acceptance gates are not claims of completed tests. Stop after design review: no implementation planning, issues, installation, commits of credential-bearing preview state, or production actions without the appropriate separate authorization.
