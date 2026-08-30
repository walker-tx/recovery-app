# Zero Development Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an idempotent `mise run zero` workflow that securely configures local WorkOS/Convex development and starts Mailpit, Convex, and Expo through Pitchfork.

**Architecture:** Keep finite setup decisions in a tested shell script and long-running process definitions in `pitchfork.toml`. Replace synchronous console credential delivery with an awaited, loopback-only Mailpit HTTP adapter so supervised backend logs contain no verification codes or reset tokens.

**Tech Stack:** mise, Bash, Node 24, pnpm, Pitchfork 2.22.0, Mailpit 1.31.0, Convex 1.44.0, TypeScript, Vitest, Expo 57.

**Spec:** `docs/superpowers/specs/2026-08-29-zero-development-cycle-design.md`

## Global constraints

- Work in the current checkout; do not create a worktree or overwrite unrelated changes.
- Use pnpm only, always through mise's managed environment.
- Never run a cloud/production Convex command or expose credentials in argv, logs, fixtures, or tracked files.
- Preserve existing `mise.local.toml` values without prompting.
- Keep Mailpit loopback-only and in-memory.
- Keep Expo native-only; do not add web support.
- Follow TDD: observe each new test fail for the intended reason before implementation.

## File map

- `packages/backend/convex/authEmailDelivery.ts`: loopback validation and Mailpit HTTP delivery adapter.
- `packages/backend/convex/authEmailDelivery.test.ts`: payload, runtime guard, failure, and no-console tests.
- `packages/backend/convex/workosAuthOrchestration.ts`: asynchronous delivery contract and awaited calls.
- `packages/backend/convex/workosAuthOrchestration.test.ts`: proves orchestration waits for and propagates delivery failure.
- `scripts/zero.sh`: secure, idempotent finite bootstrap and local MCP generation.
- `scripts/test-zero.sh`: hermetic fixture/fake-tool contract test for bootstrap behavior.
- `pitchfork.toml`: Recovery daemon definitions, dependencies, readiness, and group.
- `mise.toml`: Mailpit pin and zero/dev/stop/status/logs/test tasks.
- `package.json`: remove stale `setup:auth`; keep workspace scripts minimal.
- `.gitignore`: ignore generated `.kit/mcp.local.json` and any Pitchfork-local overrides.
- `README.md`: development cycle, services, MCP startup, and verification.

## Task 1: Replace console credentials with awaited Mailpit delivery

**Files:**
- Modify: `packages/backend/convex/authEmailDelivery.test.ts`
- Modify: `packages/backend/convex/workosAuthOrchestration.test.ts`
- Modify: `packages/backend/convex/authEmailDelivery.ts`
- Modify: `packages/backend/convex/workosAuthOrchestration.ts`

- [ ] Add failing adapter tests that inject a fake `fetch` and assert verification, reset, and guidance messages POST to `/api/v1/send` with the real recipient, safe subject, and expected plain-text body.
- [ ] Add failing tests for non-loopback Convex URLs, a non-loopback Mailpit URL, non-2xx responses, and network rejection. Assert no credential is passed to `console.info` or `console.log`.
- [ ] Run `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/authEmailDelivery.test.ts` and confirm failures are due to the missing Mailpit API.
- [ ] Add a failing orchestration test whose delivery promise is deliberately unresolved, prove the public operation remains pending, then resolve it. Add a rejected-delivery case and assert it follows the existing fail-closed public error policy.
- [ ] Run the focused orchestration test and confirm the current synchronous calls fail the new assertions.
- [ ] Implement an injected Mailpit delivery factory plus production wrappers. Validate loopback with parsed URLs, construct Mailpit's documented JSON payload, await `fetch`, and reject non-2xx responses without logging message bodies.
- [ ] Change `AuthDelivery` methods to `void | Promise<void>` and await every delivery call before returning from orchestration. Preserve synchronous test doubles.
- [ ] Run both focused Vitest files and confirm they pass with no warnings.
- [ ] Run `mise exec -- pnpm --filter @recovery/backend run check`.

## Task 2: Build the secure idempotent bootstrap

**Files:**
- Create: `scripts/test-zero.sh`
- Create: `scripts/zero.sh`
- Modify: `.gitignore`

