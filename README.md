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

`zero` installs workspace dependencies and configures a local Convex deployment. It uses WorkOS staging credentials, prompting only for a missing `WORKOS_API_KEY` or `WORKOS_CLIENT_ID`, and generates missing email HMAC and intent-encryption secrets. It stores these values in the ignored, checkout-local `mise.local.toml`, sets that file to owner-only access, and syncs the required values to local Convex. Re-running `zero` preserves existing values. Mise remains the authoritative configuration source; do not maintain `.env*` files, including examples, or paste local credentials into tracked files. **Convex bootstrap exception (approved in #28):** the CLI may temporarily generate `packages/backend/.env.local`. On successful bootstrap, the existing `zero` workflow validates and migrates only `CONVEX_DEPLOYMENT`, `CONVEX_URL`, and `CONVEX_SITE_URL` into `mise.local.toml`, removes the generated file, and checks that no dotenv files remain. Migration accepts only local/anonymous deployments and loopback URLs and rejects unsupported content. If bootstrap or migration fails, the generated file may remain for intervention; cleanup and successful startup are not guaranteed by this exception. Do not hand-author the generated file, add application secrets, copy Mise values into it, commit it, or keep it as an ongoing configuration source.

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

## Checks

- `mise run bootstrap-test` — test the secure bootstrap and documentation contract
- `mise run check` — run workspace static checks
- `mise run doctor` — run Expo Doctor
