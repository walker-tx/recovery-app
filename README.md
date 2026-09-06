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
- Loopback `WORKOS_API_URL`, `WORKOS_JWKS_URL`, `CONVEX_URL`, and `CONVEX_SITE_URL`. Phone-facing Tailscale addresses are not backend runtime destinations.
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

## Checks

- `mise run bootstrap-test` — test the secure bootstrap and documentation contract
- `mise run check` — run workspace static checks
- `mise run doctor` — run Expo Doctor
