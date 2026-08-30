#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
ALLOWED=${1:-}
FOUND=
while IFS= read -r path; do
  relative=${path#"$ROOT/"}
  [ "$relative" = "$ALLOWED" ] || FOUND=${FOUND}${FOUND:+
}$relative
done <<EOF
$(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/node_modules" -prune -o -name '.env*' -print)
EOF
[ -z "$FOUND" ] || { echo "Dotenv files are forbidden; move their values to mise.local.toml: $FOUND" >&2; exit 1; }
