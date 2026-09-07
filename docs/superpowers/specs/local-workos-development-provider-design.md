# Local WorkOS-compatible development provider

Status: **CLI revision approved by the user (2026-09-07).** The complete written revision, including CLI contracts, private-socket administration, inbox list/read, normal mark-as-read behavior, and concrete local-tool defaults, is approved. It supersedes the earlier browser-console requirements while preserving provider semantics and application/lifecycle safety boundaries. Approval completes the design phase; it does not claim implementation or authorize production actions. Reconcile the issue-backed delivery scope before implementation.

[CLI investigation and disposable proof results](../../local-workos-cli-investigation.md) are supporting evidence, not an implementation plan. GitHub Issues remain authoritative for executable scope and dependencies. Reconcile #51 and affected administration interfaces after written-design approval; do not infer that closed issues prove the required code is integrated.

## Purpose and scope

Replace real WorkOS for everyday local development and repeatable native tests without replacing Recovery's native authentication flow or bypassing application authorization. This explicitly supersedes the earlier prohibition on a mock IdP for local development only. Real WorkOS remains a separate contract-check target. No production changes are authorized.

Use private workspace package `packages/local-workos`, named `@recovery/local-workos`. An Effect-based HTTP server implements only the WorkOS subset Recovery consumes. Keep the real WorkOS Node SDK, configured to call that server. A noninteractive Effect CLI replaces the FoldKit developer console; it is local development tooling, not a Recovery web application. Administration runs beside the selected stack on macOS/Linux. A human may SSH to the host using their existing workflow; the CLI neither manages SSH nor accepts arbitrary remote admin destinations. No hosted application login/signup pages, session/profile injection, SSO, organizations, enterprise policies, arbitrary failure-injection UI, or full WorkOS clone.

Native screens, HTTP requests, SecureStore, onboarding, and authenticated Convex operations remain real. Offline local tests cannot claim parity with WorkOS's live breached-password checks. Any deterministic local password-policy approximation must be documented and covered separately by real-WorkOS contract checks, rather than calling a real breach service during offline operation. Convex owns Recovery profiles, Counts, and application authorization. The local provider owns synthetic identities, passwords, verification/reset records, sessions, refresh credentials, and signing keys.

## Historical visual references (superseded by this revision)

Retain these static synthetic-data artifacts as historical context, not CLI acceptance criteria:

- [User inspector](../../design/local-workos/user-inspector.html)
- [Create-user and revoke-all dialogs](../../design/local-workos/user-forms-confirmation.html)
- [Sessions and deletion with inline copy tooltip](../../design/local-workos/sessions-and-user-deletion.html)

The CLI retains the identity/session capabilities, explicit deletion confirmation, and native-only email ownership described by these references. Desktop/phone layouts, clipboard tooltips, browser focus behavior, and screenshot parity are no longer deliverables. Do not delete historical artifacts as part of this design-only revision.

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
- The CLI investigation records published Effect `4.0.0-rc.112` source, subprocess behavior, actual Git-worktree discovery, and scoped Unix HTTP server/client proofs. Those isolated probes are not integrated provider/inbox validation.
- https://docs.convex.dev/auth/advanced/custom-jwt: issuer and JWKS are separately configured; documentation also describes data-URI JWKS, but this design requires serving JWKS and does not silently substitute embedded keys.

Documentation/source evidence is distinct from runtime proof. The separately authorized disposable JWKS probe is recorded below. Remaining implementation acceptance checks must pass before claiming the local provider works; they are not claimed complete by this specification.

## Architecture and configuration

The mobile app talks to its dedicated local Convex backend. Convex calls the real WorkOS SDK, which reaches the local provider. The provider returns signed access tokens and refresh credentials through the existing authentication path. Convex verifies signatures and enforces identity and resource authorization normally.

Treat these settings as distinct:

- SDK API destination and local-only SDK credential, backend-only.
- Stable provider instance identity, expected token issuer, expected client ID, and JWKS retrieval address.
- Explicit persistent or disposable SQLite state location.
- Registry-owned private administration socket, expected stack UUID and provider-generation UUID, and OS-account ownership.
- Local Convex target and mobile authentication-environment identity.

Local configuration must be complete and fail closed. Never fall back to real WorkOS or infer trusted issuers from request headers. Local Convex trusts only its paired local issuer. Existing real-WorkOS staging trust stays pinned; production must reject local tokens without this work changing production configuration. An arbitrary issuer environment override is not an adequate deployment boundary.

