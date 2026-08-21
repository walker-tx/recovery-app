# Skills research handoff

## Objective

Continue evaluating well-regarded agent skills and review workflows from the public internet for the repository-owned `/review-app` workflow. The goal is not to accumulate a large catalog. Find sources that materially improve one of the six review lenses or the orchestration/verification process, verify their provenance and licenses, and either vendor a clearly superior skill or adapt only the narrow useful ideas with attribution.

The six lenses are:

1. architecture;
2. simplicity and over-engineering;
3. security and privacy;
4. accessibility;
5. adversarial behavior and resilience;
6. product fit, including stacked-change context.

## Repository context

- Repository: `/Users/walker/github.com/walker-tx/recovery-app`
- This is a mobile-only Expo Router app with a Convex backend and Convex Auth.
- `AGENTS.md` and `docs/architecture.md` are authoritative.
- The repository is intentionally **not a git repository**, so branch, PR, and stack inspection cannot currently run. Explicit paths or whole-app review still work.
- Copied upstream skills must remain unmodified, pinned to an exact commit, and documented with provenance.
- A global `/Users/walker/AGENTS.md` now requires bounded timeouts, progress updates within roughly five minutes, cancellation of stalled work, narrow research scopes, and no reliance on background work as durable overnight execution. New sessions should load it automatically.

## Current local implementation

The repository-owned review skill is at:

- `.agents/skills/review-app/SKILL.md`
- `.agents/skills/review-app/references/security.md`
- `.agents/skills/review-app/references/accessibility.md`
- `.agents/skills/review-app/references/adversarial.md`
- `.agents/skills/review-app/references/product.md`
- `.agents/skills/review-app/references/simplicity.md`
- `.agents/skills/review-app/references/sources.md`

It currently specifies one shared context-loading subagent, six read-only lens branches, centralized checks, evidence-backed P0–P3 findings, parent synthesis, and explicit residual verification gaps.

A copied simplicity skill is installed at `.agents/skills/ponytail-review/` from `DietrichGebert/ponytail` commit `2ed6c52c9d7e5e56942508591085fd45dea277d3`, with its MIT license.

## Sources already researched

Do not repeat broad discovery for these unless checking a specific claim or a newer upstream revision:

- [Dimillian review-swarm](https://github.com/Dimillian/Skills/tree/main/review-swarm) (MIT): shared context, independent read-only reviewers, parent synthesis.
- [Liatrio Code Gauntlet](https://github.com/liatrio-labs/claude-code-gauntlet) (Apache-2.0): independent validation, blind challenge, false-positive controls.
- [Addy Osmani code-review-and-quality](https://github.com/addyosmani/agent-skills/tree/main/skills/code-review-and-quality) (MIT): shallow orchestration, preference resistance, concrete remedies.
- [Dietrich Gebert ponytail-review](https://github.com/DietrichGebert/ponytail/tree/main/skills/ponytail-review) (MIT): deletion-oriented simplicity review.
- [Community Access accessibility-agents](https://github.com/Community-Access/accessibility-agents) (MIT): React Native semantics and touch targets.
- [rshankras claude-code-apple-skills accessibility audit](https://github.com/rshankras/claude-code-apple-skills/tree/main/skills/ios/accessibility-audit) (MIT): task-based device checks. This is community-maintained; do not describe it as official Apple guidance without evidence.
- [GitHub gh-stack](https://github.com/github/gh-stack/tree/main/skills/gh-stack) (MIT): immediate-parent stack scope.
- [PyGraphistry review skill](https://github.com/graphistry/pygraphistry/tree/master/agents/skills/review) (BSD-3-Clause): exact base/head scope and parent/current/child responsibility.
- [phuryn PM skills](https://github.com/phuryn/pm-skills) (MIT): sourced outcomes and observable acceptance criteria.
- [Trail of Bits differential-review](https://github.com/trailofbits/skills/tree/main/plugins/differential-review) (CC BY-SA 4.0): attacker/reachability model, history-aware trust boundaries, coverage limits. General ideas were independently expressed; no prompt text was copied. Be cautious about share-alike obligations.
- Official Convex skills already installed from `get-convex/agent-skills` commit `6843b65f3cbcee34bb2bc984d444f42ac7ca2a61`.
- Official Expo skills already installed from `expo/skills` commit `472d040092900dc8bbf84dc7efb0c90abff77a0d`.

The detailed current source summary is in `.agents/skills/review-app/references/sources.md`.

## Research gaps

### Architecture

Look for a concrete architecture-review skill that checks dependency direction, state ownership, capability boundaries, and abstraction triggers without imposing speculative enterprise layering. Prefer small React Native/Expo applications over generic distributed-system checklists.

### Mobile security and privacy

Look for credible Expo/React Native review skills aligned with OWASP MASVS/MASTG. Relevant gaps include local storage, screenshots/backups, logs, deep links, clipboard/share surfaces, account switching, transport assumptions, and sensitive recovery information. Distinguish authoritative standards from executable agent skills.

### Accessibility

Look for practical cross-platform mobile review/testing skills grounded in official Apple, Android, React Native, Expo, WCAG, or WAI guidance. Desired coverage includes VoiceOver, TalkBack, focus management, announcements, font scaling, contrast, reduced motion, external keyboards, switch/voice control, and modal behavior. Static review must not claim runtime verification.

### Adversarial behavior and resilience

Look for skills that generate reproducible lifecycle and state-transition scenarios: offline/reconnect, duplicate effects, stale async completion, optimistic rollback, auth restoration/account switching, process death, partial backend failure, and concurrent devices. Prefer invariant-based workflows over generic brainstorming.

### Product fit

Look for skills that trace mobile journeys through entry, loading, empty, error, retry, success, return, persistence, and backend effects while refusing to invent personas, intent, or metrics.

### Overall review quality

Look for evidence-backed mechanisms that improve reviewer independence, reduce anchoring and duplicate findings, calibrate severity, account for coverage, and independently validate candidate findings. More agents alone are not an improvement.

Simplicity is already comparatively well covered. Add another source only if it offers a materially better, installed-version-aware deletion workflow.

## How to run the next internet research wave

The previous attempt launched three open-ended parallel research branches and stalled for more than 45 minutes. It was interrupted and returned **no usable research results**. Do not repeat that execution pattern.

Use short, bounded waves:

1. Inspect `AGENTS.md`, `docs/architecture.md`, the current review skill, its references, and this handoff.
2. Give each research task one narrow category and a finite candidate/source budget, for example at most five repositories or 2–3 minutes.
3. Prefer GitHub API or direct raw-file inspection over broad, unbounded browsing.
4. Require a result after each wave before starting another. Report progress to the user within roughly five minutes.
5. Cancel a branch that stops making meaningful progress. Preserve partial results.
6. Close subagent sessions after each wave.

For each candidate, capture:

- canonical repository, maintainer, and whether it is official or community-authored;
- exact skill/file path and exact commit reviewed;
- current popularity signals such as stars/forks or a notable maintainer, treated only as discovery signals;
- recent activity and maintenance evidence;
- actual relevant prompt/workflow contents, not only README claims;
- SPDX license and whether it covers the skill files;
- required tools, remote writes, package installs, scanners, or platform assumptions;
- distinctive value beyond the existing local workflow;
- recommendation: `vendor`, `cite/adapt`, or `reject`, with one concrete reason.

Do not treat an awesome-list entry, marketplace ranking, or repository star count as proof that an individual skill is safe or effective.

## Adoption criteria

Vendor a skill only if it:

- fills a demonstrated gap and is materially better than the local rubric;
- has an inspectable maintainer/history and a redistribution-compatible license;
- can be pinned to an exact commit;
- is compatible with read-only, diff-scoped Kit review;
- produces concrete evidence rather than style preferences or unsupported speculation;
- does not conflict with Expo, Convex, repository architecture, or product-evidence rules;
- is distinct enough to justify catalog and context overhead.

Cite or adapt a narrow idea instead when the source overlaps heavily, assumes unavailable tools, performs writes, has unclear licensing, or offers only one useful pattern. Reject generic reviewer prompts that merely restate common checklists.

## Unfinished local edits

After research—or independently if the research adds nothing—the review skill still needs these changes:

1. Add a fresh, independent skeptic/disproof phase after parent deduplication. Give it a bounded candidate bundle without originating reviewer identity or persuasive prose when practical. Verdicts: `CONFIRMED`, `DOWNGRADED`, `REJECTED`, or `OPEN QUESTION`.
2. Require the skeptic to inspect source, nearby defenses, installed-version framework behavior, and current reachability. A public Convex function is a reachable boundary even without a current mobile caller. Plausible security/privacy concerns lacking runtime evidence should move to residual risk rather than silently disappear.
3. Add false-positive exclusions: unaffected pre-existing code, generated/vendored code, duplicated compiler output, preference-only objections, intentional harmless behavior, test-only shortcuts that cannot escape tests, hypothetical future callers/configurations, and unrelated out-of-scope code. Preserve a pre-existing issue only if the target newly exposes, worsens, or depends on it.
4. Classify candidates as `Introduced`, `Surfaced`, `Pre-existing/unaffected`, or `Uncertain`.
5. Make all reviewer restrictions explicit: no edits, installs, staging, commits, artifact files, PR comments, remote mutation, or duplicate expensive checks.
6. Clarify orchestration: one loader, six forks in bounded waves if needed, no reviewer recursion, close completed sessions, merge before skeptic review, preserve partial results, and disclose degraded coverage.
7. Make the simplicity lens point to both `ponytail-review` and `references/simplicity.md`.
8. Handle the non-git repository explicitly: explicit files/paths or whole-app scope works; PR/branch/stack scope requires git and should trigger one focused scope question.
9. Update `.agents/skills/README.md` to document repository-owned `review-app` and copied `ponytail-review` provenance/license.

## Validation after edits

Run the smallest skill-structure check:

```sh
count=0
for f in .agents/skills/*/SKILL.md; do
  name=$(basename "$(dirname "$f")")
  grep -q '^---$' "$f"
  grep -q "^name: $name$" "$f"
  grep -q '^description:' "$f"
  count=$((count+1))
done
echo "$count"
```

Expected discoverable skill count: **20**. A final full validation after the latest review-skill additions has not yet been recorded.

## Suggested deliverable to the user

Return a compact table of verified candidates with provenance, distinctive value, license, and recommendation. Then state whether any candidate is strong enough to vendor. Do not modify or vendor external skills until the user agrees with the shortlist unless they explicitly request implementation.
