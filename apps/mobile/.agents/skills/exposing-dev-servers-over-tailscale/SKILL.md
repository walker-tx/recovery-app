---
name: exposing-dev-servers-over-tailscale
description: Use when making one or more local development servers available to another device over Tailscale, exposing a dev UI, API, callback server, or mock OIDC issuer on the tailnet, configuring `tailscale serve`, troubleshooting an unreachable Tailnet URL, or cleaning up Tailscale development routes.
---

# Exposing development servers over Tailscale

Use **Tailscale Serve**, never Funnel: development services must remain tailnet-only. Treat Serve configuration as node-global state—inspect it before changing it and remove only routes created for the task.

## 1. Resolve a working CLI

The normal macOS wrapper may be stale and fail with:

```text
/Applications/Tailscale.app/Contents/MacOS/Tailscale: No such file or directory
```

Use the first command that successfully runs `status`:

```bash
if tailscale status >/dev/null 2>&1; then
  TS=tailscale
elif ~/.local/bin/tailscale-cli status >/dev/null 2>&1; then
  TS="$HOME/.local/bin/tailscale-cli"
else
  echo "No working Tailscale CLI; repair/install it before continuing" >&2
  exit 1
fi
```

A client/daemon version warning is acceptable if commands succeed. Require valid daemon status and a nonempty stable hostname before constructing URLs:

```bash
STATUS_JSON="$($TS status --json)" || exit 1
HOST="$(jq -er '.Self.DNSName | select(type == "string" and length > 1) | rtrimstr(".")' <<<"$STATUS_JSON")" || exit 1
```

## 2. Verify each local service first

Do not debug Tailscale until the target responds locally:

```bash
curl -fsS http://localhost:3000/ >/dev/null
curl -fkSs https://localhost:8443/ >/dev/null  # self-signed local HTTPS
```

Keep services bound to localhost unless their framework requires otherwise. Record only jobs, containers, or OS process IDs launched by this task; cleanup must not stop pre-existing services unless the user explicitly asks.

## 3. Inspect, then publish

Create a durable task ledger; report its path so later shell calls and cleanup can reuse it:

```bash
STATE_DIR=$(mktemp -d /tmp/tailscale-dev.XXXXXX)
printf 'TS=%q\nHOST=%q\n' "$TS" "$HOST" >"$STATE_DIR/context.env"
if ! $TS serve status --json >"$STATE_DIR/serve-before.json" || ! jq -e . "$STATE_DIR/serve-before.json" >/dev/null; then
  rm -f "$STATE_DIR/serve-before.json"
  $TS serve status >"$STATE_DIR/serve-before.txt" || exit 1
fi
$TS funnel status >"$STATE_DIR/funnel-before.txt" 2>&1 || true
: >"$STATE_DIR/added-routes.tsv"  # record listener, path, target before each publish attempt
echo "Tailscale task ledger: $STATE_DIR"
```

Abort if the intended endpoint is public, ownership is unclear, or local health failed. Preserve and report unrelated Funnel configuration; do not modify it. Before each publish attempt, durably append its exact tab-separated `(HTTPS listener, path, target)` to `added-routes.tsv`, then run Serve; this ordering ensures an interruption cannot create an unledgered route. If Serve fails, immediately inspect status and either remove any matching route or retain the ledger entry for cleanup; also record task-launched process/container IDs and any pre-existing service state/config changed by the task. On a shared listener, proceed only when the exact path is unused and the listener mode is compatible; never replace a root or sibling handler. Otherwise choose an unused listener/path or ask the user.

To add a task-owned path without disturbing siblings on a shared listener:

```bash
printf '443\t/my-dev-path\thttp://localhost:3000\n' >>"$STATE_DIR/added-routes.tsv"
$TS serve --bg --yes --https=443 --set-path=/my-dev-path http://localhost:3000
URL="https://$HOST/my-dev-path"
```

Use a listener-root command only when `/` on that listener is unowned or task-owned.

For one HTTP service on the default tailnet HTTPS endpoint:

