# Recovery

A small mobile-first foundation for a recovery app. It includes an Expo Router app, a Convex backend, and password authentication. No recovery domain model has been introduced yet. Development is native mobile only; the default workflow is intended for the iOS Simulator, not Expo web.

Development conventions and abstraction triggers are defined in [`docs/architecture.md`](docs/architecture.md). Kit can also discover the repository-owned and selected official Convex and Expo skills under [`.agents/skills`](.agents/skills).

## Prerequisite

Install [mise](https://mise.jdx.dev/). It is the sole manually installed development tool; the repository pins and installs Node, pnpm, Pitchfork, and Mailpit.

## First start

From the repository root, prepare the toolchain and start the complete local development environment:

```sh
mise install
mise run zero
```

`zero` installs workspace dependencies and configures a local Convex deployment. It uses WorkOS staging credentials, prompting only for a missing `WORKOS_API_KEY` or `WORKOS_CLIENT_ID`, and generates missing email HMAC and intent-encryption secrets. It stores these values in the ignored, checkout-local `mise.local.toml`, sets that file to owner-only access, and syncs the required values to local Convex. Re-running `zero` preserves existing values. All `.env*` files—including examples—are forbidden so they cannot override Mise; never create them or paste local credentials into tracked files.

The generated `EXPO_PUBLIC_CONVEX_URL` is safe to expose to the mobile client because every `EXPO_PUBLIC_*` value is bundled into the app. Treat that prefix as public configuration, never as a place for secrets. The bootstrap rejects cloud Convex configuration and accepts only a loopback local deployment.

### Mobile authentication identity (#50 / bootstrap #47 contract)

Mobile requires **both** public values supplied together by bootstrap:

- `EXPO_PUBLIC_AUTH_ENVIRONMENT_ID`: `<stack UUID>:<provider-generation UUID>` (two UUIDs separated by `:`). Bootstrap generates and persists these nonsecret UUIDs, preserves them across restarts and backend port changes, and rotates the provider-generation UUID when the signing/provider identity is replaced. Never infer this value from a URL, port, branch, or a staging constant.
- `EXPO_PUBLIC_CONVEX_URL`: the actual paired Convex destination, preserving the configured backend and real WorkOS staging trust source.

Mobile fences saved sessions by the explicit environment ID only, preserving credentials across same-identity port and Tailscale reachability changes. It replaces its in-memory session/provider subtree when either member of the trusted pair changes, so restoration uses a newly created owner and the configured backend client. Missing or malformed setup displays an explicit configuration failure before restoration; it is not a retryable token-storage error. Restart Expo after public configuration changes. Bootstrap #47 must provision the ID before this mobile phase can authenticate; existing `zero` scripts do not yet supply it. Do not manually copy credentials or create `.env` files.

### Local backend trust contract (integration in progress)

The backend supports an explicit `WORKOS_MODE=local` configuration; it never falls back between local and staging providers. Bootstrap must supply:

- `LOCAL_AUTH_STACK_ID` and `LOCAL_AUTH_PROVIDER_GENERATION`, paired to the registry.
- `WORKOS_CLIENT_ID=client_local<generation UUID without hyphens>`, `WORKOS_AUDIENCE` equal to that client ID, and `WORKOS_ISSUER=https://local-workos.invalid/instances/<generation UUID>`.
- Loopback `WORKOS_API_URL` and `WORKOS_JWKS_URL`. The backend additionally validates Convex's built-in `CONVEX_CLOUD_URL` and `CONVEX_SITE_URL` (not the CLI's `CONVEX_URL`). Phone-facing Tailscale addresses are not backend runtime destinations.
- A launcher-generated `LOCAL_WORKOS_API_KEY`: `sk_test_local_` plus 64 lowercase hex characters from 32 cryptographically random bytes. Local mode never falls back to `WORKOS_API_KEY`; a differing generic key is rejected. Never copy a real WorkOS key into local configuration.

