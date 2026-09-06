#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$ROOT"
FIXTURE=$(mktemp -d "$ROOT/.code-style-test.XXXXXX")
trap 'rm -rf "$FIXTURE"' EXIT HUP INT TERM
OXFMT="$ROOT/node_modules/.bin/oxfmt"
OXLINT="$ROOT/node_modules/.bin/oxlint"

# Check mode must reject unreadable code, and write mode must repair it.
printf 'export const value={first:1,second:2}' > "$FIXTURE/format.ts"
if "$OXFMT" --check "$FIXTURE/format.ts" > /dev/null 2>&1; then
  echo 'Formatter accepted unformatted code' >&2
  exit 1
fi
"$OXFMT" --write "$FIXTURE/format.ts" > /dev/null
"$OXFMT" --check "$FIXTURE/format.ts" > /dev/null

# Each strict rule must independently reject a violation.
for source in \
  'export function check(value: number) { if (value) return true; return false; }' \
  'export const check = (value: number) => value == 1;' \
  'export const check = (value: any) => value;' \
  'export var value = 1;' \
  'debugger;' \
  'const unused = 1;' \
  '// oxlint-disable-next-line no-debugger
export const value = 1;'
do
  printf '%s\n' "$source" > "$FIXTURE/lint.ts"
  if "$OXLINT" --deny-warnings --report-unused-disable-directives "$FIXTURE/lint.ts" > /dev/null 2>&1; then
    echo "Linter accepted forbidden code: $source" >&2
    exit 1
  fi
done
printf 'export const value = 1;\n' > "$FIXTURE/lint.ts"
"$OXLINT" --deny-warnings --report-unused-disable-directives "$FIXTURE/lint.ts" > /dev/null

# A valid owned file keeps these directory checks from passing on an empty scan.
for directory in .agents _generated; do
  mkdir "$FIXTURE/$directory"
  printf 'export var value={first:1}' > "$FIXTURE/$directory/ignored.ts"
done
"$OXFMT" --check "$FIXTURE" > /dev/null
"$OXLINT" --deny-warnings --report-unused-disable-directives "$FIXTURE" > /dev/null

echo 'Code-style rejection, repair, and exclusion checks passed'