Both the Convex JWT configuration and `requireWorkOSIdentity` must derive matching expectations from the selected, explicitly local configuration. Retain subject and client-ID validation and all resource-level ownership checks. A local token must fail against a different local instance as well as real-WorkOS environments.

Secrets remain in permitted local state/configuration; no `.env` files or secret `EXPO_PUBLIC_*` values. Signing keys never leave the server. Persisted password credentials require a standard password-hashing implementation; opaque refresh credentials should be stored as verifiers where their protocol permits. The CLI admin listener uses filesystem authorization, not a new bearer credential or browser session. Authentication bodies and credentials must be excluded from logging.

### Concrete local configuration contract

Approved local configuration defaults:

- Generate a random stack UUID and separate provider-generation UUID. Derive canonical issuer `https://local-workos.invalid/instances/<provider-generation-uuid>` without a trailing slash. This reserved, non-resolving hostname is an identifier, not a service destination.
- Local client ID is `client_local` followed by the provider-generation UUID with hyphens removed. JWT `iss` equals that issuer; `aud` and `client_id` equal the local client ID. Configure local Convex `applicationID` to that ID and retain Recovery's explicit `client_id`, issuer, and subject checks. These extra audience requirements apply to the local configuration only; do not change real-WorkOS staging claims or trust.
- The nonsecret mobile environment ID combines stack UUID and provider-generation UUID. A whole-stack recreation changes both; provider-identity destruction changes the generation. Ordinary user clearing, restarts, or port/route changes change neither. Never derive an issuer, client ID, or mobile environment ID from the selected branch or request host.
- Generate a local SDK credential for this provider. It is not an administration credential and does not authorize the private admin listener. WorkOS-compatible endpoints validate the expected credential and client ID in the places the real SDK supplies them; JWKS alone is public to its configured local consumers. Never reuse a real WorkOS API key.
- A registry-owned bootstrap targets the local backend using explicit loopback URL, allocated cloud/site ports, expected local instance identity, and synthetic local Convex admin credential. This backend bootstrap credential remains necessary and is distinct from provider administration over the private socket. Bootstrap verifies readiness identity before applying configuration. Refuse inherited cloud deploy keys, an unexpected remote target, or legacy/shared-state fallback. Do not invoke an unqualified deployment-selection command.
- The local trust builder accepts local issuer/JWKS overrides only in the explicit local mode and requires local Convex cloud/site runtime URLs to be loopback. SDK and Mailpit destinations are also loopback for the co-located v1 stack. Phone-facing tailnet URLs do not replace those backend-runtime values. Existing staging configuration rejects local overrides and retains fixed WorkOS issuer/JWKS construction. This is fail-closed configuration discipline, not protection against an operator deliberately changing trusted server code.
- Keep local settings and secrets in the worktree's permitted `mise.local.toml` and owner-only instance state. Generate/update only owned keys; do not copy another checkout's secret configuration. Mobile public settings contain only destination and nonsecret environment identity, never SDK/admin credentials.

## Loopback and Tailscale operation

Support fully offline local development and Tailscale-enabled native-phone access with the same server implementation and daily-development state. The developer CLI remains co-located in both modes; there is no remote console or remote inbox browser surface.

All TCP services bind to loopback; provider administration binds only a private Unix socket. Remote mode manages only the owned routes needed by the native app, such as local Convex and Metro. Never expose the admin socket or Mailpit UI/API through TCP proxies, Tailscale, or Funnel. The phone does not require direct access to provider mutation endpoints when Convex is their caller. JWKS reachability is configured explicitly for the local verifier.

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

The stack owns its local Convex instance/application data, provider SQLite database and signing identity, private admin socket ownership, local SDK/Convex credentials, Mailpit state, service ports, process identities, logs, and optional tailnet routes. Disposable test runs use separate child instances. No shared mutable authentication, application, or inbox state by default. Dependency/build caches may be shared where safe.

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

Normal status exposes stack/worktree identity, provider generation, healthy/starting/stopped/failed services, nonsecret endpoints and log paths, and a precise resume or repair command. It excludes credentials and message contents. An admin-socket path and loopback inbox endpoint are diagnostics, not remote links. There is no unlock-generation command. Status never starts, reseeds, or repairs services as a hidden side effect.

### Gram reference and deliberate differences

Read-only research in `speakeasy-api/gram` inspected `.config/wt.toml`, `.mise-tasks/git/workinit.sh`, `workboot.sh`, `worksync.sh`, and `.mise-tasks/zero/remap-ports.mts`. Useful patterns are per-worktree identity, persisted port assignments that account for stopped siblings, preserving assignments on sync, boot/readiness status, and ownership-scoped cleanup. These are observations of the inspected sources, not a claim that Gram was tested locally.

