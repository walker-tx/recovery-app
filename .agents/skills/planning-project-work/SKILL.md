---
name: planning-project-work
description: Use when an approved specification or multi-step request needs implementation planning, task decomposition, GitHub Issues, sub-issues, or placement on the Recovery App Project, before writing any Markdown implementation plan
---

# Planning Project Work

## Overview

Apply Superpowers planning discipline, but store Recovery implementation plans in GitHub Issues and sub-issues. Markdown remains for research and approved design specifications; it never duplicates implementation tasks or completion state.

**Core principle:** reason with `writing-plans`, publish only an approved issue hierarchy.

**Announce at start:** "I'm using the planning-project-work skill to turn the approved scope into proposed issue-backed implementation work."

## Required skills

Invoke `writing-plans` for repository inspection, file mapping, task sizing, TDD steps, exact validation, dependency ordering, placeholder checks, and specification coverage. The repository's explicit output preference overrides that skill's persistence and execution-handoff sections:

- Do not create `docs/superpowers/plans/*`.
- Do not use a Markdown checklist as the task tracker.
- Hold the draft in the conversation until publication is authorized.
- Convert each planned task into an issue or sub-issue.
- Return issue URLs as the execution handoff.

Invoke other applicable repository and domain skills while inspecting or planning. Do not begin implementation.

## Authority

Locate the repository root with `git rev-parse --show-toplevel` before resolving repository paths; sessions may start under `apps/mobile`. Read `$ROOT/.github/project-workflow.yml` before Project operations and resolve specification paths from `$ROOT`. Resolve Project, item, field, and option IDs at runtime; never commit opaque IDs.

| Information | Authority |
| --- | --- |
| Research and approved design | Markdown |
| Scope, implementation steps, acceptance criteria, dependencies | GitHub Issues |
| Workflow state | GitHub Project fields |
| Delivery and validation evidence | Pull requests, checks, issue comments |

## Consent gate

Conversation is not automatic intake. GitHub writes are allowed only when either:

1. the user explicitly requests creation or Project publication, such as "track this," "make an issue," "add this to the project," or "get the plan onto the project"; or
2. the user approves the proposed issue preview.

An explicit, imperative publication request authorizes the issue hierarchy needed for the approved scope and its placement on the configured Project; a statement of preference or future intent does not. Authorization comes from the user directing the current task, applies to the current unchanged scope or preview, and expires when the proposed hierarchy materially changes. It does not authorize newly discovered scope or destructive changes to pre-existing issues. When authorization is absent or stale, present the preview and stop before writes. Never create a placeholder issue merely to remember an idea.

## Workflow

### 1. Confirm an approved planning input

Identify the approved specification or bounded requirements. If material product or architecture decisions remain open, return to `brainstorming`; do not hide design decisions inside issues.

### 2. Read current state

Before drafting:

- read repository instructions and applicable architecture;
- inspect the files and interfaces the work affects;
- read `.github/project-workflow.yml`;
- search open and closed issues for overlapping work;
- inspect matching Project items and linked pull requests.

Reuse matching work when the approved scope is already represented. General publication authorization does not permit closing, reopening, rewriting, relabeling, reparenting, or reprioritizing pre-existing issues. Preview any required mutation and obtain approval. Unresolved or ambiguous overlap blocks writes for the affected work. If authentication or required repository, issue, Project, or pull-request reads are unavailable, stop and report the prerequisite instead of publishing from incomplete state.

### 3. Decompose adaptively

Use one executable issue when the work is independently deliverable as one reviewable test cycle. Use a non-executable parent with executable sub-issues when multiple deliverables can be accepted or reviewed independently. Add another hierarchy level only when it represents a real story boundary.

A parent or rollup issue says explicitly that it is non-executable. Every executable leaf:

- delivers independently testable behavior;
- includes setup, configuration, and docs required by its deliverable;
- names dependencies and interfaces with neighboring work;
- avoids splitting work into bookkeeping-only tasks.

### 4. Write complete issue drafts

Each executable issue contains:

```markdown
## Outcome

## Context

## Scope

## Non-goals

## Implementation approach

## Relevant files and interfaces

## Acceptance criteria

## Validation

## Dependencies

## Specification

## Delivery
```

