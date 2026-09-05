#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
FILE=$ROOT/packages/backend/.env.local
if [ ! -e "$FILE" ] && [ ! -L "$FILE" ]; then
  [ "${1:-}" != --ready ] || exit 2
  exit 0
fi
"$ROOT/scripts/check-no-dotenv.sh" packages/backend/.env.local
# Validate a single complete snapshot, then consume only that validated snapshot.
[ ! -L "$ROOT/mise.local.toml" ] || { echo 'Mise configuration must not be a symlink.' >&2; exit 1; }
metadata=$(node "$ROOT/scripts/convex-metadata.cjs" "$FILE") || exit $?
[ "${1:-}" != --check ] || exit 0
printf '%s\n' "$metadata" | while IFS='=' read -r key value; do
  printf %s "$value" | mise set --file "$ROOT/mise.local.toml" --stdin "$key" >/dev/null || exit 1
done
rm "$FILE"
