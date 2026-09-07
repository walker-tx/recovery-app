#!/bin/sh
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
if [ "${1-}" = '--isolated' ]; then
  [ "$(pwd -P)" = "$ROOT" ] || { echo 'Run this command from the repository root.' >&2; exit 1; }
  shift
  exec node "$ROOT/scripts/stack-runtime.cjs" status "$@"
fi
STATE_DIR=$ROOT/.recovery-tailnet

pitchfork status mailpit
pitchfork status backend
pitchfork status mobile

if [ ! -d "$STATE_DIR" ]; then
  echo 'Tailnet: inactive'
  exit 0
fi

if [ -f "$STATE_DIR/ts-command" ] && [ -f "$STATE_DIR/host" ] && [ -f "$STATE_DIR/added-routes.tsv" ] && [ -f "$STATE_DIR/tcp-route.tsv" ]; then
  TS=$(cat "$STATE_DIR/ts-command")
  HOST=$(cat "$STATE_DIR/host")
  HTTPS_PORT=$(cut -f1 "$STATE_DIR/added-routes.tsv")
  HTTPS_TARGET=$(cut -f2- "$STATE_DIR/added-routes.tsv")
  TCP_PORT=$(cut -f1 "$STATE_DIR/tcp-route.tsv")
  TCP_TARGET=$(cut -f2- "$STATE_DIR/tcp-route.tsv")
  if CURRENT=$($TS serve status --json 2>/dev/null) && printf '%s' "$CURRENT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const [host,hport,htarget,tport,ttarget]=process.argv.slice(1),j=JSON.parse(s);if(j.Web?.[`${host}:${hport}`]?.Handlers?.["/"]?.Proxy!==htarget||j.TCP?.[tport]?.TCPForward!==ttarget)process.exit(1)})' "$HOST" "$HTTPS_PORT" "$HTTPS_TARGET" "$TCP_PORT" "$TCP_TARGET"; then
    echo "Tailnet: active (Convex https://$HOST:$HTTPS_PORT, Metro tcp://$HOST:$TCP_PORT)"
    exit 0
  fi
fi

echo 'Tailnet: stale (run mise run stop before restarting)'
exit 1
