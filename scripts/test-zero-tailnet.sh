#!/usr/bin/env bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
fail() { echo "FAIL: $*" >&2; exit 1; }
for file in scripts/zero-tailnet.sh scripts/stop.sh scripts/status.sh scripts/mobile.sh; do
  [ -x "$ROOT/$file" ] || fail "$file is missing or not executable"
done
grep -F '[tasks."zero:tailnet"]' "$ROOT/mise.toml" >/dev/null || fail 'zero:tailnet task is missing'
grep -F 'run = "./scripts/stop.sh"' "$ROOT/mise.toml" >/dev/null || fail 'stop task does not own tailnet cleanup'
grep -F 'run = "./scripts/status.sh"' "$ROOT/mise.toml" >/dev/null || fail 'status task does not report tailnet state'
grep -F '.recovery-tailnet/' "$ROOT/.gitignore" >/dev/null || fail 'tailnet ledger is not ignored'
grep -F 'mise run zero:tailnet' "$ROOT/README.md" >/dev/null || fail 'README omits zero:tailnet'
grep -F 'mise exec -- ./scripts/mobile.sh' "$ROOT/pitchfork.toml" >/dev/null || fail 'Pitchfork does not use the mobile launcher'
grep -F '.recovery-tailnet' "$ROOT/scripts/zero.sh" >/dev/null || fail 'normal zero does not leave tailnet mode'

TMP=$(mktemp -d "${TMPDIR:-/tmp}/recovery-tailnet-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/scripts" "$TMP/packages/backend" "$TMP/fake-bin" "$TMP/state/env"
cp "$ROOT/scripts/zero-tailnet.sh" "$ROOT/scripts/stop.sh" "$ROOT/scripts/status.sh" "$TMP/scripts/"
printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' 'CONVEX_URL=http://127.0.0.1:3210' > "$TMP/packages/backend/.env.local"
: > "$TMP/mise.local.toml"
: > "$TMP/state/commands"
printf '%s' '{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true}},"Web":{"fixture.tail.test:443":{"Handlers":{"/":{"Proxy":"http://localhost:4000"}}},"fixture.tail.test:8443":{"Handlers":{"/":{"Proxy":"http://localhost:5000"}}}}}' > "$TMP/state/serve.json"

cat > "$TMP/fake-bin/mise" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
echo "mise $*" >> "$TAILNET_TEST_STATE/commands"
case "${1:-} ${2:-}" in
  'run stop') exec "$TAILNET_TEST_ROOT/scripts/stop.sh" ;;
  'run zero') exit 0 ;;
  'set --file')
    [ "${4:-}" = --stdin ] || exit 64
    value=$(cat)
    printf '%s' "$value" > "$TAILNET_TEST_STATE/env/${5:-}"
    ;;
  *) exit 64 ;;
esac
FAKE

cat > "$TMP/fake-bin/pitchfork" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
echo "pitchfork $*" >> "$TAILNET_TEST_STATE/commands"
case "$*" in
  'stop --group recovery'|'stop mobile') ;;
  'status mailpit'|'status backend'|'status mobile') echo "${2}: running" ;;
  'start mobile') [ "${FAIL_PITCHFORK_START:-0}" = 0 ] || exit 70 ;;
  *) exit 64 ;;
esac
FAKE

cat > "$TMP/fake-bin/curl" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
echo "curl $*" >> "$TAILNET_TEST_STATE/commands"
exit 0
FAKE

cat > "$TMP/fake-bin/tailscale" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
echo "tailscale $*" >> "$TAILNET_TEST_STATE/commands"
case "$*" in
  status) exit 0 ;;
  'status --json') printf '%s\n' '{"Self":{"DNSName":"fixture.tail.test."}}' ;;
  'ip -4') echo 100.64.0.2 ;;
  'serve status --json') cat "$TAILNET_TEST_STATE/serve.json" ;;
  'funnel status') exit 0 ;;
  serve\ --bg\ --yes\ --https=8444\ http://127.0.0.1:3210)
    printf '%s' '{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true},"8444":{"HTTPS":true}},"Web":{"fixture.tail.test:443":{"Handlers":{"/":{"Proxy":"http://localhost:4000"}}},"fixture.tail.test:8443":{"Handlers":{"/":{"Proxy":"http://localhost:5000"}}},"fixture.tail.test:8444":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3210"}}}}}' > "$TAILNET_TEST_STATE/serve.json"
    ;;
  serve\ --bg\ --yes\ --tcp=8081\ tcp://localhost:8081)
    [ "${FAIL_TCP_SERVE:-0}" = 0 ] || exit 72
    node -e 'const fs=require("fs"),f=process.argv[1],j=require(f);j.TCP[8081]={TCPForward:"localhost:8081"};fs.writeFileSync(f,JSON.stringify(j))' "$TAILNET_TEST_STATE/serve.json"
    ;;
  'serve --https=8444 --set-path=/ off')
    node -e 'const fs=require("fs"),f=process.argv[1],j=require(f),k="fixture.tail.test:8444";delete j.Web[k].Handlers["/"];if(Object.keys(j.Web[k].Handlers).length===0){delete j.Web[k];delete j.TCP[8444]}fs.writeFileSync(f,JSON.stringify(j))' "$TAILNET_TEST_STATE/serve.json"
    ;;
  'serve --tcp=8081 off')
    node -e 'const fs=require("fs"),f=process.argv[1],j=require(f);delete j.TCP[8081];fs.writeFileSync(f,JSON.stringify(j))' "$TAILNET_TEST_STATE/serve.json"
    ;;
  *) exit 64 ;;