- [ ] Write a failing fixture-based shell test. Supply fake `mise`, `pnpm`, `convex`, and `pitchfork` executables that record command names but never values. Cover: repository-root enforcement, dependency install, missing-only prompts/generation, preservation of existing values, mode `0600`, local-only Convex selection, stdin-based Convex synchronization, `convex dev --once`, generated public URL, MCP JSON generation, daemon start, and concise output.
- [ ] Add negative cases proving inherited cloud/production deployment configuration is rejected and a failed setup does not start daemons.
- [ ] Run `mise exec -- bash scripts/test-zero.sh` and confirm it fails because `scripts/zero.sh` does not exist.
- [ ] Implement `scripts/zero.sh` with `set -euo pipefail`, a repository-root check, restrictive `umask`, cleanup traps, and small functions that can be exercised by the fixture.
- [ ] Detect values with a no-output `mise exec` shell predicate. Use `mise set --file mise.local.toml --prompt` for missing WorkOS dashboard values. Generate internal keys with Node's `crypto.randomBytes` and pipe them to `mise set --stdin`; never interpolate secrets into argv or output.
- [ ] Configure only a local Convex deployment. Handle first-run configuration separately from the normal existing-local path, synchronize each required value through stdin to `convex env set --deployment local`, then run `convex dev --once --tail-logs disable`. Fail if any selected deployment is not local.
- [ ] Read the generated local Convex URL without printing other environment values and persist only the public Expo URL through the intended local mise configuration.
- [ ] Generate `.kit/mcp.local.json` atomically with mode `0600`, the resolved repository path as `cwd`, and `mise exec -- pitchfork mcp`.
- [ ] Start only the Recovery project group after all setup steps succeed, then print daemon status and generic loopback URLs.
- [ ] Run `mise exec -- bash scripts/test-zero.sh` and confirm all cases pass.

## Task 3: Declare and validate the development daemons and mise tasks

**Files:**
- Create: `pitchfork.toml`
- Modify: `mise.toml`
- Modify: `package.json`
- Modify: `scripts/test-zero.sh`

- [ ] Extend the shell contract test with failing assertions for the expected pinned tools, mise task names, Recovery namespace, daemon names, Mailpit loopback flags/in-memory mode, dependency edges, readiness checks, and exact lifecycle group.
- [ ] Run the test and confirm it fails on missing configuration.
- [ ] Pin `mailpit = "1.31.0"` beside the already pinned Pitchfork `2.22.0`. Add `zero`, `dev`, `stop`, `status`, `logs`, and bootstrap-test tasks. Keep `install`, `check`, and `doctor`.
- [ ] Add `pitchfork.toml` with `namespace = "recovery"`. Configure Mailpit on loopback ports `8025`/`1025` without a database path and with HTTP readiness. Configure backend through mise and depend on Mailpit. Configure mobile through mise, depend on backend readiness, and do not enable Expo web. Add a group containing exactly these daemons.
- [ ] Ensure `dev` starts the group and returns, `stop` stops the same group, and status/log tasks remain scoped to these daemon names.
- [ ] Remove the stale root `setup:auth` script that targets a nonexistent backend command. Do not add a replacement auth package or migration framework.
- [ ] Run the shell contract test and `mise tasks validate`.
- [ ] Run `mise exec -- pitchfork daemons` and verify all three project daemons parse. Do not start real services during this configuration check.

## Task 4: Document the development cycle

**Files:**
- Modify: `README.md`

- [ ] Update the shell contract test or add a focused documentation assertion that initially fails unless README contains `mise install`, `mise run zero`, lifecycle tasks, Mailpit URL, local-only/staging guidance, MCP startup, and native-only scope; reject `walker@air`, personal tunnel examples, `expo start --web`, and stale `setup:auth`.
- [ ] Run the documentation assertion and confirm the existing README fails for the expected missing/stale content.
- [ ] Rewrite prerequisites and setup around mise as the sole manually installed tool. Document the initial `mise install` / `mise run zero` path and the normal dev/status/logs/stop cycle.
- [ ] Document Convex local deployment, WorkOS staging, ignored `mise.local.toml`, missing-only prompts, generated internal secrets, Mailpit's loopback in-memory inbox, and public `EXPO_PUBLIC_*` semantics without revealing any local values.
- [ ] Document `kit tui --root . --mcp-config .kit/mcp.local.json`, explicitly noting that `zero` generates the checkout-specific ignored file.
- [ ] Keep all examples machine-neutral and native-mobile-only.
- [ ] Run the documentation contract and `git diff --check -- README.md mise.toml pitchfork.toml scripts packages/backend/convex .gitignore docs/superpowers`.

## Task 5: Full verification and review

- [ ] Run `mise exec -- bash scripts/test-zero.sh`.
- [ ] Run focused backend tests for email delivery and orchestration.
- [ ] Run the repository's complete backend test command if focused changes reveal shared-contract impact.
- [ ] Run `mise run check`.
- [ ] Run `mise run doctor` because the developer bootstrap and Expo startup contract changed, even though no native dependency is added.
- [ ] Re-run vendored skill/mirror checks only if the implementation modifies `.agents`; otherwise leave the validated skill catalog untouched.
- [ ] Run `git diff --check`.
- [ ] Inspect `git status --short` and ensure unrelated pre-existing changes are preserved.
- [ ] Request an independent Critical/Important review covering secret handling, local-only enforcement, Pitchfork lifecycle scope, Mailpit credential retention, MCP path generation, README accuracy, and test evidence.
- [ ] Address retained findings with a new failing test before each behavioral fix, then repeat the smallest affected checks.
- [ ] Do not commit unless the user explicitly asks; report changed files, verification evidence, and any manual first-run step that could not be safely exercised.