Recovery does not copy Gram's infrastructure stack, wholesale local-configuration copying, or automatic prepare/boot/pause hook. Its default is on-demand startup with fast resume. No management UI or second orchestrator is added. Existing Mise/Pitchfork tooling owns lifecycle; the CLI provides identity/session administration and inbox list/read. Reading uses the approved normal Mailpit mark-as-read behavior; listing remains nonmutating. No inbox deletion or mail delivery command is added.

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

Classification preserves the existing gateway behavior: no identities means password/unverified-password depending on verification; one `GoogleOAuth` or `AppleOAuth` identity means the corresponding social-only account; other supported synthetic combinations exercise unknown/recovery behavior. These are metadata fixtures, not working Google/Apple authentication. Admin fixtures may create these cases without real social-provider setup. The CLI does not expose fixture-specific choices in v1; isolated compatibility tests may still use internal fixture capabilities.

Unsupported operations fail explicitly; no silent success or generic authenticated response. Version-1 local wire decisions below are SDK-compatible targets and must be checked through SDK 10.11.0. Where provider documentation does not establish exact idempotency or tenant policy, these local choices are not advertised as full WorkOS parity.

- Authentication uses `POST /user_management/authenticate` with `client_id` and `client_secret` supplied by the SDK. Password grant is `password`; refresh grant is `refresh_token`. Verification grant is `urn:workos:oauth:grant-type:email-verification:code`, with `pending_authentication_token` and `code`.
- Revocation uses `POST /user_management/sessions/revoke` with `session_id`. Reset confirmation uses `token` and `new_password`; success returns `{ user }`. Delete uses `DELETE /user_management/users/<id>`. User/list/identity JSON must include fields consumed by SDK deserializers, not just fields visible in the gateway return value.
- Valid credentials for an unverified user produce HTTP 400 with `code: email_verification_required`, `pending_authentication_token`, and `email_verification_id`. SDK tests must prove `AuthenticationException`/raw-data conversion produces the gateway's exact challenge shape. No challenge is issued for a wrong password.
- Invalid password/refresh and invalid verification grants return HTTP 400 OAuth errors with `error: invalid_grant` and a nonsecret `error_description`. Invalid/used reset token returns a confirmed HTTP 400 rejection. Duplicate email creation returns 409; invalid user/password input returns 422. Unknown resource lookup, unknown-email provider reset creation, repeated deletion, or already-invalid revocation returns 404. The native gateway preserves its existing neutral initiation and terminal-session policies; do not expose admin errors through a new public account-discovery API.
- Each pending-authentication challenge is bound to its user, purpose, expiry, and random pending token. Six-digit verification codes use cryptographic randomness. Allow at most five failed code attempts per challenge, then invalidate it. A new password-auth attempt creates a distinct challenge rather than silently overwriting a different active attempt. Reset tokens are opaque high-entropy single-use credentials; successful reset invalidates other outstanding reset/verification records for that user as a local policy.
- The gateway must still classify 429 as `rateLimited`, transport/408/5xx as `providerUnavailable`, and operation-specific confirmed 4xx rejections as invalid credentials/verification/reset/session. Malformed challenge data stays `providerUnavailable`. No arbitrary error-injection console is added; test protocol errors at the normal HTTP boundary.
- Document observed differences when separate real-WorkOS contract checks disagree with a chosen local approximation. Material behavior changes return for design review; never alter application authorization to make local tests pass.

## Prerelease dependency baseline

Retain exact `effect@4.0.0-rc.112`, `@effect/platform-node@4.0.0-rc.112`, and `@effect/sql-sqlite-node@4.0.0-rc.112` for the private tool. `effect/unstable/cli` is part of Effect 4, not the separate Effect-3 `@effect/cli` package. Effect Solutions teaches the same CLI library, but its moving beta installation instructions are not version authority. Consult installed source and tests before API use.

Mailpit is pinned by repository-owned `mise.toml`, currently `1.31.0`; validate list/read/pagination against that installed version rather than moving online defaults. The proven socket client imports the supported `@effect/platform-node/Undici` export: no separate direct `undici` dependency is proposed. The disposable socket proof also pinned `@effect/platform-node-shared@4.0.0-rc.112`; preserve compatible platform transitive resolutions in the workspace lockfile and verify them under normal installation rather than depending on temporary artifact state.