esac
FAKE
chmod +x "$TMP/fake-bin/"*

run_env=(env HOME="$TMP/home" TAILNET_TEST_ROOT="$TMP" TAILNET_TEST_STATE="$TMP/state" PATH="$TMP/fake-bin:$PATH")
(cd "$TMP" && "${run_env[@]}" ./scripts/zero-tailnet.sh >/dev/null)
[ "$(cat "$TMP/state/env/RECOVERY_EXPO_MODE")" = tailnet ] || fail 'Expo tailnet mode was not selected'
[ "$(cat "$TMP/state/env/RECOVERY_EXPO_HOSTNAME")" = 100.64.0.2 ] || fail 'tailnet IP was not configured'
[ "$(cat "$TMP/state/env/EXPO_PUBLIC_CONVEX_URL")" = https://fixture.tail.test:8444 ] || fail 'tailnet Convex URL was not configured'
grep -Fx '8444	http://127.0.0.1:3210' "$TMP/.recovery-tailnet/added-routes.tsv" >/dev/null || fail 'owned Serve route was not ledgered'
grep -Fx '8081	localhost:8081' "$TMP/.recovery-tailnet/tcp-route.tsv" >/dev/null || fail 'Metro TCP route was not ledgered'
grep -Fx 'tailscale serve --bg --yes --tcp=8081 tcp://localhost:8081' "$TMP/state/commands" >/dev/null || fail 'Metro TCP route was not started'
(cd "$TMP" && "${run_env[@]}" ./scripts/status.sh) | grep -F 'Tailnet: active' >/dev/null || fail 'status omitted active tailnet state'
node -e 'const fs=require("fs"),f=process.argv[1],j=require(f);j.TCP[8081].TCPForward="localhost:9999";fs.writeFileSync(f,JSON.stringify(j))' "$TMP/state/serve.json"
if stale_output=$(cd "$TMP" && "${run_env[@]}" ./scripts/status.sh 2>/dev/null); then fail 'status accepted a changed Metro route'; fi
printf '%s' "$stale_output" | grep -F 'Tailnet: stale' >/dev/null || fail 'status omitted stale tailnet state'
node -e 'const fs=require("fs"),f=process.argv[1],j=require(f);j.TCP[8081].TCPForward="localhost:8081";fs.writeFileSync(f,JSON.stringify(j))' "$TMP/state/serve.json"
! grep -F 'tailscale funnel' "$TMP/state/commands" >/dev/null || fail 'tailnet workflow invoked Funnel'
[ ! -e "$TMP/.recovery-tailnet/serve-before.json" ] || fail 'ledger retained unrelated Serve configuration'
[ ! -e "$TMP/.recovery-tailnet/funnel-before.txt" ] || fail 'ledger retained unrelated Funnel configuration'
grep -Fx 'pitchfork stop mobile' "$TMP/state/commands" >/dev/null || fail 'local Metro was not stopped'
grep -Fx 'pitchfork start mobile' "$TMP/state/commands" >/dev/null || fail 'tailnet Metro was not started'
start_line=$(grep -nFx 'pitchfork start mobile' "$TMP/state/commands" | tail -1 | cut -d: -f1)
tcp_line=$(grep -nFx 'tailscale serve --bg --yes --tcp=8081 tcp://localhost:8081' "$TMP/state/commands" | tail -1 | cut -d: -f1)
[ "$start_line" -lt "$tcp_line" ] || fail 'Metro TCP proxy started before Metro released and rebound port 8081'

node -e 'const fs=require("fs"),f=process.argv[1],j=require(f);j.Web["fixture.tail.test:8444"].Handlers["/admin"]={Proxy:"http://localhost:6000"};fs.writeFileSync(f,JSON.stringify(j))' "$TMP/state/serve.json"
(cd "$TMP" && "${run_env[@]}" ./scripts/stop.sh >/dev/null)
[ ! -e "$TMP/.recovery-tailnet" ] || fail 'tailnet ledger remains after cleanup'
(cd "$TMP" && "${run_env[@]}" ./scripts/status.sh) | grep -F 'Tailnet: inactive' >/dev/null || fail 'status omitted inactive tailnet state'
[ "$(cat "$TMP/state/env/RECOVERY_EXPO_MODE")" = localhost ] || fail 'Expo local mode was not restored'
[ "$(cat "$TMP/state/env/EXPO_PUBLIC_CONVEX_URL")" = http://127.0.0.1:3210 ] || fail 'loopback Convex URL was not restored'
grep -Fx 'tailscale serve --https=8444 --set-path=/ off' "$TMP/state/commands" >/dev/null || fail 'owned Serve handler was not removed'
grep -Fx 'tailscale serve --tcp=8081 off' "$TMP/state/commands" >/dev/null || fail 'owned Metro TCP route was not removed'
node -e 'const j=require(process.argv[1]); if(j.TCP[8081]!==undefined||j.Web["fixture.tail.test:443"].Handlers["/"].Proxy!=="http://localhost:4000"||j.Web["fixture.tail.test:8443"].Handlers["/"].Proxy!=="http://localhost:5000"||j.Web["fixture.tail.test:8444"].Handlers["/admin"].Proxy!=="http://localhost:6000"||j.Web["fixture.tail.test:8444"].Handlers["/"]!==undefined) process.exit(1)' "$TMP/state/serve.json" || fail 'unrelated Serve routes changed'

rm -rf "$TMP/.recovery-tailnet"
printf '%s' '{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true}},"Web":{"fixture.tail.test:443":{"Handlers":{"/":{"Proxy":"http://localhost:4000"}}},"fixture.tail.test:8443":{"Handlers":{"/":{"Proxy":"http://localhost:5000"}}}}}' > "$TMP/state/serve.json"
if (cd "$TMP" && "${run_env[@]}" FAIL_PITCHFORK_START=1 ./scripts/zero-tailnet.sh >/dev/null 2>&1); then fail 'failed Metro startup was accepted'; fi
[ ! -e "$TMP/.recovery-tailnet" ] || fail 'failed startup left a tailnet ledger'
node -e 'const j=require(process.argv[1]); if(j.TCP[8081]!==undefined||j.Web["fixture.tail.test:8444"]!==undefined) process.exit(1)' "$TMP/state/serve.json" || fail 'failed startup left an owned Serve route'
[ "$(cat "$TMP/state/env/RECOVERY_EXPO_MODE")" = localhost ] || fail 'failed startup did not restore localhost mode'

rm -rf "$TMP/.recovery-tailnet"
printf '%s' '{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true}},"Web":{"fixture.tail.test:443":{"Handlers":{"/":{"Proxy":"http://localhost:4000"}}},"fixture.tail.test:8443":{"Handlers":{"/":{"Proxy":"http://localhost:5000"}}}}}' > "$TMP/state/serve.json"
if (cd "$TMP" && "${run_env[@]}" FAIL_TCP_SERVE=1 ./scripts/zero-tailnet.sh >/dev/null 2>&1); then fail 'failed TCP publication was accepted'; fi
[ ! -e "$TMP/.recovery-tailnet" ] || fail 'failed TCP publication left a tailnet ledger'
node -e 'const j=require(process.argv[1]); if(j.TCP[8081]!==undefined||j.Web["fixture.tail.test:8444"]!==undefined) process.exit(1)' "$TMP/state/serve.json" || fail 'failed TCP publication left a Serve route'
[ "$(cat "$TMP/state/env/RECOVERY_EXPO_MODE")" = localhost ] || fail 'failed TCP publication did not restore localhost mode'

rm -rf "$TMP/.recovery-tailnet"
printf '%s' '{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true}},"Web":{"fixture.tail.test:443":{"Handlers":{"/":{"Proxy":"http://localhost:4000"}}},"fixture.tail.test:8443":{"Handlers":{"/":{"Proxy":"http://localhost:5000"}}}}}' > "$TMP/state/serve.json"
(cd "$TMP" && "${run_env[@]}" ./scripts/zero-tailnet.sh >/dev/null)
rm "$TMP/.recovery-tailnet/tcp-route.tsv"
if (cd "$TMP" && "${run_env[@]}" ./scripts/stop.sh >/dev/null 2>&1); then fail 'cleanup accepted an incomplete TCP ledger'; fi
[ -d "$TMP/.recovery-tailnet" ] || fail 'incomplete ledger was discarded'
node -e 'const j=require(process.argv[1]);if(j.TCP[8081]?.TCPForward!=="localhost:8081")process.exit(1)' "$TMP/state/serve.json" || fail 'incomplete ledger partially removed routes'
printf '8081\tlocalhost:8081\n' > "$TMP/.recovery-tailnet/tcp-route.tsv"
(cd "$TMP" && "${run_env[@]}" ./scripts/stop.sh >/dev/null)

(cd "$TMP" && "${run_env[@]}" ./scripts/zero-tailnet.sh >/dev/null)
printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' 'CONVEX_URL=https://remote.invalid' > "$TMP/packages/backend/.env.local"
if (cd "$TMP" && "${run_env[@]}" ./scripts/stop.sh >/dev/null 2>&1); then fail 'cleanup accepted a non-loopback Convex URL'; fi
[ -d "$TMP/.recovery-tailnet" ] || fail 'ledger was discarded before loopback restoration'
printf '%s\n' 'CONVEX_DEPLOYMENT=anonymous:fixture-local' 'CONVEX_URL=http://127.0.0.1:3210' > "$TMP/packages/backend/.env.local"
(cd "$TMP" && "${run_env[@]}" ./scripts/stop.sh >/dev/null)
[ ! -e "$TMP/.recovery-tailnet" ] || fail 'ledger remained after successful restoration retry'

echo 'PASS: tailnet bootstrap and cleanup'
