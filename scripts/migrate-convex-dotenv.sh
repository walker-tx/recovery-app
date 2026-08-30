#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
FILE=$ROOT/packages/backend/.env.local
[ -e "$FILE" ] || exit 0
"$ROOT/scripts/check-no-dotenv.sh" packages/backend/.env.local
[ -f "$FILE" ] && [ ! -L "$FILE" ] || { echo 'Convex dotenv migration requires a regular, non-symlink file.' >&2; exit 1; }
if grep -Ev '^$|^# Deployment used by `npx convex dev`$|^(CONVEX_DEPLOYMENT|CONVEX_URL|CONVEX_SITE_URL)=' "$FILE" >/dev/null; then
  echo 'Convex dotenv migration contains unsupported content.' >&2
  exit 1
fi
for key in CONVEX_DEPLOYMENT CONVEX_URL CONVEX_SITE_URL; do
  [ "$(grep -c "^$key=" "$FILE")" -eq 1 ] || { echo "Convex dotenv migration requires exactly one $key." >&2; exit 1; }
done
read_value() { sed -n "s/^$1=//p" "$FILE" | sed 's/[[:space:]]#.*$//'; }
deployment=$(read_value CONVEX_DEPLOYMENT)
printf %s "$deployment" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{if(!/^(?:local|anonymous):[A-Za-z0-9._-]+$/.test(s))process.exit(1)})' || { echo 'Convex dotenv migration accepts only local deployments.' >&2; exit 1; }
for key in CONVEX_URL CONVEX_SITE_URL; do
  value=$(read_value "$key")
  printf %s "$value" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const u=new URL(s);if(u.protocol!=="http:"||u.username||u.password||!["127.0.0.1","localhost"].includes(u.hostname)||!u.port||u.pathname!=="/"||u.search||u.hash)process.exit(1)}catch{process.exit(1)}})' || { echo "Convex dotenv migration requires a loopback $key." >&2; exit 1; }
done
for key in CONVEX_DEPLOYMENT CONVEX_URL CONVEX_SITE_URL; do
  value=$(read_value "$key")
  printf %s "$value" | mise set --file "$ROOT/mise.local.toml" --stdin "$key" >/dev/null
done
rm "$FILE"
