---
name: architecture
description: Structure features and cross-cutting changes according to the repository architecture contract, including boundaries, state ownership, library adoption, Convex contracts, and extraction triggers.
---

# Architecture workflow

Resolve `REPO_ROOT="$(git rev-parse --show-toplevel)"` and read `$REPO_ROOT/docs/architecture.md` before adding a feature, moving code across boundaries, introducing shared state, adopting a structural library, or creating a reusable abstraction. This works whether Kit is rooted at the repository or `apps/mobile`. Treat the contract's invariants as mandatory and its defaults as the starting point.

## Before implementation

1. Name the user capability being changed.
2. Identify the authoritative owner of each state value: Convex, Convex Auth, Expo Router, local React state, or an explicitly designed persistence layer.
3. State the client/server contract and backend authorization rule.
4. Identify the actual query access path and required index.
5. Keep the implementation route-local or capability-local unless an extraction trigger already exists.
6. If adding a library, record the concrete duplication, defect, or capability it removes and why built-in patterns are insufficient.

## During implementation

- Keep route files focused on navigation and feature composition.
- Group growing code by capability under `src/features`; do not create technical dumping grounds.
- Keep dependencies flowing from routes to features to shared UI/platform code.
- Use generated Convex hooks directly unless a feature hook adds real orchestration.
- Preserve explicit loading, empty, missing, pending, and error states.
- Keep every public Convex function validated, authenticated as appropriate, authorized, indexed, bounded, and narrow in its return shape.
- Put related database invariants in one mutation and external effects behind durable intent plus internal actions.

## Before finishing

- Confirm the change did not duplicate server data into a second client store or hand-copy generated contracts.
- Confirm shared code has multiple real consumers or another documented extraction trigger.
- Add tests at the durable behavioral boundary when substantive behavior exists.
- Run the narrow package check first, then `mise run check` for cross-package changes and `mise run doctor` for Expo dependency/configuration changes.
- Write an ADR only for a durable, difficult-to-reverse architectural exception.