FoldKit and its browser tooling are no longer required by this target design. During implementation, remove them only after checking remaining consumers; do not rewrite provider services or add another UI framework. Do not introduce Redis, a new ORM, a second database service, or a separate CLI workspace package merely to satisfy broad package surfaces.

The SQLite RC uses Node's built-in `node:sqlite`, WAL, and `BEGIN IMMEDIATE` transactions. Keep bounded work and a deliberately short busy timeout rather than silently inheriting a five-second event-loop-blocking wait. One provider process owns the instance database and administers it through existing operations.

Preserve asynchronous `crypto.scrypt`, random salts, timing-safe verifier comparisons, and a maintained JOSE implementation rather than custom signing. This UI-to-CLI revision does not authorize a JOSE upgrade or alter password acceptance policy. Signing private keys remain owner-only and never enter administrative reads.

Disposable probes ran the pinned Effect CLI and Unix HTTP server/client on Node 24.16.0. Native TypeScript stripping worked for the machine-output variant without a build step or `tsx`. Prefer that existing runtime path where the real code typechecks; no bundler is required merely for a local executable. Integrated typechecking, SQLite behavior, resource cleanup, and clean installation under normal pnpm safeguards remain acceptance obligations. The probes did not validate an entire dependency set or permit ignoring install/check failures in delivery.

## Persistence and session behavior

SQLite persists users, identity metadata, verification/reset records, sessions and signing identity. Private socket ownership is lifecycle bookkeeping, not a new browser-session database. Daily-development state survives restart. Tests use explicitly isolated disposable state and the same implementation, never a fallback to the daily database.

Session behavior follows real elapsed time. The following are explicit **local development policy defaults**, not claims about WorkOS tenant defaults: access token 5 minutes; refresh session 7 days from sign-in (absolute, refresh does not extend it); verification challenge 10 minutes; password-reset token 30 minutes. Preserve the documented refresh replay grace of 30 seconds. No fake clock or runtime failure-injection controls.

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

Tests read verification/reset messages through their isolated Mailpit API and complete the actual native flow; obtaining credentials through an admin shortcut is not verification/reset coverage. CLI verification-state changes are explicit setup actions, not evidence of that workflow.

Administrative email initiation remains out of v1. Verification and password-reset emails start through Recovery's native application flows, preserving their existing backend template/delivery owner. The CLI retains explicit verification-state setup and reads captured Mailpit messages, but has no send-verification/reset-email command or independent administrative delivery path.

## Developer CLI

### Boundary and command surface

Use one package-owned Effect entry point for administration, exposed through `mise run mock -- <arguments>`. This is the proposed supported wrapper, not a claim that it exists today. The wrapper must preserve the caller's working directory for discovery, forward arguments and exit codes unchanged, and add no banners to command output. `--worktree` selects another local checkout explicitly. No global installation, shell profile modification, browser, TUI, or interactive wizard is required.

Keep daemon startup and stack start/stop/reset in their existing lifecycle entry points. Do not overload an administration command to boot a stack or open its database directly.

| Command | Contract |
| --- | --- |
| `status` | Selected stack record and observed service/admin readiness, without credentials or message bodies |
| `users list` | Bounded listing/search of synthetic users |
| `users get <user-id>` | Identity, supported metadata, and verification state; never passwords, hashes, challenges, or tokens |
| `users create` | Password user with email, password from explicit stdin, optional first/last names, verification override off by default |
| `users update <user-id>` | Supported basic identity edits only; omitted fields stay unchanged, explicit empty names clear them |
| `users verify <user-id> --verified <true|false>` | Explicit setup override; not evidence that the verification flow ran |
| `users delete <user-id>` | Explicit target/email-confirmed provider deletion; associated provider auth records removed, other data preserved |
| `sessions list [--user <user-id>]` | Bounded per-user or cross-user session metadata with user IDs; honest unavailable metadata labels |
| `sessions revoke <session-id>` | Revoke one session in the selected instance |
| `sessions revoke-all --user <user-id>` | Revoke the selected user's sessions, never a global kill switch |
| `inbox list [--to <email>]` | Bounded captured-message metadata for the selected Mailpit instance |
| `inbox read <message-id>` | Explicit sensitive message-text read, without rendering HTML or opening links |

No session creation/injection, social sign-in/fixture selector, raw provider-token inspection, application profiles/Counts, native-device control, bulk provider/inbox clearing, route management, or stack teardown is added to this command surface. Existing lifecycle capabilities remain separate.

