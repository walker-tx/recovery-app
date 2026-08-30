---
name: local-auth-preview
description: Use when starting the Recovery mobile app and local Convex backend for WorkOS authentication testing, keeping the preview running for a user, exposing it to another tailnet device, troubleshooting local auth reachability, or cleaning up preview processes and routes.
---

# Local auth preview

## Overview

Run the real local Recovery stack through Mise, prove each layer before exposing it, and leave an explicit cleanup trail. Local credentials belong to `mise.local.toml`; never print or relocate them.

## Non-negotiable constraints

- Resolve `REPO_ROOT="$(git rev-parse --show-toplevel)"` and run workspace commands there unless a command says otherwise.
- Run project commands through `mise exec -- ...` so the repository-root `mise.local.toml` is loaded.
- Never read, print, copy, commit, or summarize values from `mise.local.toml`.
- Never put its values in `.env` files or `EXPO_PUBLIC_*` variables.
- Keep Convex commands local. Do not deploy merely to make a preview work.
- Record only processes and Tailscale routes created by this task; preserve pre-existing state.
- Use Tailscale Serve, never Funnel, when an HTTP service needs tailnet exposure.

## 1. Inspect before starting

Confirm the supported scripts rather than inventing commands:

```bash
mise tasks ls
node -e 'console.log(require("./package.json").scripts)'
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(8081|8082|3210|3211) ' || true
pgrep -fl 'convex dev|expo start' || true
```

The expected repository scripts are:

```bash
mise exec -- pnpm run dev:backend
mise exec -- pnpm run dev:mobile
```

If scripts change, use the inspected values. Do not restore old commands from this skill by force.

Create a task ledger under `/tmp` containing only non-secret process IDs, ports, and health results. Set `umask 077` before creating it. Do not redirect Convex output to a persistent file: local console delivery can emit verification codes and reset tokens. Start Convex only in a user-owned terminal whose output is not captured by the agent harness, and never record its output or terminal path in the ledger. Ask the user to report only the non-secret readiness result; verification codes and reset tokens stay in that terminal.

## 2. Start and prove the backend

Start the backend first:

```bash
mise exec -- pnpm run dev:backend
```

Have the user confirm Convex readiness from that terminal within a bounded timeout. Do not inspect, stream, or capture its output through the harness, including on failure; ask for a non-secret error summary if startup fails. Do not dump environment output or credential files. A stale `tail -f` process is not proof that Convex is running.

WorkOS behavior in this repository:

- password signup, verification, sign-in, recovery, reset, refresh, restoration, and sign-out run through local Convex;
- verification codes and reset tokens use local console delivery, not real inbox delivery;
- recovery uses a manual token, not a reset deep link;
- Apple and Google are not implemented;
- the current backend supports WorkOS `staging` mode only; do not select or document an emulator mode unless the backend contract changes;
- a staging configuration change requires the documented local Convex restart or sync;
- production deployment is outside preview scope.

Never include verification codes, reset tokens, passwords, access tokens, refresh tokens, or full credential-bearing logs in the response.

## 3. Start and prove Expo

### Stop and classify the client

Before starting Expo, identify what the second device will run: Expo Go, a development build, iOS Simulator, Android emulator, or an explicitly supported browser build. If the user only says “another device,” ask which native client they will use. Default to the native Expo workflow; never reinterpret “preview” as a browser page.

This repository has no supported web preview. Do not run `expo start --web`, invent a web port or HTTP root, add React Native Web dependencies, or create a Tailscale Serve route for an Expo web page. Those actions require a separate explicit product/configuration change.

For Expo Go on a physical tailnet device, use the repository-owned workflow instead of reconstructing Tailscale state manually:

```bash
mise run zero:tailnet
```

This task verifies local Convex first, publishes only Convex through a task-owned tailnet HTTPS handler, forwards Metro through a task-owned raw TCP Serve listener on port `8081`, advertises the host's tailnet IPv4 address to Expo Go, and records both routes in the ignored checkout-local ledger. Raw TCP forwarding is required in environments where Tailscale Serve works but direct phone-to-Metro traffic stalls. `mise run status` reports whether the checkout ledger is active, and `mise run stop` removes only the exact owned handlers and restores loopback configuration.

Invoke `exposing-dev-servers-over-tailscale` before troubleshooting or changing Serve state outside these tasks. Never expose the deployment-management UI, Mailpit, or an unrelated local service.

The repository's installed Expo SDK still supports `REACT_NATIVE_PACKAGER_HOSTNAME`, but Expo marks it for future removal. Recheck the installed `@expo/cli` implementation during SDK upgrades; do not persist this override in configuration.

Use the default native Expo workflow. This repository does not have a durable web application; do not add React Native Web dependencies or run `expo start --web` solely for convenience.

Wait for Metro's listener and manifest response with a bounded timeout. Report the actual URL Expo prints; do not assume a port. Distinguish a listening Metro process from a device that has successfully loaded the app.

## 4. Tailnet access

The supported Recovery workflow uses a raw TCP Tailscale Serve forward for Metro because direct iPhone-to-Metro routing can be blocked even when both peers are online. Do not replace it with Funnel or an Expo public tunnel when the requested boundary is tailnet-only. The checkout ledger and `mise run stop` own cleanup.

Classify the target:

- **Browser-visible HTTP preview:** stop. This repository currently has no supported web preview. Do not create one implicitly or publish an invented route.
- **Expo Go or development build:** run `mise run zero:tailnet`, confirm the printed manifest or deep link uses the host tailnet IPv4, verify the raw TCP Metro route and HTTPS Convex route, then open the printed `exp://` URL on the second device. The manifest, bundle URL, WebSocket host, and Convex URL must all remain tailnet-reachable.
- **SSH port forwarding:** treat it as a user/machine-specific transport. Record the forwarded port and process, but never bake hostnames such as `air` into repository instructions.

Do not use Expo's public tunnel as a substitute when the user asked for tailnet-only access. Do not alter WorkOS callback allowlists unless the actual tested flow requires browser redirects and the user authorizes the external configuration change.

## 5. Validate in layers

Report these separately:

1. Local Convex readiness.
2. Local Metro/Expo readiness.
3. Serving-node access to the task-owned tailnet Convex URL.
4. Metro's advertised tailnet address and the bundled public Convex URL.
5. Access from the second tailnet device.
6. One real email/password auth flow, noting that codes/tokens come from local console delivery.

A local HTTP 200 does not prove second-device reachability or successful WorkOS authentication.

## Cleanup and handoff

When the user wants the preview left running, report what is running, the bounded lifetime of harness-managed background calls, and the exact cleanup ledger path. Background tool calls are not durable services.

On cleanup:

- for the repository-owned workflow, run `mise run stop` to stop the Recovery group and remove only the checkout-ledgered HTTPS and raw TCP Serve routes;
- for any manual troubleshooting route, remove only entries recorded in that task's Tailscale ledger;
- verify pre-existing routes and processes remain;
- preserve unrelated stashes and working-tree files;
- report whether any second-device validation was never performed.

## Common mistakes

- Creating any `.env*` file; all checkout-local configuration belongs in `mise.local.toml`.
- Starting Expo while Convex is absent, then diagnosing the result as a WorkOS failure.
- Treating a log-tail process as the backend.
- Running Metro in CI mode and expecting hot reload.
- Claiming another device can connect after testing only on the host.
- Adding temporary web dependencies or config to create a preview.
- Leaving stale Expo, Convex, SSH, or Tailscale processes without an ownership record.
