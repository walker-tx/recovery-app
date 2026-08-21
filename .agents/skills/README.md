# Repository agent skills

Kit discovers valid skills recursively from this directory and progressively loads a skill only when its description matches the task. Restart Kit after adding, removing, or renaming skills so the advertised catalog refreshes.

## Repository-owned skills

- `architecture` — repository structure, dependency, state ownership, and abstraction rules.
- `expo` — Expo Router and React Native workflow.
- `convex` — repository-specific Convex and Convex Auth workflow.
- `review-app` — repository-owned, read-only multi-lens application review and independent finding validation. Its attributed research sources are recorded in [`review-app/references/sources.md`](review-app/references/sources.md).

## Copied third-party skills

- `ponytail-review` — copied unmodified from [`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail/tree/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail-review) at commit `2ed6c52c9d7e5e56942508591085fd45dea277d3`; MIT license included in the skill directory.

## Official Convex skills

The following directories are copied unmodified from [`get-convex/agent-skills`](https://github.com/get-convex/agent-skills) at commit `6843b65f3cbcee34bb2bc984d444f42ac7ca2a61`:

- `convex-expert`
- `convex-docs`
- `convex-reviewer`
- `convex-authz`
- `convex-test`
- `convex-verify`
- `convex-migrate`
- `convex-deploy-guard`

These were selected for everyday implementation, version-aware research, review, authorization, testing, migrations, and deployment safety. We intentionally did not install the entire upstream catalog because many skills target capabilities this app does not use or require operational tools that are not configured.

## Official Expo skills

The following directories are copied unmodified from [`expo/skills`](https://github.com/expo/skills) at commit `472d040092900dc8bbf84dc7efb0c90abff77a0d`:

- `expo-router`
- `expo-project-structure`
- `expo-design-system`
- `expo-native-ui`
- `expo-animation`
- `expo-examples`
- `expo-upgrade`

These cover the framework workflows most relevant to a mobile Expo Router application. We intentionally omitted EAS paid-service skills, brownfield/native-module workflows, web migration, Tailwind, and generic data-fetching guidance. Convex remains the source of truth for application server data, so generic client-cache recommendations must not override the architecture contract.

Repository instructions and [`docs/architecture.md`](../../docs/architecture.md) take precedence over generic upstream defaults. Do not edit copied skill files locally. To update official skills, review the relevant upstream diff and replace each selected set from one recorded commit.
