#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
[ "$(pwd -P)" = "$ROOT" ] || { echo 'Run this command from the repository root.' >&2; exit 1; }
STATE_DIR=$ROOT/.recovery-tailnet
LOCAL_CONFIG=$ROOT/mise.local.toml
DEPLOYMENT_CONFIG=$ROOT/packages/backend/.env.local
ACTIVE=0

die() { echo "$*" >&2; exit 1; }
set_stdin() { mise set --file "$LOCAL_CONFIG" --stdin "$1" >/dev/null; }
cleanup_on_exit() {
  STATUS=$?
  trap - EXIT
  if [ "$ACTIVE" -eq 1 ] && ! ./scripts/stop.sh; then echo 'Tailnet rollback was incomplete; run mise run stop.' >&2; fi
  exit "$STATUS"
}
trap cleanup_on_exit EXIT HUP INT TERM

if tailscale status >/dev/null 2>&1; then
  TS=tailscale
elif "$HOME/.local/bin/tailscale-cli" status >/dev/null 2>&1; then
  TS=$HOME/.local/bin/tailscale-cli
else
  die 'No working Tailscale CLI.'
fi
STATUS_JSON=$($TS status --json)
HOST=$(printf '%s' "$STATUS_JSON" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const n=JSON.parse(s).Self?.DNSName;if(typeof n!=="string"||n.length<2)process.exit(1);process.stdout.write(n.replace(/\.$/,""))})') || die 'Tailscale has no stable MagicDNS hostname.'
TAILNET_IP=$($TS ip -4 | head -1)
[ -n "$TAILNET_IP" ] || die 'Tailscale has no IPv4 address.'
mise run stop >/dev/null
ACTIVE=1
mise run zero >/dev/null

CONVEX_URL=$(sed -n 's/^CONVEX_URL=//p' "$DEPLOYMENT_CONFIG")
printf '%s' "$CONVEX_URL" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const u=new URL(s);if(u.protocol!=="http:"||!["127.0.0.1","localhost"].includes(u.hostname)||!u.port)process.exit(1)}catch{process.exit(1)}})' || die 'Local Convex URL is not loopback-only.'
curl -fsS --max-time 5 "$CONVEX_URL" >/dev/null || die 'Local Convex is not healthy.'

SERVE_STATE=$($TS serve status --json)
LISTENER=$(printf '%s' "$SERVE_STATE" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);for(let p=8443;p<=8452;p++){if(j.TCP?.[p]===undefined){process.stdout.write(String(p));return}}process.exit(1)})') || die 'No unused Tailscale HTTPS listener from 8443 through 8452.'
SERVE_STATE=$($TS serve status --json)
printf '%s' "$SERVE_STATE" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const [host,port]=process.argv.slice(1),j=JSON.parse(s);if(j.TCP?.[port]!==undefined||j.TCP?.[8081]!==undefined||j.Web?.[`${host}:${port}`]!==undefined)process.exit(1)})' "$HOST" "$LISTENER" || die 'Selected Tailscale listener became occupied.'

TAILNET_CONVEX_URL=https://$HOST:$LISTENER
printf '%s' tailnet | set_stdin RECOVERY_EXPO_MODE
printf '%s' "$TAILNET_IP" | set_stdin RECOVERY_EXPO_HOSTNAME
printf '%s' "$TAILNET_CONVEX_URL" | set_stdin EXPO_PUBLIC_CONVEX_URL
pitchfork stop mobile >/dev/null
pitchfork start mobile >/dev/null

mkdir -m 700 "$STATE_DIR"
printf '%s' "$TS" > "$STATE_DIR/ts-command"
printf '%s' "$HOST" > "$STATE_DIR/host"
printf '%s\t%s\n' "$LISTENER" "$CONVEX_URL" > "$STATE_DIR/added-routes.tsv"
printf '%s\t%s\n' 8081 localhost:8081 > "$STATE_DIR/tcp-route.tsv"
$TS serve --bg --yes --https="$LISTENER" "$CONVEX_URL" || die 'Could not publish local Convex with Tailscale Serve.'
$TS serve --bg --yes --tcp=8081 tcp://localhost:8081 || die 'Could not publish Metro with Tailscale Serve.'
CURRENT=$($TS serve status --json)
printf '%s' "$CURRENT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const [host,port,target]=process.argv.slice(1),j=JSON.parse(s);if(j.Web?.[`${host}:${port}`]?.Handlers?.["/"]?.Proxy!==target||j.TCP?.[8081]?.TCPForward!=="localhost:8081")process.exit(1)})' "$HOST" "$LISTENER" "$CONVEX_URL" || die 'Tailscale Serve did not create the expected tailnet-only routes.'
curl -fsS --max-time 5 "$TAILNET_CONVEX_URL" >/dev/null || die 'Tailnet Convex URL is not healthy from this machine.'
curl -fsS --max-time 10 "http://$TAILNET_IP:8081" >/dev/null || die 'Metro is not reachable on the tailnet address.'

ACTIVE=0
trap - EXIT HUP INT TERM
echo "Expo Go: exp://$TAILNET_IP:8081"
echo "Convex: $TAILNET_CONVEX_URL"
echo 'Stop and remove the task-owned Serve route with: mise run stop'
