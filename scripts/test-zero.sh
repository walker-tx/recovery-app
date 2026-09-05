#!/usr/bin/env bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
ZERO=$ROOT/scripts/zero.sh
DOTENV_CHECK=$ROOT/scripts/check-no-dotenv.sh
DOTENV_MIGRATE=$ROOT/scripts/migrate-convex-dotenv.sh
[ -f "$ZERO" ] || { echo "FAIL: scripts/zero.sh does not exist" >&2; exit 1; }
fail() { echo "FAIL: $*" >&2; exit 1; }

MISE=$ROOT/mise.toml
PITCHFORK=$ROOT/pitchfork.toml
PACKAGE=$ROOT/package.json
README=$ROOT/README.md
MOBILE=$ROOT/scripts/mobile.sh

assert_fixed() { grep -F -- "$2" "$1" >/dev/null || fail "$1 is missing: $2"; }
refute_fixed() { ! grep -F -- "$2" "$1" >/dev/null || fail "$1 contains forbidden text: $2"; }
dotenv_files=$(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/node_modules" -prune -o -type f -name '.env*' -print)
[ -z "$dotenv_files" ] || fail "dotenv files are forbidden: $dotenv_files"
section() { awk -v header="$2" '$0 == header { found=1; next } found && /^\[/ { exit } found { print }' "$1"; }
assert_section() { section "$1" "$2" | grep -F -- "$3" >/dev/null || fail "$1 $2 is missing: $3"; }
refute_section() { ! section "$1" "$2" | grep -F -- "$3" >/dev/null || fail "$1 $2 contains forbidden text: $3"; }

[ -f "$PITCHFORK" ] || fail 'pitchfork.toml does not exist'
assert_fixed "$MISE" 'pitchfork = "2.22.0"'
assert_fixed "$MISE" 'mailpit = "1.31.0"'
for task in zero dev stop status logs bootstrap-test install check doctor; do
  assert_fixed "$MISE" "[tasks.$task]"
done
assert_fixed "$MISE" '[tasks."zero:tailnet"]'
assert_fixed "$PITCHFORK" 'namespace = "recovery"'
for daemon in mailpit backend mobile; do
  assert_fixed "$PITCHFORK" "[daemons.$daemon]"
done
[ "$(grep -c '^\[daemons\.' "$PITCHFORK")" -eq 3 ] || fail 'pitchfork.toml must declare exactly three daemons'
assert_section "$PITCHFORK" '[daemons.mailpit]' 'run = "mise exec -- mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025"'
assert_section "$PITCHFORK" '[daemons.mailpit]' 'ready_http = "http://127.0.0.1:8025/api/v1/info"'
refute_section "$PITCHFORK" '[daemons.mailpit]' '--database'
refute_section "$PITCHFORK" '[daemons.mailpit]' ' -d'
assert_section "$PITCHFORK" '[daemons.backend]' 'run = "env -u CONVEX_DEPLOYMENT -u CONVEX_DEPLOY_KEY -u CONVEX_AGENT_MODE -u WORKOS_API_KEY -u WORKOS_CLIENT_ID -u WORKOS_EMAIL_HMAC_KEY -u WORKOS_INTENT_ENCRYPTION_KEY -u WORKOS_MODE -u AUTH_EMAIL_DELIVERY_URL mise exec -- pnpm --filter @recovery/backend dev"'
assert_section "$PITCHFORK" '[daemons.backend]' 'depends = ["mailpit"]'
assert_section "$PITCHFORK" '[daemons.backend]' 'ready_port = 3210'
assert_section "$PITCHFORK" '[daemons.mobile]' 'run = "env -u EXPO_PUBLIC_CONVEX_URL -u REACT_NATIVE_PACKAGER_HOSTNAME -u RECOVERY_EXPO_MODE -u RECOVERY_EXPO_HOSTNAME mise exec -- ./scripts/mobile.sh"'
assert_section "$PITCHFORK" '[daemons.mobile]' 'depends = ["backend"]'
[ "$(grep -c '^\[groups\.' "$PITCHFORK")" -eq 1 ] || fail 'pitchfork.toml must declare exactly one group'
assert_section "$PITCHFORK" '[groups.recovery]' 'daemons = ["mailpit", "backend", "mobile"]'
assert_section "$MISE" '[tasks.zero]' 'run = "./scripts/zero.sh"'
assert_section "$MISE" '[tasks.dev]' 'run = "pitchfork start --group recovery"'
assert_section "$MISE" '[tasks.stop]' 'run = "./scripts/stop.sh"'
assert_section "$MISE" '[tasks.status]' 'run = "./scripts/status.sh"'
assert_section "$MISE" '[tasks.logs]' 'run = "pitchfork logs mailpit backend mobile"'
assert_section "$MISE" '[tasks.bootstrap-test]' 'run = "./scripts/test-zero.sh && ./scripts/test-zero-tailnet.sh"'
refute_fixed "$PITCHFORK" '--web'
node -e 'const p=require(process.argv[1]); if ("setup:auth" in p.scripts) process.exit(1)' "$PACKAGE" || fail 'stale setup:auth script remains'

for text in 'mise install' 'mise run zero' 'mise run dev' 'mise run status' 'mise run logs' 'mise run stop' 'http://127.0.0.1:8025' 'local Convex' 'WorkOS staging' 'kit tui --root .' 'native mobile only' 'iOS Simulator' 'separate explicit native networking setup' 'not configured by zero' 'shows recent logs' 'staging-only and still calls WorkOS staging' 'only local delivery of Recovery verification and password-reset email'; do
  assert_fixed "$README" "$text"
done
for text in 'walker@air' 'ssh -L' 'ssh -R' 'expo start --web' 'setup:auth' 'follows their combined logs' 'use the iOS or Android Expo client' 'Open it with the iOS or Android Expo client'; do
  refute_fixed "$README" "$text"
done

TMP=$(mktemp -d "${TMPDIR:-/tmp}/recovery-zero-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

daemon_fixture=$TMP/daemon-env
mkdir -p "$daemon_fixture/fake-bin" "$daemon_fixture/local-env" "$daemon_fixture/packages/backend" "$daemon_fixture/scripts"
cp "$MOBILE" "$daemon_fixture/scripts/mobile.sh"
for key in CONVEX_DEPLOYMENT CONVEX_URL CONVEX_SITE_URL WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY WORKOS_MODE AUTH_EMAIL_DELIVERY_URL EXPO_PUBLIC_CONVEX_URL; do
  printf 'checkout-%s' "$key" > "$daemon_fixture/local-env/$key"
done
cat > "$daemon_fixture/fake-bin/mise" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
[ "$1 $2" = 'exec --' ] || exit 64
shift 2
case " $* " in
  *' @recovery/backend '*) keys='CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY WORKOS_MODE AUTH_EMAIL_DELIVERY_URL' ;;
  *' ./scripts/mobile.sh '*) keys='EXPO_PUBLIC_CONVEX_URL REACT_NATIVE_PACKAGER_HOSTNAME RECOVERY_EXPO_MODE RECOVERY_EXPO_HOSTNAME' ;;
  *) exit 64 ;;
