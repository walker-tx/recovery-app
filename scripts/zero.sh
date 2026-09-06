#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
ROOT=$(pwd -P)
[ "$ROOT" = "$SCRIPT_ROOT" ] || { echo 'Run this command from the repository root.' >&2; exit 1; }
if [ "${1-}" = '--isolated' ]; then
  shift
  exec node "$ROOT/scripts/stack-runtime.cjs" start "$@"
fi
./scripts/migrate-convex-dotenv.sh
./scripts/check-no-dotenv.sh
LOCAL_CONFIG=mise.local.toml
MCP_TMP=
umask 077
cleanup() { [ -z "$MCP_TMP" ] || rm -f "$MCP_TMP"; }
trap cleanup EXIT HUP INT TERM

die() { echo "$*" >&2; exit 1; }
[ ! -d "$ROOT/.recovery-tailnet" ] || ./scripts/stop.sh >/dev/null

has_local_key() { grep -Eq "^[[:space:]]*$1[[:space:]]*=" "$LOCAL_CONFIG"; }
has_value() { has_local_key "$1" && env -u "$1" mise exec -- sh -c 'test -n "$(printenv "$1")"' sh "$1" >/dev/null 2>&1; }
value_is() { env -u "$1" mise exec -- sh -c '[ "$(printenv "$1")" = "$2" ]' sh "$1" "$2" >/dev/null 2>&1; }
set_stdin() { mise set --file "$LOCAL_CONFIG" --stdin "$1" >/dev/null; }

ensure_prompted() {
  has_value "$1" || mise set --file "$LOCAL_CONFIG" --prompt "$1" >/dev/null
}

ensure_generated() {
  has_value "$1" || mise exec -- node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))' | set_stdin "$1"
}

ensure_fixed() {
  if has_value "$1"; then
    value_is "$1" "$2" || die "$1 conflicts with the required local policy."
  else
    printf %s "$2" | set_stdin "$1"
  fi
}

run_convex() { env -u CONVEX_AGENT_MODE -u CONVEX_DEPLOYMENT mise exec -- pnpm --filter @recovery/backend exec convex "$@"; }

sync_convex() {
  env -u "$1" mise exec -- sh -c 'printenv "$1"' sh "$1" | run_convex env set "$1" >/dev/null
}

case ${CONVEX_DEPLOYMENT:-} in
  ''|local:*|anonymous:*) ;;
  *) die 'Inherited Convex deployment must be local.' ;;
esac
[ -z "${CONVEX_DEPLOY_KEY:-}" ] || die 'Cloud Convex deployment credentials are not permitted.'

touch "$LOCAL_CONFIG"
chmod 600 "$LOCAL_CONFIG"
pnpm install --frozen-lockfile >/dev/null

ensure_prompted WORKOS_API_KEY
ensure_prompted WORKOS_CLIENT_ID
ensure_generated WORKOS_EMAIL_HMAC_KEY
ensure_generated WORKOS_INTENT_ENCRYPTION_KEY
ensure_fixed WORKOS_MODE staging
ensure_fixed AUTH_EMAIL_DELIVERY_URL http://127.0.0.1:8025/api/v1/send

pitchfork start mailpit backend >/dev/null
./scripts/migrate-convex-dotenv.sh
./scripts/check-no-dotenv.sh

selected_deployment=$(env -u CONVEX_DEPLOYMENT mise exec -- sh -c 'printenv CONVEX_DEPLOYMENT')
printf %s "$selected_deployment" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{if(!/^(?:local|anonymous):[A-Za-z0-9._-]+$/.test(s))process.exit(1)})' || die 'Selected Convex deployment is not local.'

for key in WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY WORKOS_MODE AUTH_EMAIL_DELIVERY_URL; do
  sync_convex "$key"
done

convex_url=$(env -u CONVEX_URL mise exec -- sh -c 'printenv CONVEX_URL')
printf %s "$convex_url" | mise exec -- node -e 'let s=""; process.stdin.on("data", c => s += c).on("end", () => { try { const u=new URL(s); if (u.protocol !== "http:" || u.username || u.password || !["127.0.0.1", "localhost"].includes(u.hostname) || !u.port) process.exit(1); } catch { process.exit(1); } });' || die 'Generated Convex URL is not loopback-only.'
printf %s "$convex_url" | set_stdin EXPO_PUBLIC_CONVEX_URL
printf %s localhost | set_stdin RECOVERY_EXPO_MODE
printf %s localhost | set_stdin RECOVERY_EXPO_HOSTNAME

MCP_TMP=$(mktemp .mcp.json.XXXXXX)
mise exec -- node -e 'const cwd=process.argv[1]; process.stdout.write(JSON.stringify({mcpServers:{pitchfork:{command:"mise",args:["exec","--","pitchfork","mcp"],cwd}}}, null, 2)+"\n")' "$ROOT" > "$MCP_TMP"
chmod 600 "$MCP_TMP"
mv "$MCP_TMP" .mcp.json
MCP_TMP=

pitchfork start mobile >/dev/null
echo 'Recovery services:'
for daemon in mailpit backend mobile; do
  pitchfork status "$daemon"
done
echo 'Mailpit: http://127.0.0.1:8025'
echo 'Expo: http://127.0.0.1:8081'