Create/update preserve the existing supported identity and password-policy contracts; they do not introduce password replacement outside the native reset flow. Name fields are optional, omitted when empty on creation, and clearable on update. Unsupported fields/operations fail explicitly. Detailed wire field names must follow the existing provider/SDK contract, not be inferred from historical mockups.

### Worktree and target selection

Selection precedence is explicit `--worktree <path>`, otherwise the caller's cwd. Resolve using Git's worktree root and filesystem canonicalization, including nested cwd and symlinks. An unrelated nested repository is a different target, not permission to inherit its parent's stack. Outside a checkout, missing registration, moved/stale ownership, and ambiguous records fail closed with an actionable error.

Use the existing registry and its actual ownership model. Do not add a second registry, per-agent current-stack file, branch-name identity, inferred port, arbitrary `--url`, or latest-running-stack fallback. Resolve stack UUID, provider generation, canonical worktree, and allocated endpoint as one consistent selection. A branch switch retains identity; a distinct worktree/identity recreation does not.

Provider administration requires a live, schema-validated identity response over the selected private socket. Every admin request carries the expected stack UUID and provider generation; the server rejects mismatches, including a generation change between preflight and mutation. Response identity is validated before emitting data. Server-side generation validation and mutation must share the provider's serialization/transaction boundary with identity lifecycle changes; a preflight check alone is insufficient.

All provider-administration mutations require explicit `--expect-stack <uuid>` and `--expect-generation <uuid>` values matching the selected record and server. These are assertions, not alternate selectors. Reads may omit them; if supplied they are enforced. A user/agent obtains them through `status` before composing a mutation. No generic `--yes` flag bypasses target checks.

A registered stopped stack can return successful status with `stopped`/`starting` states and identity explicitly marked unverified; this is not permission to administer it. Missing registration is a target error. State conflicts and failed readiness return a nonzero failure with safe per-service details. Identity values taken only from bookkeeping must not be described as live-verified.

### Confirmations and sensitive inputs

Deletion additionally requires `--confirm-email <current-email>` for the selected user. The server checks that email against the current user in the same operation as deletion; a stale confirmation refuses rather than deleting a changed target. This confirms the intended account, not whether the text was typed manually. Success and errors describe which domains were changed or preserved without claiming Convex/device/inbox deletion.

Revocation does not require typed email confirmation. Explicit command, subject ID, and expected target/generation are its noninteractive confirmation. Reports retain the caveat that existing access JWTs may survive until expiry; provider identity, Convex data, and device storage are preserved. Already-revoked/missing cases follow the supported provider contract and are not guessed successful.

User creation reads a password only with `--password-stdin`; do not accept a password in argv, a URL, ambient environment, or routine diagnostics. Never prompt automatically. Reject a TTY for this input and bound reading by the invocation deadline and a 4 KiB input cap before the existing password policy. Preserve exact UTF-8 password content: do not trim trailing newlines or normalize it. Human examples use `printf`, not an implicit line-oriented prompt. Error rendering must not echo rejected password bytes or raw causes.

### Output, failures, and bounds

Human-readable output is the default; explicit `--json` selects the machine contract consistently regardless of TTY. Global flags must work before and after subcommands. No command chooses interactivity, colors, pagers, or spinners merely because a terminal is present. Disable Wizard and prompt fallbacks; allow only deliberately supported built-ins. Human output escapes terminal control characters in all externally sourced strings, including names, subjects, and message bodies.

Machine success emits one JSON object plus newline on stdout and no routine stderr output. A normally rendered failure emits one JSON object plus newline on stderr, empty stdout, and a nonzero exit. If an output stream itself fails, partial stdout or an undeliverable error is possible: callers must reject incomplete JSON and use the nonzero exit rather than infer a complete result. Do not stream partial results before validation, mix help with failures, print framework logs to stdout, or serialize raw parser/provider exceptions. Explicit `--help`/`--version` are successful non-service commands; with `--json` they return structured help/version, otherwise text. Invalid arguments remain failures even when framework error rendering wants to show help.

Version-1 envelope:

- Success: `schemaVersion: 1`, `ok: true`, `target`, `data`.
- Failure: `schemaVersion: 1`, `ok: false`, `target`, `error: { code, message, outcome, nextAction }`.
- `target` contains canonical worktree, stack UUID, provider generation, and explicit identity-verification state when known; otherwise it is `null`. Help/version have `target: null`.
- `outcome` is `not-applied`, `unknown`, or `not-applicable`. A post-dispatch transport failure cannot claim `not-applied` without evidence.
- Error codes and messages are stable, allowlisted, and sanitized; safe field-level validation and a next action are preferable to raw causes. No credential, password, challenge, reset link, or message body enters error/status output.

