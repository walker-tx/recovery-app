#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
SOURCE="$ROOT/.agents/skills"
TARGET="$ROOT/apps/mobile/.agents/skills"

test -f "$ROOT/AGENTS.md"
test -d "$ROOT/apps/mobile"
test -d "$SOURCE"

rm -rf "$TARGET"
mkdir -p "$TARGET"

for skill_file in "$SOURCE"/*/SKILL.md; do
  skill_dir="$(dirname "$skill_file")"
  skill_name="$(basename "$skill_dir")"
  case "$skill_name" in
    convex-*) continue ;; # upstream publishes no redistribution license at the pinned revision
  esac
  cp -R "$skill_dir" "$TARGET/$skill_name"
done

printf 'Mirrored repository skill directories to %s\n' "$TARGET"
