---
name: app-development
description: Use when adding, changing, refactoring, debugging, or reviewing user-facing behavior in the Recovery Expo application, including routes, screens, React components, state, styling, accessibility, navigation, performance, and mobile UI architecture.
---

# Recovery app development

## Overview

Treat mobile application work as React Native product work, not generic web frontend work. Compose repository architecture, Expo guidance, Vercel React practices, and Ponytail simplicity according to the task.

## Required context

Before designing a change:

1. Resolve `REPO_ROOT="$(git rev-parse --show-toplevel)"` and `MOBILE_ROOT="$REPO_ROOT/apps/mobile"`; read `$REPO_ROOT/AGENTS.md` and `$REPO_ROOT/docs/architecture.md`.
2. Inspect the target route, feature owner, shared primitives, nearby tests, and current state owner under `MOBILE_ROOT`.
3. Invoke `ponytail` and prefer the smallest native solution that satisfies demonstrated requirements.
4. Use the process skills required by the task, including brainstorming, TDD, debugging, planning, review, and verification.

Repository instructions and architecture override generic skill guidance. React Native guidance overrides DOM or Next.js assumptions.

## Skill routing

| Situation | Skills to invoke |
| --- | --- |
| Any React Native or Expo component work | `vercel-react-native-skills` plus `expo` |
| Routes, guards, navigation, or deep links | `expo-router` |
| Component API, reuse, slots, variants, or boolean-prop growth | `vercel-composition-patterns` |
| A specific cross-platform React performance issue with a clearly applicable non-web rule | `vercel-react-best-practices`, scoped to that rule only |
| Native controls and platform UI | `expo-native-ui` |
| Animation work | `expo-animation` |
| Design tokens or shared primitives | `expo-design-system` |
| Project structure or feature placement | `architecture` and `expo-project-structure` |
| Claude artifact-backed screen | `audit-design-artifact` |
| Local WorkOS preview or tailnet access | `local-auth-preview` |
| Final application review | `review-app` and `ponytail-review` when warranted |

Do not invoke every skill mechanically. Invoke the skills whose trigger matches, but `vercel-react-native-skills` is the default practice guide for mobile UI changes.

## Applying Vercel guidance

### React Native

Use `vercel-react-native-skills` for list performance, images, animations, native APIs, press behavior, rendering safety, styling, and mobile accessibility. Reconcile it with the installed Expo SDK and repository primitives before changing code.

### React best practices

Do not load `vercel-react-best-practices` by default for ordinary Expo state or rendering work; `vercel-react-native-skills` and repository architecture are the defaults. Invoke the generic React skill only for a specific cross-platform rule that you have verified has no Next.js, React Server Component, route-handler, hydration, DOM, browser-API, resource-hint, or web data-fetching assumptions. State which rule applies before using it. Never add a web dependency, server-component pattern, or memoization solely because the generic guide mentions it.

### Composition patterns

Use `vercel-composition-patterns` when a component API has real variants or multiple consumers. Prefer children, explicit variants, and narrow context boundaries over boolean-prop combinations. Do not extract a shared component before demonstrated duplication or independent behavior justifies it.

## Recovery architecture rules

- Routes own navigation and composition; feature screens own reusable behavior and UI.
- Dependencies point from routes to features to shared UI and platform clients.
- Every state value has one authoritative owner. Avoid mirrored or synchronized state.
- Shared UI must not import Router, Convex, or feature modules.
- Keep user-owned authorization on the backend regardless of route guards.
- Use existing `Screen`, `Typography`, `Button`, and `TextField` contracts before adding wrappers.
- Preserve accessible labels, roles, focus, announcements, disabled/busy state, text scaling, and minimum touch targets.
- Add dependencies only for demonstrated complexity and install Expo/native packages with the repository-approved Expo command.
- Do not add a web app, EAS, shared package, backend capability, or recovery-domain feature unless requested.

## Development loop

1. Identify the authoritative state owner and user-visible acceptance criteria.
2. Find the nearest working repository pattern and relevant installed-version guidance.
3. Design the smallest coherent change; avoid speculative extension points.
4. Write a failing behavior or contract test and verify the failure.
5. Implement through existing primitives and one-way boundaries.
6. Run the smallest mobile check, then broader checks required by the repository.
7. Review the rendered interaction on a device or supported preview when visuals changed.
8. Run artifact audit, app review, and verification skills when their triggers apply.

## Completion checklist

- The route remains focused on navigation and composition.
- State has one owner and no unnecessary effects or mirrors.
- Component APIs use explicit composition rather than boolean modes.
- React Native behavior was checked on the relevant platform or disclosed as unverified.
- Accessibility behavior is represented in tests and runtime review where possible.
- No generic Vercel web/Next rule was applied blindly.
- No dependency or abstraction was added for hypothetical scale.
- Targeted tests, TypeScript checks, and `git diff --check` pass before claiming completion.