esac
for key in $keys; do [ -z "${!key+x}" ] || exit 65; done
for file in "$DAEMON_TEST_ROOT"/local-env/*; do export "$(basename "$file")=$(cat "$file")"; done
exec "$@"
FAKE
cat > "$daemon_fixture/fake-bin/pnpm" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *' @recovery/backend '*)
    [ -z "${CONVEX_DEPLOY_KEY+x}" ] || exit 66
    [ -z "${CONVEX_AGENT_MODE+x}" ] || exit 68
    keys='CONVEX_DEPLOYMENT CONVEX_URL CONVEX_SITE_URL WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY WORKOS_MODE AUTH_EMAIL_DELIVERY_URL'
    ;;
  *' @recovery/mobile '*) keys=EXPO_PUBLIC_CONVEX_URL ;;
  *) exit 64 ;;
esac
for key in $keys; do [ "${!key:-}" = "checkout-$key" ] || exit 67; done
FAKE
chmod +x "$daemon_fixture/fake-bin/"*
daemon_run() { section "$PITCHFORK" "[daemons.$1]" | sed -n 's/^run = "\(.*\)"$/\1/p'; }
ambient='CONVEX_DEPLOYMENT=prod:ambient CONVEX_DEPLOY_KEY=ambient-key WORKOS_API_KEY=ambient-api WORKOS_CLIENT_ID=ambient-client WORKOS_EMAIL_HMAC_KEY=ambient-hmac WORKOS_INTENT_ENCRYPTION_KEY=ambient-encryption WORKOS_MODE=ambient-mode AUTH_EMAIL_DELIVERY_URL=http://ambient.invalid EXPO_PUBLIC_CONVEX_URL=https://ambient.invalid REACT_NATIVE_PACKAGER_HOSTNAME=ambient-host RECOVERY_EXPO_MODE=lan RECOVERY_EXPO_HOSTNAME=ambient-host'
for daemon in backend mobile; do
  (cd "$daemon_fixture" && eval "env $ambient DAEMON_TEST_ROOT=\"$daemon_fixture\" PATH=\"$daemon_fixture/fake-bin:$PATH\" $(daemon_run "$daemon")") || fail "$daemon daemon inherited managed ambient environment"
done
assert_log() { grep -Fx "$2" "$1/state/commands" >/dev/null || fail "missing command: $2"; }
refute_log() { ! grep -Fx "$2" "$1/state/commands" >/dev/null || fail "unexpected command: $2"; }
put_env() {
  printf '%s' "$3" > "$1/state/env/$2"
  printf '%s = \"set\"\n' "$2" >> "$1/mise.local.toml"
}

new_fixture() {
  fixture=$TMP/$1
  mkdir -p "$fixture/scripts" "$fixture/packages/backend/convex" "$fixture/fake-bin" "$fixture/state/env"
  cp "$ZERO" "$DOTENV_CHECK" "$DOTENV_MIGRATE" "$fixture/scripts/"
  [ ! -f "$ROOT/scripts/convex-metadata.cjs" ] || cp "$ROOT/scripts/convex-metadata.cjs" "$fixture/scripts/"
  : > "$fixture/mise.toml"
  : > "$fixture/state/commands"

  cat > "$fixture/fake-bin/mise" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
log=$ZERO_TEST_STATE/commands
case ${1:-} in
  exec)
    shift
    [ "${1:-}" = -- ] && shift
    for file in "$ZERO_TEST_STATE"/env/*; do
      [ -f "$file" ] || continue
      key=$(basename "$file")
      [ -n "${!key+x}" ] || export "$key=$(cat "$file")"
    done
    printf 'mise exec %s\n' "$(basename "$1")" >> "$log"
    exec "$@"
    ;;
  set)
    shift
    mode=plain
    file=mise.local.toml
    while [ $# -gt 1 ]; do
      case $1 in
        --file) file=$2; shift 2 ;;
        --prompt) mode=prompt; shift ;;
        --stdin) mode=stdin; shift ;;
        *) break ;;
      esac
    done
    key=$1
    case $mode in
      prompt) value=fixture-prompt; printf 'mise set prompt %s\n' "$key" >> "$log" ;;
      stdin) value=$(cat); printf 'mise set stdin %s\n' "$key" >> "$log" ;;
      *) exit 64 ;;
    esac
    if [ "$key" = CONVEX_URL ]; then
      case ${ZERO_TEST_MIGRATION_WRITE:-} in
        append) printf '%s\n' 'UNSUPPORTED_SECRET=synthetic' >> packages/backend/.env.local ;;
        replace) printf '%s\n' 'UNSUPPORTED_SECRET=synthetic' > packages/backend/replacement; mv packages/backend/replacement packages/backend/.env.local ;;
        fail-second) exit 70 ;;
      esac
    fi
    [ -n "$value" ] || exit 65
    printf '%s' "$value" > "$ZERO_TEST_STATE/env/$key"
    printf '%s = \"set\"\n' "$key" >> "$file"
    ;;
  *) exit 64 ;;
esac
FAKE

  cat > "$fixture/fake-bin/pnpm" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
log=$ZERO_TEST_STATE/commands
printf 'pnpm %s\n' "$*" >> "$log"
if [ "${1:-}" = install ]; then
  [ "$*" = 'install --frozen-lockfile' ] || exit 64
  printf '%s\n' install-chatter install-chatter install-chatter install-chatter
  exit
fi
[ "${1:-}" = --filter ] && [ "${2:-}" = @recovery/backend ] && [ "${3:-}" = exec ] && [ "${4:-}" = convex ] || exit 64
shift 4
case "${1:-} ${2:-}" in
  'dev --configure')
    [ "$*" = 'dev --configure new --dev-deployment local --once --tail-logs disable' ] || exit 64
    printf '%s\n' 'CONVEX_DEPLOYMENT=local:fixture-local' 'CONVEX_URL=http://127.0.0.1:3210' 'CONVEX_SITE_URL=http://127.0.0.1:3211' > packages/backend/.env.local
    ;;
  'dev --once')
    [ "$*" = 'dev --once --tail-logs disable' ] || exit 64
    [ "${ZERO_TEST_FAIL_DEV:-0}" = 0 ] || exit 70
    ;;
  'env set')
    [ "${CONVEX_DEPLOYMENT:-}" = "$(cat "$ZERO_TEST_STATE/env/CONVEX_DEPLOYMENT")" ] || exit 69
    shift 2
    key=${1:-}
    [ -n "$key" ] && [ $# -eq 1 ] || exit 64
    value=$(cat)
    if [ "$key" = CONVEX_URL ]; then
      case ${ZERO_TEST_MIGRATION_WRITE:-} in
        append) printf '%s\n' 'UNSUPPORTED_SECRET=synthetic' >> packages/backend/.env.local ;;
        replace) printf '%s\n' 'UNSUPPORTED_SECRET=synthetic' > packages/backend/replacement; mv packages/backend/replacement packages/backend/.env.local ;;
        fail-second) exit 70 ;;
      esac
    fi
    [ -n "$value" ] || exit 65
    [ -f "$ZERO_TEST_STATE/env/$key" ] && [ "$value" = "$(cat "$ZERO_TEST_STATE/env/$key")" ] || exit 66
    printf 'convex env set-local-stdin %s\n' "$key" >> "$log"
    [ "${ZERO_TEST_FAIL_ENV:-}" != "$key" ] || exit 71
    ;;
  *) exit 64 ;;
esac
FAKE

  cat > "$fixture/fake-bin/pitchfork" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case ${1:-} in
  start)
    case "$*" in
      'start mailpit backend')
        if [ ! -f packages/backend/.env.local ] && [ ! -f "$ZERO_TEST_STATE/env/CONVEX_DEPLOYMENT" ]; then
          case ${ZERO_TEST_METADATA:-canonical} in
            timeout) printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' > packages/backend/.env.local ;;
            delayed|partial)
              (sleep 1
               printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' > packages/backend/.env.local
               sleep 1
               printf '%s\n' 'VITE_CONVEX_URL=http://127.0.0.1:3210' 'VITE_CONVEX_SITE_URL=http://127.0.0.1:3211' >> packages/backend/.env.local) >/dev/null 2>&1 &
              if [ "$ZERO_TEST_METADATA" = partial ]; then printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' > packages/backend/.env.local; fi ;;
            *) printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' 'CONVEX_URL=http://127.0.0.1:3210' 'CONVEX_SITE_URL=http://127.0.0.1:3211' > packages/backend/.env.local ;;
          esac
        fi
        touch "$ZERO_TEST_STATE/started"
        ;;
      'start mobile') ;;
      *) exit 64 ;;
    esac
    echo "pitchfork $*" >> "$ZERO_TEST_STATE/commands"
    printf '%s\n' start-chatter start-chatter start-chatter start-chatter
    ;;
  status)
    case "$*" in
      'status mailpit'|'status backend'|'status mobile') echo "pitchfork $*" >> "$ZERO_TEST_STATE/commands"; if [ -f "$ZERO_TEST_STATE/started" ] || [ "${ZERO_TEST_EXISTING:-0}" = 1 ]; then echo "${2}: running"; else echo "${2}: stopped"; fi ;;
      *) exit 64 ;;
    esac
    ;;
  stop) echo "pitchfork $*" >> "$ZERO_TEST_STATE/commands" ;;
  mcp) echo 'pitchfork mcp' >> "$ZERO_TEST_STATE/commands" ;;
  *) exit 64 ;;
esac
FAKE
  chmod +x "$fixture/fake-bin/"*
  echo "$fixture"
}

run_zero() {
  fixture=$1
  shift
  (cd "$fixture" && env -u CONVEX_DEPLOYMENT -u CONVEX_DEPLOY_KEY \
    -u WORKOS_API_KEY -u WORKOS_CLIENT_ID -u WORKOS_EMAIL_HMAC_KEY -u WORKOS_INTENT_ENCRYPTION_KEY \
    -u WORKOS_MODE -u AUTH_EMAIL_DELIVERY_URL -u EXPO_PUBLIC_CONVEX_URL \
    ZERO_TEST_STATE="$fixture/state" PATH="$fixture/fake-bin:$PATH" "$@" bash scripts/zero.sh)
}

# Simulated CLI-generated metadata only.
for mode in append replace fail-second; do
  f=$(new_fixture "migration-write-$mode")
  printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' 'CONVEX_URL=http://127.0.0.1:3210' 'CONVEX_SITE_URL=http://127.0.0.1:3211' > "$f/packages/backend/.env.local"
  cp "$f/packages/backend/.env.local" "$f/state/original"
  if (cd "$f" && ZERO_TEST_STATE="$f/state" ZERO_TEST_MIGRATION_WRITE="$mode" PATH="$f/fake-bin:$PATH" sh scripts/migrate-convex-dotenv.sh) >"$f/state/output" 2>&1; then
    fail "$mode migration unexpectedly succeeded"
  fi
  [ -f "$f/packages/backend/.env.local" ] || fail "$mode metadata deleted"
  if [ "$mode" = fail-second ]; then
    cmp -s "$f/state/original" "$f/packages/backend/.env.local" || fail 'failed write changed metadata'
    refute_log "$f" 'mise set stdin CONVEX_SITE_URL'
  else
    grep -Fx 'UNSUPPORTED_SECRET=synthetic' "$f/packages/backend/.env.local" >/dev/null || fail "$mode changed metadata lost"
  fi
  ! grep -F 'synthetic' "$f/state/output" >/dev/null || fail "$mode leaked metadata"
done
for mode in delayed partial; do
  f=$(new_fixture "$mode")
  run_zero "$f" ZERO_TEST_METADATA="$mode" >/dev/null
  [ ! -e "$f/packages/backend/.env.local" ] || fail "$mode metadata retained"
  assert_log "$f" 'mise set stdin CONVEX_URL'
  refute_log "$f" 'mise set stdin VITE_CONVEX_URL'
done
for mode in duplicate mixed duplicate-site mixed-site duplicate-deployment unsupported remote; do
  f=$(new_fixture "invalid-$mode")
  printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' 'VITE_CONVEX_URL=http://127.0.0.1:3210' 'VITE_CONVEX_SITE_URL=http://127.0.0.1:3211' > "$f/packages/backend/.env.local"
  case $mode in
    duplicate) line='VITE_CONVEX_URL=http://127.0.0.1:3210' ;;
    mixed) line='CONVEX_URL=http://127.0.0.1:3210' ;;
    duplicate-site) line='VITE_CONVEX_SITE_URL=http://127.0.0.1:3211' ;;
    mixed-site) line='CONVEX_SITE_URL=http://127.0.0.1:3211' ;;
    duplicate-deployment) line='CONVEX_DEPLOYMENT=anonymous:fixture-local' ;;
    unsupported) line='UNSUPPORTED_SECRET=synthetic-not-a-real-secret' ;;
    remote) sed -i.bak 's@127.0.0.1:3211@remote.invalid:3211@' "$f/packages/backend/.env.local"; rm "$f/packages/backend/.env.local.bak"; line='' ;;
  esac
  printf '%s\n' "$line" >> "$f/packages/backend/.env.local"
  if run_zero "$f" >"$f/state/output" 2>&1; then fail "$mode accepted"; fi
  [ ! -s "$f/state/commands" ] || fail "$mode wrote configuration"
  [ -f "$f/packages/backend/.env.local" ] || fail "$mode removed diagnostics"
  ! grep -q synthetic-not-a-real-secret "$f/state/output" || fail 'secret fixture logged'
done
for existing_service in 0 1; do
  f=$(new_fixture "timeout-$existing_service")
  if run_zero "$f" ZERO_TEST_METADATA=timeout ZERO_TEST_EXISTING="$existing_service" RECOVERY_METADATA_TIMEOUT_SECONDS=1 >/dev/null 2>&1; then fail 'timeout accepted'; fi
  [ -f "$f/packages/backend/.env.local" ] || fail 'timeout removed diagnostics'
  if [ "$existing_service" = 0 ]; then assert_log "$f" 'pitchfork stop backend'; assert_log "$f" 'pitchfork stop mailpit'; else refute_log "$f" 'pitchfork stop backend'; refute_log "$f" 'pitchfork stop mailpit'; fi
done

root_fixture=$(new_fixture root)
impostor=$TMP/impostor
mkdir -p "$impostor/packages/backend/convex"
: > "$impostor/mise.toml"
if (cd "$impostor" && env -u CONVEX_DEPLOYMENT -u CONVEX_DEPLOY_KEY ZERO_TEST_STATE="$root_fixture/state" PATH="$root_fixture/fake-bin:$PATH" bash "$root_fixture/scripts/zero.sh" >/dev/null 2>&1); then
  fail 'bootstrap trusted repository markers outside its checkout'
fi
[ ! -s "$root_fixture/state/commands" ] || fail 'root failure invoked tools'

first=$(new_fixture first)
put_env "$first" WORKOS_API_KEY preserved-dashboard-value
output=$(run_zero "$first")
assert_log "$first" 'pnpm install --frozen-lockfile'
refute_log "$first" 'mise set prompt WORKOS_API_KEY'
assert_log "$first" 'mise set prompt WORKOS_CLIENT_ID'
assert_log "$first" 'mise set stdin WORKOS_EMAIL_HMAC_KEY'
assert_log "$first" 'mise set stdin WORKOS_INTENT_ENCRYPTION_KEY'
[ ! -e "$first/fake-bin/convex" ] || fail 'fixture masks a global convex executable'
refute_log "$first" 'pnpm --filter @recovery/backend exec convex dev --configure new --dev-deployment local --once --tail-logs disable'
refute_log "$first" 'pnpm --filter @recovery/backend exec convex dev --once --tail-logs disable'
for key in WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY WORKOS_MODE AUTH_EMAIL_DELIVERY_URL; do
  assert_log "$first" "convex env set-local-stdin $key"
done
assert_log "$first" 'mise set stdin EXPO_PUBLIC_CONVEX_URL'
assert_log "$first" 'pitchfork start mailpit backend'
assert_log "$first" 'pitchfork start mobile'
for daemon in mailpit backend mobile; do
  assert_log "$first" "pitchfork status $daemon"
done
[ "$(cat "$first/state/env/WORKOS_API_KEY")" = preserved-dashboard-value ] || fail 'existing value changed'
for key in WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY; do
  node -e 'const fs=require("fs");const value=fs.readFileSync(process.argv[1],"utf8");const decoded=Buffer.from(value,"base64");if(decoded.length!==32||decoded.toString("base64")!==value)process.exit(1)' "$first/state/env/$key" || fail "$key is not a canonical base64-encoded 32-byte key"
done
[ "$(stat -f '%Lp' "$first/mise.local.toml")" = 600 ] || fail 'mise.local.toml mode is not 0600'
[ "$(stat -f '%Lp' "$first/.mcp.json")" = 600 ] || fail 'MCP config mode is not 0600'
node -e 'const fs=require("fs"); const [file,cwd]=process.argv.slice(1); const j=JSON.parse(fs.readFileSync(file)); const s=j.mcpServers.pitchfork; if(s.command!=="mise"||JSON.stringify(s.args)!==JSON.stringify(["exec","--","pitchfork","mcp"])||s.cwd!==cwd) process.exit(1)' "$first/.mcp.json" "$(cd "$first" && pwd -P)" || fail 'invalid MCP config'
[ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" -le 6 ] || fail 'bootstrap output is not concise'
printf '%s' "$output" | grep -F 'http://127.0.0.1:8025' >/dev/null || fail 'missing Mailpit URL'
printf '%s' "$output" | grep -F 'http://127.0.0.1:8081' >/dev/null || fail 'missing Expo URL'
printf '%s' "$output" | grep -F 'preserved-dashboard-value' >/dev/null && fail 'secret appeared in output'
grep -F 'preserved-dashboard-value' "$first/state/commands" >/dev/null && fail 'secret appeared in command log'

ambient=$(new_fixture ambient)
run_zero "$ambient" \
  WORKOS_API_KEY=ambient-api WORKOS_CLIENT_ID=ambient-client \
  WORKOS_EMAIL_HMAC_KEY=ambient-hmac WORKOS_INTENT_ENCRYPTION_KEY=ambient-encryption \
  WORKOS_MODE=ambient-mode AUTH_EMAIL_DELIVERY_URL=http://ambient.invalid >/dev/null
for key in WORKOS_API_KEY WORKOS_CLIENT_ID; do
  assert_log "$ambient" "mise set prompt $key"
done
for key in WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY WORKOS_MODE AUTH_EMAIL_DELIVERY_URL; do
  assert_log "$ambient" "mise set stdin $key"
done
for key in WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY WORKOS_MODE AUTH_EMAIL_DELIVERY_URL; do
  grep -Eq "^[[:space:]]*$key[[:space:]]*=" "$ambient/mise.local.toml" || fail "ambient value prevented local $key"
  assert_log "$ambient" "convex env set-local-stdin $key"
done

cloud_migration=$(new_fixture cloud-migration)
printf '%s\n' 'CONVEX_DEPLOYMENT=dev:cloud' 'CONVEX_URL=https://cloud.invalid' 'CONVEX_SITE_URL=https://cloud.invalid' > "$cloud_migration/packages/backend/.env.local"
if run_zero "$cloud_migration" >/dev/null 2>&1; then fail 'cloud Convex dotenv migration was accepted'; fi
refute_log "$cloud_migration" 'pitchfork start mailpit backend'

symlink_migration=$(new_fixture symlink-migration)
printf '%s\n' '# Deployment used by `npx convex dev`' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' '' 'CONVEX_URL=http://127.0.0.1:3210' '' 'CONVEX_SITE_URL=http://127.0.0.1:3211' > "$symlink_migration/state/generated"
ln -s "$symlink_migration/state/generated" "$symlink_migration/packages/backend/.env.local"
if run_zero "$symlink_migration" >/dev/null 2>&1; then fail 'symlinked Convex dotenv migration was accepted'; fi
refute_log "$symlink_migration" 'pitchfork start mailpit backend'

migration=$(new_fixture migration)
for key in WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY; do put_env "$migration" "$key" fixture; done
put_env "$migration" WORKOS_MODE staging
put_env "$migration" AUTH_EMAIL_DELIVERY_URL http://127.0.0.1:8025/api/v1/send
printf '%s\n' '# Deployment used by `npx convex dev`' 'CONVEX_DEPLOYMENT=anonymous:migrated-local' '' 'CONVEX_URL=http://127.0.0.1:3210' '' 'CONVEX_SITE_URL=http://127.0.0.1:3211' > "$migration/packages/backend/.env.local"
run_zero "$migration" >/dev/null
[ ! -e "$migration/packages/backend/.env.local" ] || fail 'generated Convex dotenv file was not removed'
[ "$(cat "$migration/state/env/CONVEX_DEPLOYMENT")" = anonymous:migrated-local ] || fail 'Convex deployment was not migrated to Mise'

existing=$(new_fixture existing)
for key in WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY WORKOS_MODE AUTH_EMAIL_DELIVERY_URL; do put_env "$existing" "$key" existing-fixture-value; done
put_env "$existing" WORKOS_MODE staging
put_env "$existing" AUTH_EMAIL_DELIVERY_URL http://127.0.0.1:8025/api/v1/send
put_env "$existing" CONVEX_DEPLOYMENT anonymous:fixture-local
put_env "$existing" CONVEX_URL http://localhost:3210
put_env "$existing" CONVEX_SITE_URL http://localhost:3211
run_zero "$existing" >/dev/null
refute_log "$existing" 'pnpm --filter @recovery/backend exec convex dev --configure new --dev-deployment local --once --tail-logs disable'
refute_log "$existing" 'pnpm --filter @recovery/backend exec convex dev --once --tail-logs disable'
for key in WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY; do
  refute_log "$existing" "mise set prompt $key"
  refute_log "$existing" "mise set stdin $key"
done

dotenv=$(new_fixture dotenv)
printf '%s' 'forbidden' > "$dotenv/.env"
if run_zero "$dotenv" >/dev/null 2>&1; then fail 'dotenv file was accepted'; fi
refute_log "$dotenv" 'pitchfork start mailpit backend'

cloud=$(new_fixture cloud)
if run_zero "$cloud" CONVEX_DEPLOYMENT=prod:fixture-cloud >/dev/null 2>&1; then fail 'production deployment was accepted'; fi
refute_log "$cloud" 'pitchfork start mailpit backend'

deploy_key=$(new_fixture deploy-key)
if run_zero "$deploy_key" CONVEX_DEPLOY_KEY=fixture-cloud-key >/dev/null 2>&1; then fail 'cloud deployment key was accepted'; fi
refute_log "$deploy_key" 'pitchfork start mailpit backend'

malicious_url=$(new_fixture malicious-url)
for key in WORKOS_API_KEY WORKOS_CLIENT_ID WORKOS_EMAIL_HMAC_KEY WORKOS_INTENT_ENCRYPTION_KEY; do put_env "$malicious_url" "$key" fixture; done
put_env "$malicious_url" WORKOS_MODE staging
put_env "$malicious_url" AUTH_EMAIL_DELIVERY_URL http://127.0.0.1:8025/api/v1/send
put_env "$malicious_url" CONVEX_DEPLOYMENT local:fixture-local
put_env "$malicious_url" CONVEX_URL http://localhost:3210@evil.example
put_env "$malicious_url" CONVEX_SITE_URL http://localhost:3211
if run_zero "$malicious_url" >/dev/null 2>&1; then fail 'credential-shaped remote Convex URL was accepted'; fi
refute_log "$malicious_url" 'pitchfork start mobile'

failed=$(new_fixture failed)
put_env "$failed" WORKOS_API_KEY fixture
ZERO_TEST_FAIL_ENV=WORKOS_API_KEY run_zero "$failed" >/dev/null 2>&1 && fail 'failed Convex sync was accepted'
refute_log "$failed" 'pitchfork start --group recovery'

grep -Fx '.mcp.json' "$ROOT/.gitignore" >/dev/null || fail '.mcp.json is not ignored'
echo 'PASS: secure idempotent bootstrap'
