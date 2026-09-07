#!/bin/sh
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
[ "$(pwd -P)" = "$ROOT" ] || { echo 'Run this command from the repository root.' >&2; exit 1; }
if [ "${1-}" = '--isolated' ]; then
  shift
  exec node "$ROOT/scripts/stack-runtime.cjs" stop "$@"
fi
./scripts/check-no-dotenv.sh || exit 1
STATE_DIR=$ROOT/.recovery-tailnet
LOCAL_CONFIG=$ROOT/mise.local.toml
STATUS=0
CLEAN_STATE=1

pitchfork stop --group recovery || STATUS=$?

if [ -d "$STATE_DIR" ]; then
  if [ -f "$STATE_DIR/ts-command" ] && [ -f "$STATE_DIR/host" ] && [ -f "$STATE_DIR/added-routes.tsv" ] && [ -f "$STATE_DIR/tcp-route.tsv" ]; then
    TS=$(cat "$STATE_DIR/ts-command")
    HOST=$(cat "$STATE_DIR/host")
    LISTENER=$(cut -f1 "$STATE_DIR/added-routes.tsv")
    TARGET=$(cut -f2- "$STATE_DIR/added-routes.tsv")
    if CURRENT=$($TS serve status --json); then
      ROUTE_STATE=$(printf '%s' "$CURRENT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const [host,port,target]=process.argv.slice(1),p=JSON.parse(s).Web?.[`${host}:${port}`]?.Handlers?.["/"]?.Proxy;process.stdout.write(p===target?"owned":p===undefined?"absent":"changed")})' "$HOST" "$LISTENER" "$TARGET")
      case $ROUTE_STATE in
        owned)
          if ! $TS serve --https="$LISTENER" --set-path=/ off || ! CURRENT=$($TS serve status --json) || ! printf '%s' "$CURRENT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const [host,port]=process.argv.slice(1);if(JSON.parse(s).Web?.[`${host}:${port}`]?.Handlers?.["/"]!==undefined)process.exit(1)})' "$HOST" "$LISTENER"; then
            echo 'Could not remove the task-owned Convex route.' >&2
            STATUS=1
            CLEAN_STATE=0
          fi
          ;;
        absent) ;;
        *) echo 'Convex route ownership changed; refusing to remove it.' >&2; STATUS=1; CLEAN_STATE=0 ;;
      esac
    else
      echo 'Could not inspect Tailscale Serve state; route ledger retained.' >&2
      STATUS=1
      CLEAN_STATE=0
    fi

    if [ -f "$STATE_DIR/tcp-route.tsv" ]; then
      TCP_PORT=$(cut -f1 "$STATE_DIR/tcp-route.tsv")
      TCP_TARGET=$(cut -f2- "$STATE_DIR/tcp-route.tsv")
      if CURRENT=$($TS serve status --json); then
        TCP_STATE=$(printf '%s' "$CURRENT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const [port,target]=process.argv.slice(1),p=JSON.parse(s).TCP?.[port]?.TCPForward;process.stdout.write(p===target?"owned":p===undefined?"absent":"changed")})' "$TCP_PORT" "$TCP_TARGET")
        case $TCP_STATE in
          owned)
            if ! $TS serve --tcp="$TCP_PORT" off || ! CURRENT=$($TS serve status --json) || ! printf '%s' "$CURRENT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const port=process.argv[1];if(JSON.parse(s).TCP?.[port]!==undefined)process.exit(1)})' "$TCP_PORT"; then
              echo 'Could not remove the task-owned Metro route.' >&2
              STATUS=1
              CLEAN_STATE=0
            fi
            ;;
          absent) ;;
          *) echo 'Metro route ownership changed; refusing to remove it.' >&2; STATUS=1; CLEAN_STATE=0 ;;
        esac
      else
        echo 'Could not inspect the Metro TCP route; route ledger retained.' >&2
        STATUS=1
        CLEAN_STATE=0
      fi
    fi
  else
    echo 'Tailnet route ledger is incomplete; refusing route cleanup.' >&2
    STATUS=1
    CLEAN_STATE=0
  fi
fi

if [ -d "$STATE_DIR" ]; then
  if CONVEX_URL=$(env -u CONVEX_URL mise exec -- sh -c 'printenv CONVEX_URL' 2>/dev/null); then
    if printf '%s' "$CONVEX_URL" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const u=new URL(s);if(u.protocol!=="http:"||!["127.0.0.1","localhost"].includes(u.hostname)||!u.port)process.exit(1)}catch{process.exit(1)}})'; then
      printf '%s' "$CONVEX_URL" | mise set --file "$LOCAL_CONFIG" --stdin EXPO_PUBLIC_CONVEX_URL >/dev/null || { STATUS=1; CLEAN_STATE=0; }
    else
      echo 'Cannot restore the mobile client without a loopback Convex URL; route ledger retained.' >&2
      STATUS=1
      CLEAN_STATE=0
    fi
  else
    echo 'Cannot restore the mobile client without local Convex configuration in mise.local.toml; route ledger retained.' >&2
    STATUS=1
    CLEAN_STATE=0
  fi
fi
printf '%s' localhost | mise set --file "$LOCAL_CONFIG" --stdin RECOVERY_EXPO_MODE >/dev/null || { STATUS=1; CLEAN_STATE=0; }
printf '%s' localhost | mise set --file "$LOCAL_CONFIG" --stdin RECOVERY_EXPO_HOSTNAME >/dev/null || { STATUS=1; CLEAN_STATE=0; }
if [ -d "$STATE_DIR" ] && [ "$CLEAN_STATE" -eq 1 ]; then rm -rf "$STATE_DIR"; fi
exit "$STATUS"