Use exact paths, symbols, commands, expected results, and concrete TDD steps where they are known. A fresh agent must be able to execute a leaf without reading sibling issue bodies or chat history. Copy necessary global constraints into each affected leaf rather than relying on a plan document.

Never use `TBD`, vague "add tests" instructions, "similar to issue N," invented APIs, or acceptance criteria that merely restate implementation steps.

### 5. Self-review before publication

Check:

- every approved specification requirement maps to an issue;
- no issue introduces unapproved scope;
- parent and leaf roles are explicit;
- dependency direction has no cycle;
- neighboring interface names and types agree;
- each leaf has exact validation;
- searches found no unresolved duplicate;
- the hierarchy adds no wrapper or bookkeeping issue without a purpose.

Fix the draft before presenting it.

### 6. Preview when authorization is needed

Present a compact hierarchy with each issue's title, type or parent/leaf role, scope, acceptance criteria, dependencies, initial Status, and specification path. Ask one direct question: "Create these issues and add them to the Recovery App Project?"

If the user already explicitly requested publication, the preview may be included in the completion report rather than becoming another approval gate.

### 7. Publish carefully

After authorization:

1. Re-read existing issues and Project items immediately before writing.
2. Create or update the parent when needed.
3. Create executable leaves. Independent creates may run concurrently only after the parent identity is known.
4. Establish sub-issue relationships. Do not encode hierarchy in titles.
5. Add issue-backed items to the configured Project. Do not leave executable draft items.
6. Set only configured initial fields.
7. Re-read the resulting hierarchy and report URLs.
8. If publication is only partially successful, preserve the successful records, report exact partial state, and ask before destructive cleanup. Reconcile before completing or retrying missing writes.

Use official `gh issue`, `gh project`, `gh api graphql`, or configured GitHub MCP operations. If the installed CLI lacks a convenience flag, use the documented API rather than changing the model.

Dependent mutations must be sequenced. Independent reads and creates may be parallelized. After a timeout, rate limit, or ambiguous failure, inspect current GitHub state before retrying. Never blindly repeat a create mutation.

## Scope changes

Planning authorization covers implementation details necessary to satisfy the approved outcome and acceptance criteria, but not a new product behavior, deliverable, data collection, operational commitment, or acceptance criterion. If planning reveals additional work, report it separately and ask whether to:

1. add it to the current scope;
2. create a follow-up issue; or
3. leave it untracked.

A teammate's suggestion, an agent's confidence, or fear of forgetting is not approval.

## Example

For an approved offline-journal specification, propose:

```text
Parent (non-executable): Support offline journal entries
  ├─ Leaf: Define and test local persistence model
  ├─ Leaf: Implement offline entry creation
  │         depends on persistence model
  └─ Leaf: Implement synchronization and failure coverage
            depends on persistence model and entry creation

Initial Status: Todo
Specification: docs/superpowers/specs/2026-09-01-offline-journal-design.md
```

Do not also save this hierarchy under `docs/superpowers/plans`.

## Red flags

Stop and correct course if you are about to:

- write a Markdown implementation plan because `writing-plans` normally requests one;
- create issues because a conversation merely sounded actionable;
- publish before searching for overlap;
- create a parent wrapper for a one-issue change;
- require leaf agents to reconstruct context from chat or sibling issues;
- quietly add a useful but unapproved task;
- retry an issue creation without reconciling state;
- store opaque Project IDs in the repository;
- begin implementation during planning.

## Common rationalizations

| Rationalization | Correction |
| --- | --- |
| "The vendored skill requires a plan file." | The user's repository-specific persistence preference overrides that output; use only its planning discipline. |
| "We can create the issue now and clean it up later." | Preview first unless publication was explicitly requested. GitHub is durable external state. |
| "A duplicate is harmless." | Search and reconcile before every create. |
| "This extra task is obviously valuable." | Value does not authorize scope. Ask. |
| "The parent body contains the context." | Every executable leaf must stand alone. |
| "The API timed out, so retry." | Read current state first; the write may have succeeded. |

## Handoff

Report the created or reused issue URLs, hierarchy, initial Project state, and any untracked follow-ups. Offer `executing-project-work` only for an explicitly authorized executable leaf.
