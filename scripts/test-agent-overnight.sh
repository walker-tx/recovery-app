#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FIXTURE=$(mktemp -d "${TMPDIR:-/tmp}/recovery-supervisor.XXXXXX")
trap 'rm -rf "$FIXTURE"' EXIT

mkdir -p "$FIXTURE/scripts" "$FIXTURE/docs" "$FIXTURE/packages/backend" "$FIXTURE/fake-bin"
cp "$ROOT/scripts/agent-overnight.sh" "$ROOT/scripts/check-no-dotenv.sh" "$FIXTURE/scripts/"
cp "$ROOT/docs/overnight-auth-plan.md" "$ROOT/docs/overnight-auth-handoff.md" "$FIXTURE/docs/"
cp "$ROOT/.gitignore" "$FIXTURE/"

python3 - "$FIXTURE" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
plan = root / "docs/overnight-auth-plan.md"
plan.write_text(plan.read_text().replace("- [ ]", "- [x]"))
handoff = root / "docs/overnight-auth-handoff.md"
handoff_text = re.sub(
    r"^- \*\*Next action:\*\* .+$",
    "- **Next action:** implement",
    handoff.read_text(),
    flags=re.MULTILINE,
)
handoff_text = re.sub(
    r"^- \*\*Correction cycles for current section:\*\* .+$",
    "- **Correction cycles for current section:** 0",
    handoff_text,
    flags=re.MULTILINE,
)
handoff.write_text(handoff_text)
PY

printf '%s' 'anonymous:anonymous-agent' > "$FIXTURE/convex-deployment"

cat > "$FIXTURE/fake-bin/mise" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ "$1 $2 $3 $4" = 'exec -- sh -c' ] || exit 64
cat convex-deployment
EOF

cat > "$FIXTURE/fake-bin/kit" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--root" ]; then root=$2; shift 2; else shift; fi
done
cd "$root"
[ "${CONVEX_DEPLOYMENT:-}" = "anonymous:anonymous-agent" ]
[ "${CONVEX_AGENT_MODE:-}" = "anonymous" ]
: "${FAKE_NEXT_ACTION:?}" "${FAKE_NEXT_COUNT:?}"
python3 - "$FAKE_NEXT_ACTION" "$FAKE_NEXT_COUNT" <<'PY'
from pathlib import Path
import re
import sys

action, count = sys.argv[1:]
p = Path("docs/overnight-auth-handoff.md")
text = re.sub(
    r"^- \*\*Next action:\*\* .+$",
    f"- **Next action:** {action}",
    p.read_text(),
    flags=re.MULTILINE,
)
text = re.sub(
    r"^- \*\*Correction cycles for current section:\*\* .+$",
    f"- **Correction cycles for current section:** {count}",
    text,
    flags=re.MULTILINE,
)
p.write_text(text)
PY
git add docs/overnight-auth-handoff.md
git commit -m "Fake transition to $FAKE_NEXT_ACTION/$FAKE_NEXT_COUNT" >/dev/null
echo OVERNIGHT_RESULT=progress
echo 'session_id: fake-session-001'
EOF
chmod +x "$FIXTURE/fake-bin/kit" "$FIXTURE/fake-bin/mise" "$FIXTURE/scripts/agent-overnight.sh"

cd "$FIXTURE"
git init -b agent/test >/dev/null
git config user.name "Supervisor Test"
git config user.email "supervisor@example.invalid"
git add .
git commit -m baseline >/dev/null

if CONVEX_DEPLOYMENT=dev:cloud PATH="$FIXTURE/fake-bin:$PATH" scripts/agent-overnight.sh --dry-run >/dev/null 2>&1; then
  echo "conflicting inherited deployment was not rejected" >&2
  exit 1
fi
if CONVEX_AGENT_MODE=cloud PATH="$FIXTURE/fake-bin:$PATH" scripts/agent-overnight.sh --dry-run >/dev/null 2>&1; then
  echo "conflicting inherited agent mode was not rejected" >&2
  exit 1