Exit policy: 0 success; 2 invalid invocation; 3 missing/mismatched target or refused confirmation; 4 unavailable service/deadline before a write was dispatched; 5 uncertain mutation outcome; 1 other failures. SIGINT exits 130 after bounded cleanup; if a mutation was dispatched, its error envelope reports the outcome as unknown unless completion was established. Broken output pipes must exit nonzero without dumping a stack trace or retrying writes.

`--timeout-ms` is a positive integer, default 5000 and maximum 30000. One operation deadline covers discovery waits, stdin, connection, headers/body, and output flushing; it is not reset per request. Cancellation allows a separate cleanup grace of at most 3000 ms, after which the process exits nonzero without claiming clean shutdown. Thus the normal invocation bound is the operation deadline plus cleanup grace, not an unbounded finalizer wait. Cap normal admin request/response and explicitly read inbox body sizes at 1 MiB, with a small bounded diagnostic for oversized data. Enforce response limits while streaming before buffering/decoding, not just from Content-Length: the rc.112 Undici text reader did not honor the generic incoming-message size reference in the Mailpit probe. These are proposed local-tool limits, not WorkOS parity claims.

Lists default to 50 results, allow `--limit` from 1 through 100, and return an opaque `nextCursor` or `null`. No automatic all-pages scan. Cursors bind to selected stack, relevant state generation, and filter; reject cross-target reuse and never embed secrets. Listing order is deterministic for the provider adapter, without claiming snapshot consistency across concurrent changes. Mailpit exposes offset pagination, not a stable cursor or snapshot; the inbox-specific bounded adapter below must not promise either.

Do not automatically retry mutations. If a write may have committed before timeout, disconnect, response validation failure, or output failure, report uncertainty and direct the caller to inspect state. Read-only commands may be rerun explicitly. Exactly-once semantics, durable idempotency storage, and bulk operations are not added speculatively.

### Mailpit list/read

Resolve the selected Mailpit process, storage generation, and allocated loopback endpoint from the registry, not fixed port 8025 or inherited environment. Mailpit's `/api/v1/info` exposes the database path and version/stats, not a stack UUID or tenant ID; its optional label is presentation data in `/api/v1/webui`. A matching expected database path is an additional consistency check, not stack attestation or proof of socket/process ownership. Verify the owned process/listener and lifecycle record around the bounded read; coordinate with existing same-stack lifecycle locking and discard a result if ownership/generation changed. This protects against cooperating-stack mistakes, not hostile same-user processes. If safe ownership cannot be established, refuse rather than read an unverified inbox.

Use Mailpit's existing loopback HTTP API directly from the CLI. No new provider route or socket proxy is required for inbox reads. Disable redirects and refuse off-loopback destinations/userinfo. Keep existing delivery configuration unchanged; do not introduce a protected webroot or browser proxy. No automatic browser opening or fallback to another inbox.

`inbox list` exposes ID, To addresses, subject, and timestamp, not a message-body preview, attachment data, or extracted credentials. The raw list API contains a `Snippet` field with body text; use an explicit allowlisted projection rather than passing through Mailpit DTOs. Metadata is still potentially sensitive: subjects can contain a code or link. Never claim credential-free listings or persist them in routine logs.

Use `GET /api/v1/messages` with explicit positive `start`/`limit` bounds. Do not use `limit=0`: in this version that ordinary-list request is unbounded and ignores offset. For `--to`, compare structured To addresses case-insensitively within one bounded ordinary-list page. Match addresses, not display names, substrings, or Cc/Bcc fields. Do not insert user input into `to:` search: even quoted search is substring-based, wildcard input broadens it, and the search implementation materializes all matches before slicing.

The inbox limit bounds raw summaries examined in one invocation, not a promise to fill the page with matching messages. Return `scanned`, projected `messages`, and an opaque next cursor advancing the raw offset. An empty filtered page can have a next cursor. Bind it to the selected inbox ownership epoch, filter, and limit; reject a stale or cross-target cursor. Do not add automatic all-pages scanning to hide this distinction. Do not report an exact filtered total from an unfiltered page.

Mailpit orders by creation time descending without an explicit unique tie-breaker. Concurrent arrivals/deletions and tied timestamps can duplicate or omit items between offset pages; continuation is explicitly best-effort. Waiting/snapshot semantics remain deferred. A future timestamp boundary must use a tested encoding: the runtime probe found fractional-seconds `Z` ineffective while the equivalent `+00:00` boundary worked. Do not infer snapshot stability from a working cutoff.