Local trust rejects inherited cloud deploy keys and nonlocal deployment selectors. Convex enforces the local audience through `applicationID`; Recovery separately checks canonical issuer, client claim, and subject, with resource ownership unchanged. Staging retains its fixed real-WorkOS issuer/JWKS and rejects local overrides. SDK clients are constructed from current validated configuration rather than retaining an old destination.

These are tested configuration and session-ownership contracts, not completed HTTP/WebSocket/native end-to-end proof. Bootstrap integration (#47) and verification/reset/refresh lifecycle (#48) remain dependencies. Existing default scripts still use staging and call WorkOS staging. Mailpit provides only local delivery of Recovery verification and password-reset email. Pitchfork starts Mailpit, the Convex backend, and Expo in dependency order. Open Mailpit at <http://127.0.0.1:8025> to read those messages. Mailpit listens only on loopback and keeps its inbox in memory, so messages remain on this machine and disappear when Mailpit restarts.

## Daily development cycle

After the first start, manage the same services with mise:

```sh
mise run dev
mise run status
mise run logs
mise run stop
```

- `mise run dev` starts the Mailpit, backend, and mobile daemons.
- `mise run status` reports each daemon's state.
- `mise run logs` shows recent logs from the three daemons.
- `mise run stop` stops the development daemons.
- `mise run zero` remains safe to use when a checkout needs to be repaired or completed.

Expo and local Convex bind to loopback. The default zero workflow works directly with the iOS Simulator, with Expo at <http://127.0.0.1:8081>. Android emulators and physical devices require separate explicit native networking setup not configured by zero.

### Expo Go over Tailscale

To use Expo Go on a phone connected to the same tailnet, even when the phone is on another physical network, run:

```sh
mise run zero:tailnet
```

This keeps Metro bound to loopback, forwards it through a tailnet-only raw TCP Serve listener, and publishes local Convex through a separate tailnet-only HTTPS listener. It never uses Funnel or exposes Mailpit publicly. The command preserves unrelated Serve routes and prints the `exp://` URL to open in Expo Go. `mise run status` reports whether the checkout-owned routes are active. Run `mise run stop` to stop the development services, remove only those exact routes, and restore loopback configuration.

## Pitchfork MCP in Kit

`mise run zero` generates the checkout-specific `.mcp.json`. The file contains the absolute checkout path and is ignored by Git, so regenerate it in each checkout rather than copying or committing it. Kit discovers it automatically when started from the repository root:

```sh
kit tui --root .
```

## Isolated local stack (development checkpoint)

`scripts/stack-runtime.cjs` provides ownership-checked `reserve`, `status <stack-UUID>`,
`stop <stack-UUID>`, and `start <absolute-backend-executable>` commands. Run through
`mise exec -- node` from the intended worktree. The executable is the local Convex
server, not the Recovery backend functions. Opt in explicitly from that worktree:

```sh
mise run stack:start -- /absolute/path/to/convex-server
mise run stack:status -- <stack-UUID>
mise run stack:stop -- <stack-UUID>
```

Replace the placeholders (quote paths containing spaces); use the `stackId` from
startup output for status/stop. No server executable path is inferred. These tasks
only forward arguments to the runtime. The existing local entrypoints also accept
explicit isolated mode as their first argument, from the intended worktree root:

```sh
mise run zero -- --isolated /absolute/path/to/convex-server
mise run status -- --isolated <stack-UUID>
mise run stop -- --isolated <stack-UUID>
```

These dispatch before any legacy configuration/migration/service work and never
fall back after an isolated failure. No-argument legacy behavior is unchanged;
these commands do not adopt or stop existing legacy previews.
`mise run zero:tailnet -- --isolated` is explicitly unavailable pending the
separately authorized #60/#49 route lifecycle; it never falls through to legacy
route publication. The open #28/#34 work and PR33/35 bootstrap exception/readiness
changes are not altered or reauthorized by this local-only dispatch.

Startup requires the local provider
package, installed Expo/Convex dependencies, Node, pnpm, Mailpit, and Pitchfork.

Each local/test stack is named by the canonical worktree directory basename,
within the repository's shared Git common-directory registry. Branch names are
not stack keys. A name stays bound to one canonical path; a competing path with
the same name is refused, even when the first stack is stopped. Different
repositories have separate name scopes; occupied sockets still block launch.
Starting an already-running stack is refused before preparation or extra launches.
Stopped stacks may restart with their existing identity and state. Recreating a
directory at the same path does not require the same historical inode, but does
not restore deleted data: an established stack with missing or incompatible
provider identity refuses startup. Names never authorize killing or deleting
resources. Process identity, file ownership, lifecycle locks, and unknown-route
and reservation-release gates remain in force.

Previously host-wide same-name reservations require explicit reconciliation
before default repository-scoped selection. No automatic migration, identity
recreation, state copying, or reservation release is performed.

The runtime reserves separate ports/state, prepares private bootstrap values,
validates provider identity, synchronizes and pushes functions to the paired local
Convex instance, publishes paired mobile configuration, then starts Metro. That
`start` command performs local writes; tests use injected I/O instead. It never
targets a cloud deployment or falls back to staging credentials.

**Accepted local Convex exception:** the generated `LOCAL_CONVEX_INSTANCE_SECRET`
remains in vendor-required `--instance-secret` arguments for keygen and server
startup, only for explicitly local development/test backends. The user accepts
its visibility in same-host process arguments and process-inspection output.
This is an accepted exposure, not a fixed input mechanism or permission to add
secret logging. Other credentials, tokens, passwords, and production/remote
targets are excluded. Existing diagnostic redaction, private deploy-credential
environment transport, owner-only `mise.local.toml`, and runtime guards remain
unchanged. See the [security contract](docs/superpowers/specs/local-workos-development-provider-design.md#architecture-and-configuration).

Status probes only verified original owned-running processes whose paired daemon
mapping still matches. Stopped, conflicted, or unknown endpoints stay
`unknown/not-probed`. Each eligible endpoint gets one bounded probe; failures are
sanitized as `not-ready/probe-failed`, without changing process ownership state.
`ready` reports protocol evidence, not application health or process identity.
Status also reports resume guidance using the supported isolated command and an
explicit `<absolute-backend-executable>` parameter, never an inferred path. Run
it only when authorized, from the reported worktree, with your verified executable.
This is guidance, not an executed action or proof that lifecycle locks are clear;
startup still performs its existing ownership and lock checks. Conflicted or
unknown ownership, or unknown/failed readiness for a running process, instead
reports refusal and directs inspection of the reported services/scoped logs.
There is no automatic repair command: never clear locks, kill unknown processes,
or reset state to bypass refusal.
SMTP readiness uses its own greeting; Convex site readiness reports `transport`
evidence for its own TCP listener only, not application health.
Ambiguous command/publication timeouts retain the lifecycle lock
for manual ownership reconciliation. Never remove locks or reset state
merely to retry a failed start. Existing daily-development scripts
and previews are not managed by these commands.

This remains a development checkpoint: fake-I/O tests do not establish successful
native startup, complete authentication, or the reset/refresh lifecycle.

### Local provider bulk-clear capability

The acquired provider API exposes `clearData(confirmation)` as a scoped Effect;
`startProvider` exposes it through its existing Promise boundary. This is a local
lifecycle API, not an HTTP endpoint or a `stack:stop` side effect. No clear command
is enabled in the CLI. Execution against actual state requires separate approval.

Confirmation explicitly names `operation: "clear-provider-data"`, the exact
configured absolute `database`, the acquired `providerGeneration`, and all three
`affectedDomains`: `users`, `sessions`, `challenges`. The operation rechecks the
opened database identity and persisted signing identity, then atomically clears
those tables using the already-acquired SQL service. Failed transactions roll back;
identity, signing keys, credentials and other data domains are not cleared.
Already-issued access tokens remain valid until expiry; recreated users receive
new subjects. This covers the current provider schema, not unimplemented #48
refresh/reset operations or whole-stack destruction/reservation release.

## Checks

- `mise run bootstrap-test` — test the secure bootstrap and documentation contract
- `mise run format` — apply Oxfmt formatting to owned JS/TS/TSX and JSON files
- `mise run lint` — run strict Oxlint checks (warnings and unused suppressions fail)
- `mise run check` — check formatting, lint, then workspace types
- `mise exec -- pnpm run lint:fix` — apply safe lint fixes; review the diff
- `mise exec -- pnpm run test:style` — verify bad code is rejected and formatting repairs it
- `mise run doctor` — run Expo Doctor

The explicit local runtime API also exposes `destroyProvider(confirmation)` for a
**stopped** isolated provider. It is not exposed by a CLI, HTTP route, or console.
Confirmation names `operation: "destroy-provider-identity"`, the exact canonical
`worktree`, `stackId`, `providerGeneration`, and both `affectedDomains`:
`["provider-data", "provider-signing-identity"]`.
This removes only the owned provider SQLite database
and its present rollback journal/WAL/SHM files,
which contain provider records and signing keys. It does not clear Convex, Mailpit, device state, admin
seed, ownership markers, routes, or reservations, and does not rotate registry
identity or re-pair trust.

Before deletion, the lifecycle lock covers original registry/stopped-provider and
private filesystem identity checks, and a retirement intent is exclusively
created and synced along with its parent directory. Any retirement entry blocks
normal stack startup before allocation/preparation, including malformed entries.
Partial results enumerate removed, uncertain, and unattempted storage files;
uncertain operations retain both retirement intent and lifecycle exclusion for
manual ownership reconciliation. There is no automatic retry, tombstone removal,
or trust re-pairing operation. A fresh identity requires deliberate trust
re-pairing; ordinary restart must not recreate it under the old generation.
Cooperative lifecycle exclusion does not defeat arbitrary same-user filesystem
or unmanaged-process races. Coverage includes an acquired-provider fixture with
real SDK authentication and persisted SQLite signing identity, closed before
lifecycle deletion; retired startup refuses recreation, and a sibling acquired
provider remains usable. Non-provider sentinel files retain their bytes/inodes.
These are owned temporary fixtures, not actual developer-resource destruction,
secure erasure, trust re-pairing, or complete two-stack/native proof.
Whole-stack teardown and reservation release remain unavailable pending the
separately authorized authoritative route-retirement integration and all other
owned-domain completion evidence.

### Code style

Pinned Oxfmt and Oxlint versions give agents and editors the same rules. Oxfmt uses
an 80-column target, two spaces, semicolons, double quotes, trailing commas, and
one JSX attribute per line. Import and package-key sorting are disabled. Preserve
blank lines between logical steps: formatting cannot decide semantic grouping.

Oxlint enables correctness and suspicious rules as errors, plus mandatory braces,
strict equality, `const`/no `var`, type-only imports, no explicit `any`, and React
hook/dependency checks. TypeScript remains the type checker; Oxlint's experimental
type checking is not enabled. All warnings and unused disable directives fail.

Explicit rule exclusions keep checks appropriate for this repository:

- The automatic JSX runtime needs no React import; React Native style props are
  not DOM style objects.
- React Compiler-specific purity, hooks, memoization, synchronous-effect state,
  and effect-dependency rules are not adopted in this tooling-only change.
  Standard rules-of-hooks and exhaustive-deps remain errors.
- In-place array sorting/reversing and locally scoped helper functions are valid;
  this setup does not force immutable-array rewrites or helper extraction.
- Convex's `_id` and `_creationTime` are allowed by the underscore naming rule.

Generated Convex files, vendored skills, dependencies, build output, and lockfiles
are excluded. Formatting is limited to JS/TS and JSON rather than rewriting prose.
For the quickest edit loop, pass changed paths directly to `pnpm exec oxlint` or
`pnpm exec oxfmt`; run the full `mise run check` before delivery. Do not use unsafe
lint fixes or blanket suppressions to make checks pass.
