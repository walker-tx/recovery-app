# Vendored third-party skills

Third-party skill payloads under this directory are committed so repository agents receive a stable, reviewable workflow set. Do not edit vendored skill content for project-specific behavior; put Recovery-specific orchestration in a separate repository skill.

## Obra Superpowers

- Upstream: `https://github.com/obra/superpowers`
- Pinned commit: `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`
- License: MIT; copy at `licenses/obra-superpowers-LICENSE`
- Included complete skill directories:
  - `brainstorming`
  - `dispatching-parallel-agents`
  - `executing-plans`
  - `finishing-a-development-branch`
  - `receiving-code-review`
  - `requesting-code-review`
  - `subagent-driven-development`
  - `systematic-debugging`
  - `test-driven-development`
  - `using-git-worktrees`
  - `using-superpowers`
  - `verification-before-completion`
  - `writing-plans`
  - `writing-skills`

## Vercel agent skills

- Upstream: `https://github.com/vercel-labs/agent-skills`
- Pinned commit: `063bee94c3f4df8453406c830b0a7df0f2860278`
- License: MIT as declared in each vendored skill's frontmatter; permission notice retained at `licenses/vercel-agent-skills-LICENSE`
- Included complete rule payloads; the active `vercel-react-best-practices` description is narrowed for this mobile-only repository to prevent automatic Next.js/web routing, while its body and rules remain upstream:
  - `vercel-composition-patterns` from upstream `skills/composition-patterns`
  - `vercel-react-best-practices` from upstream `skills/react-best-practices`
  - `vercel-react-native-skills` from upstream `skills/react-native-skills`

## Ponytail

- Upstream: `https://github.com/DietrichGebert/ponytail`
- Pinned commit: `2ed6c52c9d7e5e56942508591085fd45dea277d3`
- License: MIT; copy at `licenses/ponytail-LICENSE`
- Included complete skill directories:
  - `ponytail`
  - `ponytail-audit`
  - `ponytail-debt`
  - `ponytail-gain`
  - `ponytail-help`
  - `ponytail-review`

## Official Convex skills (canonical repository root only)

- Upstream: `https://github.com/get-convex/agent-skills`
- Pinned commit: `6843b65f3cbcee34bb2bc984d444f42ac7ca2a61`
- Included canonical directories: `convex-expert`, `convex-docs`, `convex-reviewer`, `convex-authz`, `convex-test`, `convex-verify`, `convex-migrate`, and `convex-deploy-guard`.
- The pinned upstream revision publishes no redistribution license for these skill payloads. They predate this expansion and remain documented in `README.md`; the mobile-root sync deliberately excludes them rather than creating new copies. Use them only from a repository-root Kit session until upstream licensing changes.

## Expo skills

- Upstream: `https://github.com/expo/skills`
- Pinned commit: `472d040092900dc8bbf84dc7efb0c90abff77a0d`
- License: MIT; permission notice retained at `licenses/expo-skills-LICENSE`
- Included complete skill directories from `plugins/expo/skills`:
  - `expo-animation`
  - `expo-design-system`
  - `expo-examples`
  - `expo-native-ui`
  - `expo-project-structure`
  - `expo-router`
  - `expo-ui`
  - `expo-upgrade`

## Effect-TS skills

- Upstream: `https://github.com/Effect-TS/skills`
- Pinned commit: `2309e6f27d9955b434c0e3f394b945c136e89fd2`
- License: MIT; copy at `licenses/effect-ts-skills-LICENSE`
- Included complete, unmodified directory: `effect-ts` from upstream `skills/effect-ts` (only `SKILL.md` at this revision).
- Mirrored into `apps/mobile/.agents/skills/effect-ts` for mobile-root sessions.

## Updating vendored skills

1. Review upstream changes and licenses before selecting a new commit.
2. Copy complete skill directories, including references, rules, templates, scripts, and metadata.
3. Update the pinned commit in this file.
4. Keep upstream content unmodified except for documented project-safety frontmatter adaptations; update Recovery orchestration skills separately.
5. Validate unique skill names, frontmatter, referenced local files, and repository checks.
6. Review the resulting diff before committing; never update vendored workflows implicitly during unrelated feature work.