`inbox read` deliberately exposes message text, potentially including a synthetic code or reset link. Flag the response as sensitive and never persist it in CLI logs, automatically extract/submit codes, open links, execute HTML, fetch assets, or download attachments. Mailpit's parsed `Text` may be derived server-side from HTML; label its provenance as Mailpit-parsed-or-derived rather than claiming an original plain-text MIME part. If that text is empty, return `text: null` with an explicit no-usable-text indication. The CLI itself does not render HTML.

**Approved read-status behavior:** `inbox read` uses the normal parsed `GET /api/v1/message/{id}` endpoint and marks the message read. Disclose this in help and successful results (`readStateEffect: marks-read`). It does not initiate delivery, complete verification/reset, or change authentication state. This permitted inbox bookkeeping effect does not require provider-mutation confirmation flags; normal target checks and any supplied target assertions still apply.

The server may mark the message read before a client timeout, oversized-response refusal, or output failure. A failure after dispatch must acknowledge that possibility rather than promise preserved unread state; apply the existing uncertain-outcome policy when completion cannot be established. Never restore unread afterward as a workaround. Inbox listing remains nonmutating. Do not add raw-MIME retrieval or a parser solely to preserve the unread flag; that alternative is outside the selected v1 behavior.

Message IDs and pagination are scoped to the selected inbox. Mailpit state may survive provider-user deletion or identity changes; returning a current target stamp does not claim that an old message belongs to the current provider generation. Preserve message timestamps and instruct callers to select the actual message for the native attempt. List/read are not verification/reset-flow coverage by themselves.

Inbox waiting, polling, deletion, attachment support, code extraction, and email initiation are deferred. A later waiting design must establish a pre-action boundary and a bounded timeout to avoid consuming old messages.

## Private local administration

The provider process owns two distinct surfaces: existing WorkOS-compatible TCP endpoints with their local SDK credential, and a separate admin HTTP application on a private Unix socket. The CLI calls existing provider operations through that socket. SDK credentials and application identities do not grant admin access; no bearer credential or browser session is introduced for this listener. This does not remove the separately required Convex bootstrap credential.

The OS account is the authorization boundary: root and same-user processes are trusted, not isolated tenants. Create/verify an owner-only 0700 parent before binding, verify owner and file type without following untrusted symlinks, and set the socket to 0600. Use a short registry-owned path containing stable instance identity, independent of branch names and deep checkout paths; validate the platform path-length limit before acquiring services. Persist its association through existing lifecycle bookkeeping, not a new target-selection system.

Effect scopes own the listener, client dispatcher, and cleanup. Normal provider stop closes the socket and removes its owned endpoint while preserving database/signing identity. A failed bind never overwrites or unlinks an unknown/live socket. Crash-stale cleanup requires registry ownership plus proof that its recorded owner is no longer live; ambiguity returns an actionable refusal. Coordinate same-instance startup/reclamation with existing lifecycle locking. Account changes, insecure modes, symlinks, stale identity, and occupied paths fail closed.

All admin routes have schemas, bounded inputs/outputs, narrow DTOs, and expected stack/generation validation. Mutation invariants and confirmation checks remain server-side. No raw-token, password-hash, signing-key, teardown, or generic arbitrary-operation endpoint is added. Do not expose private SDK-facing challenge/code reads as admin inspection conveniences.

Alternatives considered: loopback admin HTTP plus a per-instance secret is viable for a future portable/remote client, but adds credential handling and a browser-reachable listener; direct database access duplicates lifecycle/concurrency responsibility; retaining FoldKit preserves browser infrastructure the user no longer wants. HTTP over the private socket reuses Effect HTTP/schema conventions without inventing a protocol or another service supervisor.

There are no admin cookies, CSRF/unlock endpoints, persistent browser secrets, protected Mailpit proxy, or admin/inbox Tailscale routes in this target design. Retiring any preexisting developer-browser route requires the existing ownership-safe retirement contract and explicit execution authorization; do not globally reset Tailscale or expose Mailpit while removing a protection layer.

## Reset and lifecycle semantics

Existing lifecycle tooling owns bulk reset and destruction, not the administration CLI or a remotely callable teardown endpoint. Inbox list/read does not add inbox clearing. The table preserves the previously approved lifecycle design; it is not an expansion of the CLI command surface.

