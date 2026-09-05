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

Commands below run from the repository root containing the authoritative
`mise.local.toml`. For the current isolated worktree:

```sh
# DANGEROUS LOCAL TRUST ENROLLMENT: only after code review and explicit owner
# verification of the current pair. No network; writes two pins into [env].
mise exec -- node .worktrees/workos-staging-test-users/packages/backend/scripts/workos-staging-cli.ts enroll --confirm-owner-verified-staging-pair

# LIVE operation: creates/authenticates/revokes/deletes one disposable user.
# A fresh Mise invocation loads the enrolled pins.
mise exec -- node .worktrees/workos-staging-test-users/packages/backend/scripts/workos-staging-cli.ts run
```

After integration remove `.worktrees/workos-staging-test-users/` from paths.
Enrollment refuses existing pin names. Rotation requires renewed owner
verification and explicit editing of `WORKOS_STAGING_KEY_SHA256` (SHA-256 hex
of the exact key) and `WORKOS_STAGING_CLIENT_ID` in the gitignored Mise config;
never auto-enroll a rotated pair. Do not put credentials in command arguments,
.env files, stdout, or test artifacts. Enrollment prints only a fixed code.
The existing config must have a conventional `[env]` section with no existing
pins; unsupported config forms fail closed rather than being migrated.

Run refuses missing/mismatched pins, non-staging mode, production NODE_ENV,
any deployment key, and any configured Convex deployment not `local:`.
Convex may be unset because no Convex network/data operation occurs. Mailpit
is not required because the verified fixture neither sends nor consumes an
email. Any future integration must separately gate local Convex and Mailpit.
These checks cannot independently detect mislabeled production credentials.

## Lifecycle and failure handling

Each run uses a cryptographically random UUID in
`recovery-smoke+<runId>@example.com`, external ID `recovery-smoke:<runId>`,
and metadata `recoverySmokeRun`. Passwords and authentication tokens stay in
process memory. Reserved example.com addresses follow the WorkOS testing
recommendation; see [WorkOS testing](https://workos.com/docs/authkit/testing)
and [user management API](https://workos.com/docs/reference/user-management).
The SDK's installed transport supports `timeout: 10000` milliseconds and
`maxRetries: 0`; creation is never blindly retried.

Only a returned user matching all run ownership fields becomes a deletion
target. Session listing is user-scoped, at most three pages of ten sessions;
foreign user IDs, repeated cursors, and excess pages fail cleanup. Revocation
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
