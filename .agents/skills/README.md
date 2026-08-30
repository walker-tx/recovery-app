# Repository agent skills

Kit discovers valid skills recursively from `<root>/.agents/skills` and progressively loads a skill only when its description matches the task. The canonical skill set is this repository-root directory. Because mobile sessions are commonly rooted at `apps/mobile`, an exact committed mirror of every skill directory lives at `apps/mobile/.agents/skills`; from the repository root, refresh it with `.agents/scripts/sync-mobile-skills.sh` after changing the canonical set. Provenance and licenses remain canonical in the repository-root directory rather than being mirrored. The pinned official Convex skills are intentionally not copied into the mobile mirror because that upstream revision does not publish a redistribution license; start Kit at the repository root for Convex-specialized work. Restart Kit after adding, removing, or renaming skills so the advertised catalog refreshes.

## Repository-owned skills

- `architecture` — repository structure, dependency, state ownership, and abstraction rules.
- `expo` — Expo Router and React Native workflow.
- `convex` — repository-specific Convex and Convex Auth workflow.
- `review-app` — repository-owned, read-only multi-lens application review and independent finding validation. Its attributed research sources are recorded in [`review-app/references/sources.md`](review-app/references/sources.md).
- `app-development` — orchestrates Recovery Expo work and routes tasks to applicable Expo, React Native, composition, simplicity, audit, and verification skills.
- `local-auth-preview` — starts and validates local Convex, WorkOS, Expo, and native tailnet preview workflows without exposing secrets or inventing a web app.
- `audit-design-artifact` — audits the complete Recovery auth/onboarding flow against the Claude design artifact with explicit evidence levels.
- `inspect-claude-design-artifacts` — clean-browser retrieval for Claude artifact frames and evidence captures.
- `exposing-dev-servers-over-tailscale` — safe tailnet-only HTTP service exposure and cleanup; native Metro normally uses direct tailnet routing instead.

## Copied third-party skills

The complete pinned payloads and license/provenance details are recorded in [`THIRD_PARTY.md`](THIRD_PARTY.md). The repository includes:

- all selected Obra Superpowers workflow skills;
- Vercel composition patterns, React best practices, and React Native skills with their rule payloads;
- the complete Ponytail skill set.

Do not edit these vendored directories locally. Put Recovery-specific policy in repository-owned orchestration skills.

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
- `expo-ui`
- `expo-animation`
- `expo-examples`
- `expo-upgrade`

These cover the framework workflows most relevant to a mobile Expo Router application. We intentionally omitted EAS paid-service skills, brownfield/native-module workflows, web migration, Tailwind, and generic data-fetching guidance. Convex remains the source of truth for application server data, so generic client-cache recommendations must not override the architecture contract.

Repository instructions and [`docs/architecture.md`](../../docs/architecture.md) take precedence over generic upstream defaults. Do not edit copied skill files locally. To update official or third-party skills, review the relevant upstream diff, replace each selected set from one recorded commit, update provenance, and refresh the mobile-root mirror.