| Operation | Changes | Preserves |
| --- | --- | --- |
| Revoke sessions | Selected provider sessions become non-refreshable | Identity, signing keys, Convex data |
| Delete user | Provider identity and associated authentication records | Convex data, device storage, inbox |
| Clear provider data | Users, sessions, verification/reset records | Issuer, signing keys, socket authorization boundary, Convex data, device storage, inbox |
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
- Prove loopback-only operation without Tailscale or external network access, then native-phone reachability over explicitly managed routes. CLI administration and inbox access remain local-only.
- Verify socket owner/modes, generation-bound requests and atomic mutation checks, SDK/TCP rejection of admin routes, occupied/stale paths, bounded cleanup, and absence of remote admin/Mailpit exposure.
- Exercise CLI success/usage/refusal/timeout/interrupt/output-failure paths with captured stdout/stderr and closed stdin; verify human/JSON modes, help, flags in supported positions, canary redaction, input/output bounds, and no automatic mutation replay.
- Verify inbox recipient filtering, bounded pagination, cross-inbox cursor refusal, sensitive explicit reads, HTML-derived/empty text and oversized messages, the approved read-status policy, ownership changes, and native-flow-only email initiation against the pinned Mailpit API.
- Verify cross-environment storage handling before refresh; preserve evidence about actual erasure separately from authentication success.
- Keep real-WorkOS contract checks separate. Local-provider native results are not real-WorkOS end-to-end coverage.

The real-credential XCTest investigation remains blocked and is not reopened. Draft PR #43 and unrelated root/phone-preview work remain preserved. Prior field/SecureStore erasure was not verified; no statement here changes that checkpoint.

## Implementation acceptance gates (not yet executed)

1. Exercise the specified wire/error fixtures through SDK 10.11.0, verify documented refresh/reset semantics and atomic concurrency outcomes, and record explicit local-policy differences in separate real-provider contract checks. Full WorkOS parity is not a v1 claim.
2. Basic independent-issuer/loopback-HTTP-JWKS authentication is proven for the recorded backend binary. Verify the specified per-instance audience/client-ID policy through actual Recovery identity checks and WebSocket authentication. Full offline-stack operation remains distinct from the completed loopback HTTP probe.
3. Prove local bootstrap rejects remote/mismatched targets and inherited real deployment credentials; test both JWT trust and application identity rejection. A mode string alone is not deployment attestation.
4. Prove Mailpit list/read against the pinned version and two isolated real inboxes without creating proxy/webroot/tailnet exposure. Recovery remains the native-flow email owner; inbox waiting and administrative email initiation are out of v1.
5. Validate the exact Effect RC dependency set, native CLI runtime, HTTP socket transport, and SQLite behavior on the pinned Node version under normal install/check safeguards. Disposable CLI/socket proofs establish feasibility, not integrated correctness, clean TypeScript/lint, or complete lifecycle cleanup. Verify human/JSON mode switching and failure sanitization beyond the always-machine prototype.
6. Verify version-specific Convex and Pitchfork instance isolation, configurable Expo/Metro ports, host-wide Tailscale route allocation, concurrent startup, stale-owner recovery, and ownership-scoped cleanup. Do not bypass route conflicts or substitute shared state when a platform constraint is encountered.

## Historical consistency review

The earlier approved browser design resolved stable mobile environment identity, subject non-reuse after reset, revocation/JWT caveats, separate provider versus whole-stack destruction, native-only email ownership, optional name fields, and local-only password-policy claims. Those provider/application boundaries remain unchanged. Its browser/cookie/layout review is historical evidence, not approval of this CLI revision.

## CLI revision review status

The user approved this complete written revision after the CLI and Mailpit spikes and the explicit read-status decision. It replaces browser-specific delivery with a local CLI/private-socket contract and adds inbox list/read without changing native authentication or application authorization. Provider semantics and lifecycle destruction boundaries are preserved; the command/output/timeout defaults are approved local-tool design choices.

Independent document review found no blockers in the direction and identified three clarifications: dependency-version authority, potentially sensitive inbox subjects, and partial-output/deadline behavior. These are now explicit, including the installed Mailpit pin and supported Undici export, no credential-free metadata guarantee, and bounded output flushing with uncertain partial results. That document review preceded the subsequent 27-check Mailpit runtime spike. The approved revision incorporates verified list/search/pagination/text/byte-limit behavior. The user approved normal mark-as-read semantics for `inbox read` and subsequently approved the complete design. The linked research note separates these executed disposable proofs from source findings and untested real-registry/admin/native integration. A design review does not satisfy the acceptance gates. The next workflow phase is reconciliation of the authorized issue-backed scope and delivery ownership, followed by implementation under normal safeguards. No issue edits, application changes, or production actions were performed as part of this document revision.
