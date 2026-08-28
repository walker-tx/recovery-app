#!/usr/bin/env bash
set -euo pipefail

root_layout="apps/mobile/src/app/_layout.tsx"
failures=0

require_text() {
  local file=$1
  local text=$2
  local message=$3
  if ! grep -Fq "$text" "$file"; then
    printf 'FAIL: %s\n' "$message" >&2
    failures=$((failures + 1))
  fi
}

require_file() {
  local file=$1
  if [[ ! -f "$file" ]]; then
    printf 'FAIL: missing route %s\n' "$file" >&2
    failures=$((failures + 1))
  fi
}

require_text "$root_layout" 'useConvexAuth' 'root routing does not read Convex Auth restoration state'
require_text "$root_layout" 'if (isLoading || (isAuthenticated && destination === null)) return <RestorationLoading />' 'route guards render before auth or profile restoration finishes'
require_text "$root_layout" 'accessibilityLabel="Loading your account"' 'restoration loading state has no accessible name'
require_text "$root_layout" 'accessibilityRole="progressbar"' 'restoration loading state does not identify its progress semantics'
require_text "$root_layout" '<Stack.Protected guard={!isAuthenticated}>' 'auth routes are not protected from authenticated users'
require_text "$root_layout" '<Stack.Protected guard={isAuthenticated && destination === "onboarding"}>' 'onboarding routes are not protected by authenticated profile state'
require_text "$root_layout" '<Stack.Protected guard={isAuthenticated && destination === "app"}>' 'app routes are not protected by authenticated profile state'
require_text "$root_layout" '<Stack.Screen name="(auth)"' 'auth route group is not registered'
require_text "$root_layout" '<Stack.Screen name="(onboarding)"' 'onboarding route group is not registered'
require_text "$root_layout" '<Stack.Screen name="(app)"' 'app route group is not registered'
require_text "$root_layout" 'if (!convex) return <MissingConfiguration />' 'missing Convex configuration is not handled outside auth hooks'

require_file 'apps/mobile/src/app/(auth)/_layout.tsx'
require_file 'apps/mobile/src/app/(auth)/index.tsx'
require_file 'apps/mobile/src/app/(auth)/sign-in.tsx'
require_file 'apps/mobile/src/app/(onboarding)/_layout.tsx'
require_file 'apps/mobile/src/app/(onboarding)/profile.tsx'
require_file 'apps/mobile/src/app/(app)/_layout.tsx'
require_file 'apps/mobile/src/app/(app)/home.tsx'

index_count=$(find apps/mobile/src/app -name index.tsx -type f | wc -l | tr -d ' ' )
if [[ "$index_count" != 1 ]]; then
  printf 'FAIL: expected exactly one route matching /, found %s index routes\n' "$index_count" >&2
  failures=$((failures + 1))
fi

if [[ -f apps/mobile/src/app/index.tsx ]]; then
  printf 'FAIL: obsolete segmented auth route still exists\n' >&2
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  exit 1
fi

printf 'Auth route contract passed.\n'
