# Agent notes

## Repository shape

- `apps/mobile`: Expo Router mobile application.
- `packages/backend`: Convex functions, schema, and Convex Auth.
- Keep this foundation mobile-only and intentionally small. Do not add a web app, EAS, CI, shared packages, or recovery domain features unless requested.

## Tooling and dependencies

- Tool versions are owned by `mise.toml`. Run commands through `mise exec -- ...` unless mise is already activated.
- Use pnpm only. Add a dependency to the workspace package that consumes it.
- Oxfmt and Oxlint own code style. Run `mise run format` after edits, `mise run lint` for fast feedback, and `mise run check` before delivery. For a small edit, run `mise exec -- pnpm exec oxlint <paths>` and `mise exec -- pnpm exec oxfmt --check <paths>` first; full checks remain required.
- Use braces for every control-flow body, strict equality, `const` where possible, explicit type-only imports, and no explicit `any`. Keep blank lines between logical steps; the formatter preserves separation but cannot infer intent.
- Fix lint findings rather than weakening configuration or adding blanket disables. Any necessary suppression must be narrow and explain why; unused suppressions fail checks. Do not format generated code or vendored skills.
- Preserve Expo's SDK-compatible React and React Native versions. Add Expo/native packages with `pnpm --filter @recovery/mobile exec expo install <package>`.
- Do not run `expo prebuild` unless a native/config plugin change requires it.

## Expo and secrets

- Routes and layouts live under `apps/mobile/src/app`.
- Local development credentials and environment values are managed through the gitignored `mise.local.toml`. Run local commands through `mise exec -- ...` so those values are loaded. `.env*` files are forbidden, including examples; never create them or copy values from `mise.local.toml` into them.
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

## GitHub Project work tracking

- Markdown is authoritative for research, approved design specifications, architecture, and decisions. Do not create Markdown implementation plans.
- GitHub Issues and sub-issues are authoritative for user stories, scopes, implementation plans, executable tasks, acceptance criteria, and dependencies. GitHub Project fields own workflow status.
- Do not turn a conversation into an issue unless the user explicitly requests it or approves a preview. Search for overlapping work before creation.
- Once work is authorized, routine status, linkage, and evidence updates are allowed. Material scope, acceptance-criteria, priority, iteration, and backlog changes still require approval. Tracking authorization never grants permission to bypass review safeguards, merge, deploy, or make production changes.
- Keep vendored Superpowers skills unchanged. Before ordinary `writing-plans`, use the repository-owned `planning-project-work` wrapper so planning discipline produces approved issue-backed work instead of a Markdown plan. Use `executing-project-work` for authorized issue-backed delivery.
- Project identity and supported workflow values live in `.github/project-workflow.yml`. Resolve opaque GitHub IDs at runtime.

## Agent GitHub identity

- Preserve the repository owner's commit author and committer attribution. Do not add AI co-author trailers.
- Authenticate agent-created GitHub activity and agent pushes using the designated GitHub App; authentication must not change commit attribution.
- Keep authentication configuration local. Before GitHub operations, read `AGENTS.local.md` if present. If app authentication is unavailable, stop rather than falling back to personal credentials or separately authenticated tools.
- Never print credentials or enable credential tracing. Existing review and deployment safeguards still apply; app credentials do not authorize merges, deployments, production changes, or safeguard bypasses.

## Working agreement

- Inspect before editing and make the smallest coherent change. Avoid speculative abstractions.
- Run the smallest package-specific check first. Before finishing a cross-package change, run `mise run check`; for Expo dependency/config changes also run `mise run doctor`.
