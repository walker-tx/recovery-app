---
name: expo
description: Develop and validate the Expo Router mobile app safely, including dependencies, configuration, routing, and Convex Auth token storage.
---

# Expo workflow

This repository-specific skill supplements the installed official Expo skills. Use `expo-router` for navigation, `expo-project-structure` for source boundaries, `expo-design-system` and `expo-native-ui` for shared UI, `expo-animation` for motion, `expo-examples` for integrations, and `expo-upgrade` for SDK upgrades. Repository instructions and `docs/architecture.md` take precedence over generic defaults, especially for Convex-owned server state.

Work in `apps/mobile`. Routes and layouts live in `src/app`; keep routing concerns in layouts and screens, and avoid adding custom Metro monorepo configuration unless resolution actually fails.

## Dependencies

- Add Expo/native packages with `mise exec -- pnpm --filter @recovery/mobile exec expo install <package>`. This preserves the Expo SDK compatibility matrix.
- Add ordinary JavaScript dependencies with `mise exec -- pnpm --filter @recovery/mobile add <package>`.
- Do not independently bump Expo, React, or React Native. Use Expo's upgrade flow and verify the complete matrix.
- Do not run `expo prebuild` unless a native module or config-plugin change requires it.

## Configuration and security

- Treat every `EXPO_PUBLIC_*` value as public, bundled application data. Never put credentials or signing secrets there.
- Keep Convex Auth token storage backed by `expo-secure-store`. Do not replace it with AsyncStorage.
- OAuth is not configured yet. When adding it, update the app scheme, provider callback configuration, and Expo Router URL replacement together.
- Replace placeholder bundle/package identifiers before creating distributable builds.

## Validation

Start with the narrow check, then expand only when relevant:

```sh
mise exec -- pnpm --filter @recovery/mobile run check
mise exec -- pnpm --filter @recovery/mobile exec expo install --check
mise run doctor
```
