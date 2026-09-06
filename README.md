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

Local development remains staging-only and still calls WorkOS staging. Mailpit provides only local delivery of Recovery verification and password-reset email. Pitchfork starts Mailpit, the Convex backend, and Expo in dependency order. Open Mailpit at <http://127.0.0.1:8025> to read those messages. Mailpit listens only on loopback and keeps its inbox in memory, so messages remain on this machine and disappear when Mailpit restarts.

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
only forward arguments to the runtime; existing `zero`, `zero:tailnet`, `status`,
and `stop` tasks keep their legacy behavior.

Startup requires the local provider
package, installed Expo/Convex dependencies, Node, pnpm, Mailpit, and Pitchfork.

The runtime reserves separate ports/state, prepares private bootstrap values,
validates provider identity, synchronizes and pushes functions to the paired local
Convex instance, publishes paired mobile configuration, then starts Metro. That
`start` command performs local writes; tests use injected I/O instead. It never
targets a cloud deployment or falls back to staging credentials.

SMTP readiness uses its own greeting; Convex site readiness checks its own TCP
listener only, not application health. Ambiguous command/publication timeouts
retain the lifecycle lock for manual ownership reconciliation. Never remove locks
or reset state merely to retry a failed start. Existing daily-development scripts
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
- `mise run check` — run workspace static checks
- `mise run doctor` — run Expo Doctor

The explicit local runtime API also exposes `destroyProvider(confirmation)` for a
**stopped** isolated provider. It is not exposed by a CLI, HTTP route, or console.
Confirmation names `operation: "destroy-provider-identity"`, the exact canonical
`worktree`, `stackId`, `providerGeneration`, and both `affectedDomains`:
`["provider-data", "provider-signing-identity"]`. This removes only the owned
provider SQLite database and its present WAL/SHM files, which contain provider
records and signing keys. It does not clear Convex, Mailpit, device state, admin
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
