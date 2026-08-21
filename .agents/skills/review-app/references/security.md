# Security and privacy lens

Review the target as an attacker and as a custodian of sensitive recovery information. Report concrete exploit or exposure paths, not generic hardening advice. For each suspected vulnerability, identify the attacker, reachable public or lifecycle entry point, attacker-controlled value, path to the affected operation, existing defenses, and concrete impact. Authentication is a normal precondition for cross-user attacks, not a reason to dismiss them.

## Identity and authorization

- Does every public Convex operation derive identity from server auth?
- Is ownership or membership checked for each returned or mutated resource, including parent references?
- Can client-provided IDs, emails, roles, or owner fields select another user's data?
- Are scheduled/internal operations non-public and based on durable server state?
- Are protected routes incorrectly treated as backend authorization?

## Data and secrets

- Could a narrow query return excess profile, auth, or recovery data?
- Are tokens and secrets excluded from `EXPO_PUBLIC_*`, source, logs, errors, analytics, URLs, and scheduler arguments?
- Do local persistence and account switching prevent cross-user data residue?
- Are errors sanitized while preserving stable client-actionable codes?

## Inputs and effects

- Are public arguments and returns runtime-validated?
- Are deep links and route parameters treated as untrusted?
- Can duplicate requests, retries, or partial action failures repeat an external effect?
- Are external effects outside mutations and designed with durable intent/idempotency?
- Does a deployment-affecting command identify and guard the target environment?

When usable history exists and a trust-boundary check changed, inspect why the prior protection existed and whether the change reopens an old path. State when provider internals, deployment configuration, or device behavior are unavailable.

Use the read-only audit portions of `convex-authz` for focused backend authorization review and `convex-reviewer` for broader Convex review when applicable. The review branch must not apply their hardening steps.
