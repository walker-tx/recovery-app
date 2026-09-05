# Disposable WorkOS staging smoke (#25)

Local Node helper using the existing WorkOS Node SDK 10.11.0. No Convex
functions, app records, servers, native input, or deployments are involved.
This creates an **already verified fixture**, not a signup/verification test.
Native secure-input coverage remains #36. No application user data exists in
this smoke; future callbacks creating application data must own its cleanup.
There is deliberately no backend administrative purge.

## Operator gate

First independently verify the API key and exact client ID belong to the
intended staging environment in WorkOS. Disable default verification/reset
email delivery per local-auth setup. A digest pin is **continuity checking,
not server-side proof of staging**. Prefixes are not evidence. An attacker
who can replace both credentials and pins is outside this protection.

The CLI supports **run only**: it never reads or writes credential files and
has no enrollment command. Establish both pins through existing Mise config
only after code review and explicit owner verification of the pair. Run these
operator-only commands from the verified authoritative repository root, not
from a worktree with different config. Do not enable shell tracing or tee/log
the pipes. The producers contain no literal credentials; their output goes
straight to Mise stdin, never the terminal. No raw secret command arguments
are used. This is deliberate trust enrollment, not automatic detection.

```sh
# Separately enroll SHA-256 of the exact key and the exact client ID.
mise exec -- node -e 'const k=process.env.WORKOS_API_KEY;if(!k?.trim())process.exit(1);process.stdout.write(require("node:crypto").createHash("sha256").update(k).digest("hex"))' | mise set --file mise.local.toml --stdin WORKOS_STAGING_KEY_SHA256
mise exec -- node -e 'const c=process.env.WORKOS_CLIENT_ID;if(!c?.trim())process.exit(1);process.stdout.write(c)' | mise set --file mise.local.toml --stdin WORKOS_STAGING_CLIENT_ID

# LIVE: only after both enrollment commands succeed; fresh Mise loads pins.
mise exec -- node .worktrees/workos-staging-test-users/packages/backend/scripts/workos-staging-cli.ts run
```

Use a shell with `set -o pipefail` and stop on either enrollment failure.
Missing, blank, partial, or mismatched pins fail closed. Never auto-enroll a
rotated pair; rotation requires renewed owner verification and deliberate
Mise updates. After integration remove `.worktrees/workos-staging-test-users/`
from the run path. Do not put credentials in .env files or test artifacts.

Run refuses non-staging mode, production NODE_ENV, any deployment key, and
configured Convex deployments except strictly formed `local:<identifier>` or
`anonymous:<identifier>` (nonempty ASCII letters, digits, underscores, hyphens).
Cloud/dev/prod and malformed identifiers are refused. Whitespace-only keys
and client IDs are refused even if pins match. Prefixes never establish
whether a WorkOS credential is staging.
Convex may be unset because no Convex network/data operation occurs. Mailpit
is not required because the verified fixture neither sends nor consumes an
email. Any future integration must separately gate local Convex and Mailpit.
These checks cannot independently detect mislabeled production credentials.

## Lifecycle and failure handling

Each run uses a cryptographically random UUID in
`recovery-smoke+<runId>@example.org`, external ID `recovery-smoke:<runId>`,
and metadata `recoverySmokeRun`. Passwords and authentication tokens stay in
process memory. The owner approved trying the reserved `example.org` domain
after `example.com` fixtures returned `SSO_REQUIRED`. This does not alter provider
policy or guarantee that password authentication is permitted for this domain.
The SDK's installed transport supports `timeout: 10000` milliseconds and
`maxRetries: 0`; creation is never blindly retried.

Only a returned user matching all run ownership fields becomes a deletion
target. Session listing is user-scoped, at most three pages of ten sessions;
missing or foreign session user IDs, repeated cursors, and excess pages fail cleanup. Revocation
and deletion execute in `finally`, including after authentication failure.
Deletion is still attempted if listing/revocation fails. Each request has a
10-second SDK timeout; the worst-case sequence is bounded but can take minutes.
No broad user listing or arbitrary deletion argument exists.

Output is fixed status codes, run ID, and independent `cleanup`/`sessions`
statuses. Exit 0 requires full success and deletion. A create transport error
or ownership mismatch reports cleanup `unknown`: locate the run manually in
the verified staging dashboard using run ID; do not blindly rerun or assume
nothing was created. Delete errors report `failed`; session cleanup errors
remain failures even if deletion succeeds. Abrupt termination, machine loss,
or timeout after server acceptance can leave artifacts; `finally` is not a
remote transaction. Never print raw SDK errors to investigate.

## Offline validation

From the worktree root:

```sh
mise exec -- pnpm --filter @recovery/backend test:staging
mise exec -- pnpm --filter @recovery/backend check
git diff --check
```

Tests use synthetic mocks only. Passing tests do not establish live staging
connectivity, email verification, or native end-to-end coverage.
