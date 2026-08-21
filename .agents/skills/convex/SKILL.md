---
name: convex
description: Develop the Convex backend and Convex Auth safely, with generated-code boundaries, validators, authorization, indexes, and deployment setup.
---

# Convex workflow

This repository-specific skill supplements the installed official Convex skills. Use `convex-expert` before editing backend code, `convex-docs` for version-sensitive APIs, `convex-reviewer` or `convex-authz` for audits, `convex-test`/`convex-verify` for behavior checks, `convex-migrate` for data changes, and `convex-deploy-guard` before deployment-affecting commands. Repository instructions and `docs/architecture.md` take precedence over generic defaults.

Backend source lives in `packages/backend/convex`. `convex/_generated` is produced by Convex: never hand-edit it. After selecting a development deployment, run `mise exec -- pnpm dev:backend` to deploy functions and refresh generated types.

## Function and data rules

- Every public query, mutation, or action must define argument and return validators.
- Authenticate inside server functions with `ctx.auth.getUserIdentity()` or a shared helper. Never trust a client-supplied user ID.
- Authorize each read and write against server-owned data. Authentication alone is not authorization.
- Add schema indexes for normal lookup paths and query through them; avoid loading a table and filtering in application code.
- Keep actions for external side effects. Prefer queries and mutations for database work.
- Keep deployment credentials and secrets in Convex environment variables. `.env.local` is uncommitted.

## Convex Auth

- Preserve `authTables` in `schema.ts`, the provider in `auth.ts`, auth HTTP routes in `http.ts`, and the provider declaration in `auth.config.ts`.
- The mobile app currently uses the Password provider and SecureStore-backed tokens.
- `@convex-dev/auth` is pre-1.0 and pinned exactly. Review release notes and setup changes before upgrading.
- `pnpm setup:auth` runs the upstream CLI from the backend package. It may ask for a `SITE_URL` because the split backend package is not itself an Expo package; for this password-only native app, accept the default. Do not add Expo to the backend to alter CLI detection.

## Validation

```sh
mise exec -- pnpm --filter @recovery/backend run check
# Requires a configured deployment:
mise exec -- pnpm --filter @recovery/backend run codegen
```
