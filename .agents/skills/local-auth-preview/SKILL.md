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

Resolve the host's tailnet IPv4 address without changing Serve state:

```bash
if tailscale status >/dev/null 2>&1; then
  TS=tailscale
elif ~/.local/bin/tailscale-cli status >/dev/null 2>&1; then
  TS="$HOME/.local/bin/tailscale-cli"
else
  echo "No working Tailscale CLI" >&2
  exit 1
fi
TAILNET_IP="$($TS ip -4 | head -1)"
test -n "$TAILNET_IP"
```

A second device also needs a tailnet-reachable Convex URL. After local Convex readiness, invoke `exposing-dev-servers-over-tailscale`, inspect existing Serve state, and publish the locally healthy Convex endpoint on an unused task-owned HTTPS listener. Record the exact listener and target in that skill's ledger. For example, only when `8443` is unused and local Convex is healthy on `3210`:

```bash
printf '8443\t/\thttp://localhost:3210\n' >>"$STATE_DIR/added-routes.tsv"
$TS serve --bg --yes --https=8443 http://localhost:3210
TAILNET_HOST="$($TS status --json | jq -er '.Self.DNSName | rtrimstr(".")')"
TAILNET_CONVEX_URL="https://$TAILNET_HOST:8443"
```

Use the actual inspected local Convex port; never assume `3210` after a remap. Confirm the tailnet URL responds and supports the Convex client connection before starting Expo. Do not expose the deployment-management UI or any unrelated local service.

For a native Expo client on the tailnet, start Metro in LAN mode while making the installed Expo CLI advertise the tailnet address and overriding only the public Convex URL for this process:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME="$TAILNET_IP" \
  mise exec -- env EXPO_PUBLIC_CONVEX_URL="$TAILNET_CONVEX_URL" \
  pnpm run dev:mobile -- --lan
```

The repository's installed Expo SDK still supports `REACT_NATIVE_PACKAGER_HOSTNAME`, but Expo marks it for future removal. Recheck the installed `@expo/cli` implementation during SDK upgrades; do not persist this override in configuration.

Use the default native Expo workflow. This repository does not have a durable web application; do not add React Native Web dependencies or run `expo start --web` solely for convenience.

Wait for Metro's listener and manifest response with a bounded timeout. Report the actual URL Expo prints; do not assume a port. Distinguish a listening Metro process from a device that has successfully loaded the app.

## 4. Tailnet access

Native Metro access normally uses direct tailnet routing to the advertised `TAILNET_IP`; it does not need or benefit from an invented Tailscale Serve route. Invoke `exposing-dev-servers-over-tailscale` before changing Serve state for any separate, locally healthy HTTP service. That skill owns Serve inspection, route ledgers, tailnet-only validation, and cleanup.

Classify the target:

- **Browser-visible HTTP preview:** stop. This repository currently has no supported web preview. Do not create one implicitly or publish an invented route.
- **Expo Go or development build:** confirm the printed manifest or deep link uses `TAILNET_IP`, verify Metro responds on that address and its actual selected port, and verify the process received `TAILNET_CONVEX_URL` before opening the QR or deep link on the second tailnet device. The manifest, bundle URL, WebSocket host, and Convex URL must all remain tailnet-reachable. Do not invent a Tailscale Serve path for Metro.
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

- stop only recorded backend and Expo processes;
- remove only task-owned Tailscale routes using the Tailscale skill's ledger; direct native tailnet routing creates no Serve route to remove;
- verify pre-existing routes and processes remain;
- preserve unrelated stashes and working-tree files;
- report whether any second-device validation was never performed.

## Common mistakes

- Assuming `.env.local` owns WorkOS secrets instead of `mise.local.toml`.
- Starting Expo while Convex is absent, then diagnosing the result as a WorkOS failure.
- Treating a log-tail process as the backend.
- Running Metro in CI mode and expecting hot reload.
- Claiming another device can connect after testing only on the host.
- Adding temporary web dependencies or config to create a preview.
- Leaving stale Expo, Convex, SSH, or Tailscale processes without an ownership record.
