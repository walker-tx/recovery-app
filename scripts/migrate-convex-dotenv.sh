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
snapshot=$(mktemp)
trap 'rm -f "$snapshot"' EXIT
trap 'exit 1' HUP INT TERM
[ ! -L "$FILE" ] && [ -f "$FILE" ] || exit 1
cp "$FILE" "$snapshot"
metadata=$(node "$ROOT/scripts/convex-metadata.cjs" "$snapshot") || exit $?
[ "${1:-}" != --check ] || exit 0
printf '%s\n' "$metadata" | while IFS='=' read -r key value; do
  printf %s "$value" | mise set --file "$ROOT/mise.local.toml" --stdin "$key" >/dev/null || exit 1
done
# Compare exact validated bytes, not a fresh validation of possibly changed input.
# A local filesystem adversary can still race this check and unlink.
if [ -L "$FILE" ] || ! cmp -s "$snapshot" "$FILE"; then
  echo 'Convex metadata changed during migration; retaining current file.' >&2
  exit 1
fi
rm "$FILE"