fi
printf '%s' 'dev:cloud' > convex-deployment
if PATH="$FIXTURE/fake-bin:$PATH" scripts/agent-overnight.sh --dry-run >/dev/null 2>&1; then
  echo "cloud deployment selection was not rejected" >&2
  exit 1
fi
printf '%s' 'anonymous:anonymous-agent' > convex-deployment

git checkout --detach >/dev/null 2>&1
if PATH="$FIXTURE/fake-bin:$PATH" scripts/agent-overnight.sh --dry-run >/dev/null 2>&1; then
  echo "detached HEAD was not rejected" >&2
  exit 1
fi
git checkout agent/test >/dev/null 2>&1

PATH="$FIXTURE/fake-bin:$PATH" scripts/agent-overnight.sh --dry-run >/dev/null
mkdir -p .agent-overnight/supervisor.lock
if PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 scripts/agent-overnight.sh --once >/dev/null 2>&1; then
  echo "concurrent supervisor lock was not rejected" >&2
  exit 1
fi
rm -rf .agent-overnight/supervisor.lock
FAKE_NEXT_ACTION=review FAKE_NEXT_COUNT=0 PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 SUCCESS_PAUSE_SECONDS=0 scripts/agent-overnight.sh --once >/dev/null

grep -q '^\- \*\*Next action:\*\* review$' docs/overnight-auth-handoff.md
[ "$(stat -f '%Lp' .agent-overnight)" = "700" ]
[ "$(stat -f '%Lp' .agent-overnight/overnight.log)" = "600" ]
[ "$(stat -f '%Lp' .agent-overnight/sessions.tsv)" = "600" ]

# Approved/accepted-deferred review advances and resets the count.
FAKE_NEXT_ACTION=implement FAKE_NEXT_COUNT=0 PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 SUCCESS_PAUSE_SECONDS=0 scripts/agent-overnight.sh --once >/dev/null
# Drive both correction cycles through their exact accepted transitions.
FAKE_NEXT_ACTION=review FAKE_NEXT_COUNT=0 PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 SUCCESS_PAUSE_SECONDS=0 scripts/agent-overnight.sh --once >/dev/null
FAKE_NEXT_ACTION=correct FAKE_NEXT_COUNT=1 PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 SUCCESS_PAUSE_SECONDS=0 scripts/agent-overnight.sh --once >/dev/null
FAKE_NEXT_ACTION=review FAKE_NEXT_COUNT=1 PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 SUCCESS_PAUSE_SECONDS=0 scripts/agent-overnight.sh --once >/dev/null
FAKE_NEXT_ACTION=correct FAKE_NEXT_COUNT=2 PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 SUCCESS_PAUSE_SECONDS=0 scripts/agent-overnight.sh --once >/dev/null
FAKE_NEXT_ACTION=review FAKE_NEXT_COUNT=2 PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 SUCCESS_PAUSE_SECONDS=0 scripts/agent-overnight.sh --once >/dev/null
set +e
FAKE_NEXT_ACTION=blocked FAKE_NEXT_COUNT=2 PATH="$FIXTURE/fake-bin:$PATH" INVOCATION_TIMEOUT_SECONDS=60 SUCCESS_PAUSE_SECONDS=0 scripts/agent-overnight.sh --once >/dev/null
blocked_status=$?
set -e
[ "$blocked_status" -eq 3 ]

grep -q '^\- \*\*Next action:\*\* blocked$' docs/overnight-auth-handoff.md
grep -q '^\- \*\*Correction cycles for current section:\*\* 2$' docs/overnight-auth-handoff.md
[ "$(git rev-list --count HEAD)" -eq 9 ]
[ "$(grep -c $'\tfake-session-001\t' .agent-overnight/sessions.tsv)" -eq 8 ]

echo "agent-overnight supervisor self-test passed"
