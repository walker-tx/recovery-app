---
name: review-app
description: Run a multi-lens review of an application change using parallel subagents for architecture, simplicity, security, accessibility, adversarial behavior, and product fit. Use for /review-app, feature reviews, PR reviews, stacked-change reviews, or pre-merge application audits.
---

# Review App

Review only. The parent, loader, lens reviewers, and skeptic must not edit files, install packages, stage or commit changes, create artifact files, post PR comments, mutate remote state, or rerun duplicate expensive checks. The goal is a short, evidence-backed list of defects and material risks, not six summaries or a style critique.

Read `docs/architecture.md`, `AGENTS.md`, and the lens rubrics in this skill's `references/` directory. Activate relevant framework skills when useful. Use both `ponytail-review` and `references/simplicity.md` for the simplicity lens.

## 1. Establish the review target

Identify the exact target before reviewing: an explicit diff or PR, the current branch against its base, staged/uncommitted changes, named files, or the whole app. Do not silently review unrelated pre-existing code. Named files/paths and whole-app review work without git; branch, PR, diff, and stack scope require git metadata. If the requested scope requires unavailable git context, or no target can be inferred, ask one focused scope question.

Collect product evidence in this order when available: user-supplied goal or acceptance criteria, issue/PR/stack descriptions, repository product documents, tests and examples, then implementation names. Never invent product intent.

For stacked work, inspect available parent and child PR descriptions/diffs. Record which requirement belongs to this change, which is explicitly deferred to another known change, and which has no owner. Do not excuse a broken current user path based on a hypothetical future PR.

Run or inspect the smallest relevant checks once centrally. Review agents should not each repeat expensive checks.

## 2. Load shared context once

Start exactly one read-only context-loading subagent. Have it inspect the target diff, changed files and nearby contracts, `docs/architecture.md`, relevant tests, and available product/stack evidence. No subagent may start another subagent. It must return a compact review packet containing:

- target and base;
- changed files and important line ranges;
- intended user outcome and acceptance criteria with sources;
- architecture and security invariants in scope;
- known parent/child stack responsibilities;
- checks already run and their results;
- uncertainties that reviewers must not guess through.

## 3. Fork independent review lenses

Fork the completed context session into six read-only branches. Run branches concurrently when capacity permits; otherwise use bounded waves. Give every branch the same review packet and its lens-specific rubric. A branch reports only findings in its scope, with evidence, or `No findings.` Close each completed branch promptly. Preserve partial results from failed or stalled branches, cancel branches that stop making progress, and disclose degraded coverage rather than silently retrying an entire wave.

1. **Architecture** — conformance with `docs/architecture.md`, ownership boundaries, dependency direction, Convex contracts, state ownership, and justified abstractions.
2. **Simplicity** — apply both `ponytail-review` and `references/simplicity.md`: deletion opportunities, installed-version native/platform replacements, speculative layers, unnecessary dependencies, and materially smaller equivalents. Do not report correctness or security here.
3. **Security and privacy** — authentication, authorization, data exposure, secrets, sensitive recovery information, unsafe inputs, logging, deep links, side effects, and deployment risk. Use official Convex review/authz skills when backend code changes.
4. **Accessibility** — semantic controls, labels, states, focus and announcements, touch targets, dynamic type, keyboard behavior, contrast/non-color cues, motion, and platform behavior. Distinguish static evidence from device-testing needs.
5. **Adversarial behavior** — actively try to break the change with malformed parameters, races, duplicate actions, stale state, reconnects, lifecycle transitions, account switching, large/empty data, and partial failures.
6. **Product fit** — trace the intended user outcome end to end. Check acceptance criteria, missing states, misleading completion, stack ownership, and whether the implementation solves the sourced need rather than merely matching a ticket title.

Skip a lens only when it is objectively not applicable, such as accessibility for a backend-only migration, and state why. Significant user-facing changes receive all six lenses.

## Finding contract

Every finding must include:

```text
[P0|P1|P2|P3] Short title
Location: path:line or smallest useful range
Lens: architecture|simplicity|security|accessibility|adversarial|product
Evidence: what the code does and the concrete failing scenario or violated contract
Impact: user, security, operational, or maintenance consequence
Fix: smallest credible correction
Confidence: high|medium|low
Change relation: Introduced|Surfaced|Pre-existing/unaffected|Uncertain
```

Severity:

- **P0:** immediate catastrophic security, privacy, or data-loss risk.
- **P1:** blocks the core user outcome, creates a serious vulnerability, or corrupts data.
- **P2:** meaningful functional, accessibility, architectural, or operational defect.
- **P3:** localized low-risk problem worth fixing; omit mere preferences.

A finding is valid only if the reviewer can point to changed code or a directly affected contract and describe a plausible failure. Questions and missing context are not findings unless the absence itself makes the implementation unsafe. `Pre-existing/unaffected` candidates are excluded unless the target newly exposes, worsens, or depends on the issue; in that case classify the relationship precisely rather than relabeling it as introduced.

## 4. Merge and classify candidates

After all lens branches finish or are closed, the parent merges their output before any skeptic review:

1. Verify each candidate against the actual code and source context.
2. Classify it as `Introduced`, `Surfaced`, `Pre-existing/unaffected`, or `Uncertain`.
3. Remove duplicates and merge cross-lens reports into the highest-impact root cause.
4. Exclude unaffected pre-existing code, generated or vendored code, duplicated compiler/check output, preference-only objections, intentional harmless behavior, test-only shortcuts that cannot escape tests, hypothetical future callers or configurations, and unrelated out-of-scope code.
5. Keep simplicity suggestions separate from correctness blockers unless complexity directly causes the defect.
6. Report check failures independently from review findings.

## 5. Independently challenge the shortlist

Start a fresh read-only skeptic after parent deduplication. Give it a bounded bundle containing the candidate claims and locations, target scope, and relevant contracts, but omit originating reviewer identity and persuasive prose when practical. The skeptic must inspect the source, nearby defenses, installed-version framework behavior, and current reachability; it must not merely vote on the supplied prose. A public Convex function is a reachable internet boundary even when the current mobile app has no caller.

For each candidate return exactly one verdict with evidence:

- `CONFIRMED` — evidence and severity hold;
- `DOWNGRADED` — a real issue remains but impact, confidence, or scope is lower;
- `REJECTED` — contradicted, excluded, or not currently reachable;
- `OPEN QUESTION` — material uncertainty requires unavailable product, runtime, deployment, or version evidence.

A plausible security or privacy concern that cannot be runtime-verified belongs in residual risks, not silent rejection. Close the skeptic when complete, preserve its partial results if it stalls, and disclose any candidates it did not assess.

## 6. Final synthesis

The parent applies skeptic verdicts, rechecks changed claims, and sorts surviving findings by severity then confidence.

Final response order:

1. **Findings** — actionable items only.
2. **Open questions** — only decisions that genuinely require product or domain input.
3. **Residual risks and verification gaps** — device checks, deployment checks, or unavailable stack context.
4. **Review coverage** — one line naming completed/skipped lenses and checks run.

If no findings survive verification, say `No actionable findings.` and still state residual verification gaps. Never claim runtime accessibility, security, or product correctness was proven solely by static review.
