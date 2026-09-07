#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
# Mise runs tasks at the configuration root; discovery belongs to the caller.
if [ -n "${MISE_ORIGINAL_CWD-}" ]; then
  cd -- "$MISE_ORIGINAL_CWD"
fi
exec node "$ROOT/packages/local-workos/src/mock.ts" "$@"
