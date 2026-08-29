# Agent notes

## Repository shape

- `apps/mobile`: Expo Router mobile application.
- `packages/backend`: Convex functions, schema, and Convex Auth.
- Keep this foundation mobile-only and intentionally small. Do not add a web app, EAS, CI, shared packages, or recovery domain features unless requested.

## Tooling and dependencies

- Tool versions are owned by `mise.toml`. Run commands through `mise exec -- ...` unless mise is already activated.
- Use pnpm only. Add a dependency to the workspace package that consumes it.
- Preserve Expo's SDK-compatible React and React Native versions. Add Expo/native packages with `pnpm --filter @recovery/mobile exec expo install <package>`.
- Do not run `expo prebuild` unless a native/config plugin change requires it.

## Expo and secrets

- Routes and layouts live under `apps/mobile/src/app`.
- Local development credentials and environment values are managed through the gitignored `mise.local.toml`. Run local commands through `mise exec -- ...` so those values are loaded. Never print, commit, or copy values from `mise.local.toml` into `.env` files.
- `EXPO_PUBLIC_*` values are bundled into the app and must never contain secrets.
- Convex Auth tokens on mobile must remain in `expo-secure-store`.

## Convex

- Backend source lives in `packages/backend/convex`. Never hand-edit `convex/_generated`; generate it with Convex.
- Every public function must declare argument and return validators. Authenticate and authorize on the server for every user-owned read or write.
- Prefer indexed queries over filtering in application code. Keep secrets in Convex deployment environment variables, not repository env files.
- `@convex-dev/auth` is pre-1.0 and pinned exactly; review its release notes before upgrading.

## Architecture

- `docs/architecture.md` is the durable architecture contract. Read it before adding features, shared state, cross-cutting abstractions, structural libraries, or backend capabilities.
- Project and selected official Convex and Expo skills live under `.agents/skills`; activate the relevant skill before specialized work. Repository instructions and the architecture contract take precedence over generic skill defaults.
- Organize growing mobile code by user capability. Keep routes focused on navigation and composition, preserve one-way dependencies, and give every state value one authoritative owner.
- Libraries are welcome when they consolidate demonstrated complexity; document the concrete trigger rather than adopting them for hypothetical scale.

## Working agreement

- Inspect before editing and make the smallest coherent change. Avoid speculative abstractions.
- Run the smallest package-specific check first. Before finishing a cross-package change, run `mise run check`; for Expo dependency/config changes also run `mise run doctor`.
