# Product-fit lens

Review against sourced intent, not personal product taste.

## Evidence hierarchy

1. User-stated goal and acceptance criteria in the review request.
2. Linked issue, PRD, design, support report, or PR description.
3. Explicit parent/child changes in a known stack.
4. Repository product documentation and tests.
5. Code names only as weak evidence.

## Review method

- Restate the intended user outcome in one sentence with its source. Identify the actor, precondition, requested action, user benefit, resulting state change, and side effects when the sources define them.
- Trace the journey from entry through success, empty, loading, failure, retry, and return.
- Check each acceptance criterion against observable behavior.
- Identify functionality that appears complete in UI but lacks backend persistence, authorization, navigation, or recovery.
- For a stack, review the current layer against its immediate parent rather than a cumulative trunk-to-top diff. Assign each requirement to the parent, current, or known child change. A requirement with no owner is a gap.
- Do not require the current change to implement work explicitly and safely owned by another known change, but do not accept a currently broken user path based on hypothetical future work.
- Flag scope that solves a technical proxy while missing the user's actual need.
- Keep optional improvements out of findings unless they are required by sourced goals.

A product finding cites both sides: the documented claim and the implementation evidence, plus the affected user and observable consequence. If product evidence is absent or conflicts, limit the lens to internal consistency and list the missing/conflicting acceptance criteria as an open question rather than inventing them. Do not manufacture product intent or success metrics through web research.
