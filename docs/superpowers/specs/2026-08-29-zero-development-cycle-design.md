# Zero development cycle design

## Goal

Provide one safe, idempotent `mise run zero` entry point that prepares a fresh Recovery checkout, configures local-only WorkOS and Convex development, starts the development services through Pitchfork, and returns concise connection information. Replace credential-bearing Convex console delivery with a local Mailpit inbox so supervised backend logs do not retain verification codes or reset tokens.

## Constraints

- mise is the only manually installed development prerequisite. It owns Node, pnpm, Pitchfork, and Mailpit versions.
- Recovery remains mobile-only. Do not add Expo web support, web dependencies, EAS, or a browser application.
- WorkOS supports staging mode only. Local development still calls WorkOS staging; Mailpit replaces only Recovery's local presentation of credentials.
- Local setup must never select or mutate a cloud or production Convex deployment.
- Existing values in `mise.local.toml` are authoritative and are preserved without prompting. Missing dashboard credentials are prompted with hidden input; missing internal cryptographic keys are generated.
- Secrets must not appear in command arguments, logs, tracked files, generated MCP configuration, or responses.
- Mailpit and its API bind to loopback and use in-memory storage.
- Existing unrelated working-tree changes must remain untouched.

## Tool and configuration ownership

`mise.toml` pins Node, pnpm, Pitchfork, and Mailpit. It exposes setup, lifecycle, status, logs, and verification tasks. `scripts/zero.sh` owns finite bootstrap decisions and secure local configuration mutation. `pitchfork.toml` declaratively owns the three long-running project daemons: `mailpit`, `backend`, and `mobile`.

`mise.local.toml` is ignored, mode `0600`, and stores the local source-of-truth environment values. The bootstrap uses mise's own `set --file` command instead of hand-editing TOML. It checks for values without printing them. The required configuration is:

- developer-provided when missing: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`;
- generated when missing: `WORKOS_EMAIL_HMAC_KEY`, `WORKOS_INTENT_ENCRYPTION_KEY`;
- fixed policy: `WORKOS_MODE=staging`;
- fixed local delivery endpoint: `AUTH_EMAIL_DELIVERY_URL=http://127.0.0.1:8025/api/v1/send`.

The local Convex deployment is configured before values are synchronized. Values are piped to `convex env set --deployment local` through stdin so they do not enter argv. `convex dev --once` is the schema/function deployment and code-generation step; no data-migration framework is introduced. The generated local Convex URL is supplied to Expo as `EXPO_PUBLIC_CONVEX_URL`; it is public bundle configuration, not a secret.

## Mail delivery

The existing delivery boundary becomes asynchronous. The production orchestration awaits verification, reset, and private-guidance delivery. The local adapter validates both Convex runtime URLs and the configured Mailpit URL as loopback-only, builds a plain-text email, and posts it to Mailpit's `/api/v1/send` endpoint. Non-2xx responses and network failures fail closed. No credential is written to `console.*`.

Mailpit runs without a database path so its inbox is process-memory-only. Its UI and API are available at `http://127.0.0.1:8025`; no personal SSH host or tunneling command is repository documentation.

## Process lifecycle

Pitchfork uses the explicit `recovery` namespace. Mailpit has an HTTP readiness check. Backend depends on Mailpit. Mobile depends on backend readiness and receives the local Convex URL through the mise environment. `mise run zero` starts the project group and returns to the shell. `mise run dev`, `stop`, `status`, and `logs` provide normal lifecycle operations and target only Recovery's configured daemons.

## Kit MCP

Kit does not auto-discover repository MCP JSON. Bootstrap generates ignored `.kit/mcp.local.json` with the resolved checkout path and a single stdio server invoking `mise exec -- pitchfork mcp`. The README documents explicit startup with `kit tui --root . --mcp-config .kit/mcp.local.json`. The generated file contains no credentials.

## Documentation

The root README leads with `mise install` and `mise run zero`, then documents normal lifecycle and verification commands, local service URLs, secret ownership, staging-only WorkOS behavior, and native Expo scope. It removes the stale `setup:auth` instruction because its backend script no longer exists. Personal SSH configuration is omitted.

## Verification

Bootstrap behavior is covered by a fixture-based shell self-test with fake tools and no real secrets or deployments. Mailpit delivery and asynchronous orchestration are covered by Vitest tests written before implementation. Configuration is checked with mise/Pitchfork parsing, focused tests, workspace checks, Expo Doctor when warranted, diff whitespace validation, and an independent final review.
