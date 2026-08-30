# GitHub Project Work Tracking Design

## Goal

Make GitHub Issues and the repository-linked GitHub Project the authoritative implementation tracker for Recovery's coding agents while keeping research, design specifications, architecture, and decisions in versioned Markdown.

## Authority boundaries

- Markdown is authoritative for research, approved design specifications, architecture, and decisions.
- GitHub Issues and sub-issues are authoritative for user stories, delivery scopes, implementation plans, executable tasks, acceptance criteria, and dependencies.
- GitHub Project fields are authoritative for workflow status and any configured planning metadata.
- Pull requests, commits, checks, and issue comments hold implementation and validation evidence.
- No Markdown implementation plan is created. A Markdown specification may link to issues, but it does not duplicate task completion state.

## Project ownership

Recovery uses the user-owned GitHub Projects v2 project `walker-tx/3`, titled `Recovery App`, linked to `walker-tx/recovery-app`. It appears from the repository Projects page while its canonical board URL is `https://github.com/users/walker-tx/projects/3`.

Repository configuration records the human-readable owner, repository, project number, and supported workflow values. Agents resolve opaque GitHub node, field, and option IDs at runtime.

## Consent and authorization

Conversation does not automatically create backlog work. An agent may create an issue only when the user explicitly requests it or approves a preview proposed by the agent. The preview includes the title, issue type, scope, acceptance criteria, linked specification, hierarchy, and initial Project state.

Approval to create tracked work authorizes routine lifecycle updates for that work: claiming it, updating execution status, linking branches and pull requests, and recording evidence. It does not authorize material scope or acceptance-criteria changes, priority or iteration changes, additional issues, production actions, merges that repository safeguards prohibit, or any review bypass.

When implementation reveals out-of-scope work, the agent reports it and asks whether to expand the current scope, create a follow-up issue, or leave it untracked. Before any retry after a partial GitHub write, the agent reconciles current state to avoid duplicates.

## Adaptive issue hierarchy

- A bounded independently deliverable change uses one executable issue.
- A larger capability uses one non-executable parent issue and independently executable sub-issues.
- A broad initiative may use story-level children and task-level descendants only when the additional boundary is useful.
- Parent and rollup issues are never implementation targets.
- Each executable leaf issue contains enough context for a fresh agent: outcome, context, scope, non-goals, implementation approach, relevant files and interfaces, acceptance criteria, exact validation, dependencies, specification link, and delivery requirements.

## Repository-owned skill layer

Vendored Superpowers skills remain unmodified. Recovery adds two repository-owned orchestration skills.

### `planning-project-work`

This skill is selected after a specification is approved, when the user asks for implementation planning or issue decomposition, or before an agent would otherwise use `writing-plans`. It invokes `writing-plans` for repository inspection, file mapping, right-sized task decomposition, TDD steps, validation commands, dependency ordering, placeholder checks, and specification coverage.

Recovery's explicit persistence preference overrides the vendored skill's Markdown output: the wrapper holds its draft in the conversation, converts tasks to a proposed issue hierarchy, checks GitHub for overlapping work, and requests approval. Only after approval does it create or update issues, add them to the configured Project, establish parent relationships, and set initial workflow fields. It returns issue URLs rather than writing `docs/superpowers/plans/*`.

### `executing-project-work`

This skill is selected when asked to implement, continue, or pick up issue-backed Project work. It verifies that the target is an authorized executable leaf issue, reads linked specifications and dependencies, claims the issue, uses applicable Superpowers implementation and review skills, opens a linked pull request, and records concise validation evidence. Routine workflow transitions are allowed after work authorization; scope and backlog changes still require approval.

The skill never picks arbitrary Inbox work, implements rollup issues, broadens scope silently, treats tracking permission as deployment permission, or bypasses repository safeguards.

## Repository steering

The root `AGENTS.md` contains only the stable authority, consent, and routing rules. Detailed procedures and GitHub command guidance live in the repository-owned skills. The canonical skill directories live under `.agents/skills` and are copied to the mobile mirror only by `.agents/scripts/sync-mobile-skills.sh`.

## Project workflow

The initial implementation uses the Project's native `Todo`, `In Progress`, and `Done` Status values. This is enough to track authorized execution without introducing duplicate lifecycle fields. New custom fields or statuses require a demonstrated view or automation need. Linked pull requests provide review visibility.

A normal lifecycle is:

1. A user explicitly requests tracking, or approves an agent's issue proposal.
2. Research or an approved design specification is written in Markdown when needed.
3. `planning-project-work` proposes one issue or an adaptive hierarchy.
4. Approval publishes issue-backed Project items in `Todo`.
5. `executing-project-work` moves one authorized leaf to `In Progress`.
6. The agent implements, verifies, and opens a linked pull request.
7. GitHub closure or deterministic automation moves completed work to `Done`.

## Failure handling

GitHub reads and writes must use the authenticated official CLI, API, or GitHub MCP tools. Operations resolve items before creating them, perform the fewest writes required, serialize dependent mutations, and inspect state after ambiguous failures. Missing project scopes, inaccessible repository items, renamed fields, rate limits, and partial success are reported rather than bypassed.

## Verification

Each skill is behavior-tested with pressure scenarios before adoption. Tests must demonstrate that agents do not create surprise issues, do not write Markdown plans, preserve the approved hierarchy, keep executable issues self-contained, reconcile before retries, distinguish routine updates from scope changes, and refuse unauthorized or rollup execution. Repository checks verify skill discovery metadata, the canonical-to-mobile mirror, configuration references, and that vendored skill directories were not modified.
