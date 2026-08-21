# Recovery

A small mobile-first foundation for a recovery app. It includes an Expo Router app, a Convex backend, and password authentication. No recovery domain model has been introduced yet.

Development conventions and abstraction triggers are defined in [`docs/architecture.md`](docs/architecture.md). Kit can also discover the repository-owned and selected official Convex and Expo skills under [`.agents/skills`](.agents/skills).

## Prerequisites

Tool versions are pinned by mise (`Node 24.16.0`, `pnpm 11.19.0`).

```sh
mise install
mise run install
```

The commands below assume mise is activated in your shell. Otherwise, prefix direct pnpm commands with `mise exec --`, or use the checked-in `mise run check` and `mise run doctor` tasks.

## Connect Convex

1. Run `pnpm dev:backend` and sign in to Convex when prompted. Choose or create a development deployment. This writes `packages/backend/.env.local`.
2. Stop the dev command, run `pnpm setup:auth` to generate and set the Convex Auth signing keys, then restart `pnpm dev:backend`. Because the CLI runs from the split backend package, it may also ask for a `SITE_URL`; accept the default for this password-only native app. A successful backend run deploys functions and generates `packages/backend/convex/_generated`.
3. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_CONVEX_URL` to the generated `CONVEX_URL`.
4. In another terminal run `pnpm dev:mobile`, then open iOS or Android from Expo.

## Commands

- `pnpm dev` — run workspace development tasks through Turbo
- `pnpm dev:backend` — configure and develop Convex
- `pnpm dev:mobile` — start Expo
- `mise run check` — run workspace TypeScript checks
- `mise run doctor` — run Expo Doctor
- `pnpm setup:auth` — configure Convex Auth keys after selecting a deployment