```bash
printf '443\t/\thttp://localhost:3000\n' >>"$STATE_DIR/added-routes.tsv"
$TS serve --bg --yes --https=443 http://localhost:3000
URL="https://$HOST/"
```

For local HTTPS with a self-signed development certificate:

```bash
printf '443\t/\thttps+insecure://localhost:3000\n' >>"$STATE_DIR/added-routes.tsv"
$TS serve --bg --yes --https=443 https+insecure://localhost:3000
```

For a second service such as mock OIDC, use another HTTPS listener:

```bash
printf '8443\t/\thttp://localhost:36218\n' >>"$STATE_DIR/added-routes.tsv"
$TS serve --bg --yes --https=8443 http://localhost:36218
OIDC_URL="https://$HOST:8443/"
```

Never use `tailscale funnel`. After configuration, `serve status` must say `tailnet only` and list the intended local targets.

## 4. Configure browser-visible URLs

A proxy alone is insufficient for applications with origin or issuer checks. Before restarting services:

- add the exact browser origin—scheme, host, and nondefault port, with no path—to allowed origins (`https://$HOST` or `https://$HOST:8443`);
- set browser-visible application/backend URLs to the tailnet URL;
- preserve complete configured application and OIDC URLs: issuers, discovery URLs, redirect/logout URIs, paths, and required query strings; derive callback paths from existing app configuration rather than inventing them;
- preserve local target schemes: use `https+insecure://` only between Serve and a self-signed local HTTPS server.

For Gram admin worktrees, commonly relevant overrides are:

```toml
GRAM_ADMIN_SERVER_URL = "https://<TAILNET_HOST>"
GRAM_ADMIN_ALLOWED_ORIGINS = "https://<TAILNET_HOST>"
GRAM_ADMIN_OIDC_EMULATOR_URL = "https://<TAILNET_HOST>:8443"
MOCK_OIDC_ISSUER = "https://<TAILNET_HOST>:8443"
```

Keep ports sourced from that worktree's `mise.local.toml`; do not copy another worktree's remapped ports or credentials. Restart affected Pitchfork services after changing overrides.

## 5. Validate from both sides

```bash
$TS serve status
curl -fsS "https://$HOST/" >/dev/null
curl -fsS "https://$HOST:8443/" >/dev/null  # when configured
```

Report validation in three separate layers: local target, serving-node tailnet URL, and second-device tailnet access. The first two do not prove cross-device ACL/reachability. When no second device is available, explicitly report cross-device access as unverified. For auth flows, verify redirects and issuer discovery in addition to loading the page.

## Cleanup

Reload the durable context first with `source "$STATE_DIR/context.env"`. Before removing a ledgered route, confirm its current handler still points to the recorded target; abort on drift. Stop only task-launched service-manager jobs, containers, or recorded process IDs. For a pre-existing service restarted to read temporary overrides, restore its prior config and running/stopped state; do not stop it merely because this task exposed it. Compare current Serve state with the pre-change snapshot. Remove a whole listener only when the task owns that listener:

```bash
$TS serve --https=8443 off
```

When the task owns only one path on a shared listener, remove that handler while preserving siblings:

```bash
$TS serve --https=443 --set-path=/my-dev-path off
```

If every configured route belongs to the finished task, a full reset is simpler:

```bash
$TS serve reset
$TS serve status   # expected: No serve config
```

Do **not** reset when unrelated routes exist. Reload `context.env`, reinspect Serve and Funnel state, compare like-for-like with the files in `$STATE_DIR`, verify every `added-routes.tsv` entry is gone, and verify every pre-existing route remains. Restore recorded service config/state, then delete `$STATE_DIR`. Finally check for related containers and processes by worktree/service name. Do not stop shared databases or Docker infrastructure unless the user asks.

## Common failures

- Publishing before local health works: hides the real service failure behind a proxy error.
- Using `http://$HOST`: Serve normally exposes HTTPS.
- Using `https://localhost` for a self-signed target: use `https+insecure://localhost` for the proxy target only.
- Forgetting allowed origins or the external OIDC issuer: page loads, then CORS/login fails.
- Running Funnel: makes the service public instead of tailnet-only.
- Calling `serve reset` without inspecting existing node-global routes.
