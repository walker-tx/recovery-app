# Local WorkOS provider core

Private synthetic-only provider for #46. Import `startProvider` from `src/provider.ts`
and pass an explicit absolute SQLite filename (existing owner-controlled parent directory)
and a synthetic API key matching `sk_test_local_` followed by 64 lowercase hexadecimal characters. It binds only `127.0.0.1` on an ephemeral port;
its result includes `port`, `issuer`, `clientId`, and async `close()`. Call `close()`
before removing disposable test state. Never use real credentials or `.env` files.

```sh
mise exec -- pnpm --filter @recovery/local-workos test
mise exec -- pnpm --filter @recovery/local-workos check
```

## Local administration CLI

The package-owned `src/mock.ts` entry point uses the existing Effect 4 RC CLI.
It selects the caller's Git worktree (including nested directories and symlinks),
or an explicit `--worktree <path>`, and reads the existing stack registry. It does
not start, reserve, repair, stop, or reset a stack.

From the delivery checkout root:

```sh
mise run mock -- status
mise run mock -- --worktree /absolute/path/to/another/worktree users list
mise exec -- ./scripts/mock.sh --json status
mise exec -- ./scripts/mock.sh --json users list --limit 20
```

**Mise runner limitation:** installed Mise 2026.8.8 appends a task-failure line to
stderr when `mise run` receives a nonzero child exit, even with task quiet/raw
settings. Use `mise exec -- ./scripts/mock.sh ...` for strict single-object JSON
failures and unchanged exit codes. The direct wrapper itself adds no banners.
From a nested directory, use the absolute wrapper path with `mise exec`; discovery
still uses that nested cwd. This is an explicit difference from the originally
proposed all-purpose `mise run mock` invocation, not a claim that Mise's extra
failure output is JSON. Runner/bootstrap failures before the Node entry point can
also produce runner diagnostics; consumers must require both complete JSON and
the documented exit status.

### Commands and confirmations

Commands are `status`; `users list/get/create/update/verify/delete`;
`sessions list/revoke/revoke-all`; and `inbox list/read`. Use `--help` for the
command-specific flags. No wizard, pager, prompt, browser, email initiation,
provider token inspection, inbox waiting, or stack teardown is added.

Obtain the selected `stackId` and `providerGeneration` from status. Every provider
mutation requires both assertions; they do not select another target:

```sh
printf %s 'synthetic development password' | mise exec -- ./scripts/mock.sh \
  users create --email developer@example.invalid --password-stdin \
  --expect-stack STACK_UUID --expect-generation GENERATION_UUID

mise exec -- ./scripts/mock.sh users update USER_ID --first-name '' \
  --expect-stack STACK_UUID --expect-generation GENERATION_UUID

mise exec -- ./scripts/mock.sh users verify USER_ID --verified true \
  --expect-stack STACK_UUID --expect-generation GENERATION_UUID

mise exec -- ./scripts/mock.sh sessions revoke-all --user USER_ID \
  --expect-stack STACK_UUID --expect-generation GENERATION_UUID

mise exec -- ./scripts/mock.sh users delete USER_ID \
  --confirm-email developer@example.invalid \
  --expect-stack STACK_UUID --expect-generation GENERATION_UUID
```

Use synthetic credentials only. Password creation accepts explicit non-TTY stdin,
not argv or an ambient password variable. It preserves exact UTF-8 bytes,
including a trailing newline, with a 4 KiB input cap before the provider password
policy. Omitted update fields stay unchanged; explicitly empty names clear them.
Verification override is setup, not proof of the real email verification flow.
Deletion additionally checks the user's current email atomically on the server.
Revocation does not require email confirmation. Provider deletion/revocation
preserves Convex data, device storage, and captured mail. Already-issued access
JWTs may remain accepted until expiry. Recreating an email does not restore its
old subject or application data.

### Private target and output boundary

The OS account is the administration trust boundary: root and same-user
processes are trusted, not isolated tenants. A short socket path is derived by
one registry-owned rule from the existing persisted stack UUID:
`<canonical /tmp>/recovery-admin-<uid>/<stackId>.sock`. This keeps the six-field
version-1 shared registry compatible with older sibling worktrees. Explicit
normal lifecycle restart with the new code adds the listener for existing
reservations without recreating identity or data. An old running provider is
not silently restarted by the CLI.

The parent is owner-only 0700; the published socket is 0600. Occupied, insecure,
stale, or ambiguous endpoints are refused rather than unlinked. CLI reads check
precise recorded PID/start-time/canonical-cwd continuity, then validate live
socket stack/generation identity. Startup/stop ownership remains in the existing
lifecycle implementation. Administration reads do not query or start Pitchfork.
Mailpit access additionally verifies the allocated loopback listener belongs to
the recorded process. This uses native `lsof` on macOS; Linux requires `lsof`
available and readable process evidence, otherwise inbox access fails closed.
Linux runtime behavior is not proven by the macOS tests.

Human output escapes untrusted terminal controls. `--json` emits one version-1
success object on stdout, or one sanitized failure object on stderr when normal
error rendering succeeds. Help/version are non-service commands with `target:
null`. Exit codes: 0 success; 2 invalid invocation; 3 target/confirmation refusal;
4 unavailable/deadline before mutation dispatch; 5 uncertain mutation outcome;
1 other failure; SIGINT 130. Never infer success from incomplete JSON or partial
output after a broken pipe. Writes are not automatically retried.

The operation deadline defaults to 5000 ms (`--timeout-ms`, maximum 30000), with
at most 3000 ms additional cleanup grace. HTTP request/response streams are capped
at 1 MiB. Lists default to 50, accept limits 1 through 100, and return an opaque
`nextCursor` or null. No command automatically scans all pages.

### Captured inbox

```sh
mise exec -- ./scripts/mock.sh --json inbox list --to developer@example.invalid
mise exec -- ./scripts/mock.sh --json inbox read MESSAGE_ID
```

Listing is nonmutating and projects out Mailpit body snippets and attachments.
**Metadata is still sensitive:** subjects can contain a code or reset link.
`--to` compares exact case-insensitive structured To addresses in one bounded
ordinary-list page, not Mailpit search syntax, display names, Cc, or Bcc. `scanned`
counts raw summaries examined; an empty filtered page can have a continuation.
Cursors bind target/inbox epoch/filter/limit. Mailpit offset continuation is
best-effort: arrivals, deletions, and tied timestamps can duplicate or omit mail.

**Reading marks the message read**, including when a later response-size,
transport, or output failure prevents delivery to the caller. It never restores
unread afterward. Successful reads disclose `sensitive: true`,
`readStateEffect: marks-read`, and `textProvenance: mailpit-parsed-or-derived`;
Mailpit may have derived Text from HTML. Empty usable text is represented as null.
The CLI does not render HTML, open links, fetch assets, download attachments, or
extract/submit codes. Reading does not complete verification/reset or change
native authentication. Mail may outlive provider-user deletion and generations;
select the actual timestamped message for the native attempt.

## Effect linting

`check` runs TypeScript and then Oxlint with zero warnings allowed. `.oxlintrc.json`
inherits the repository lint rules and adds the Effect correctness, antipattern,
and Effect-native presets for source and tests; the Effect style preset is
intentionally not enabled. Unused suppression comments also fail lint.

Workspace `lint` delegates this package to its own type-aware lint command while
checking other packages normally. This is necessary because nested Oxlint configs
do not activate type-aware mode for a non-type-aware root invocation. No package
is excluded from the combined check.

The pinned `@effect/tsgo`, `oxlint`, and `oxlint-tsgolint` versions are a compatible
set. The package `prepare` script patches only Oxlint after installation, leaving
TypeScript unchanged. Upgrade these three together and rerun `prepare`, `check`,
and `test`; the patcher rejects unsupported versions. If lifecycle scripts were
skipped during installation, run:

```sh
mise exec -- pnpm --filter @recovery/local-workos run prepare
mise exec -- pnpm --filter @recovery/local-workos run lint
```

Tests enforce the same Effect presets as source, including JSON, async-function,
Promise, fetch, and date rules. The only configuration override is native Node
imports in the explicitly listed black-box harness files: these tests inspect
SQLite files, filesystem permissions, child processes, and raw HTTP transport.
New test files do not inherit that exception automatically.

Other exceptions are local, explained suppression comments for deliberate
interop/security boundaries (for example, the shutdown watchdog must work even
when Effect cleanup cannot finish, and native Promise mocks must settle after
an Effect consumer is interrupted). HTTP client Layers are supplied at test
entry points. Do not suppress a finding merely to pass lint.

`pnpm run test:style` also injects forbidden Effect code into a temporary test
file and verifies that floating Effects, raw JSON, and async wrappers are rejected.
The fixture is removed on exit.

## Effect implementation and tests

The CLI uses the pinned Effect 4 `effect/unstable/cli` command and flag APIs.
HTTP routes use `effect/unstable/httpapi`; raw request validation preserves
WorkOS error envelopes and authentication precedence without exposing schema
diagnostics or credential values. Router matching is case-sensitive and does not
normalize trailing/duplicate slashes or encoded static path segments. Successful
responses use concrete schemas and Effect's native response encoding; malformed
stored response data produces a generic 500, and undeclared user fields are
omitted. `src/contracts.ts` defines supported request/response shapes;
`src/http.ts` owns routing and error envelopes. An Effect `WorkOSService` Layer
in `src/workos-service.ts` owns the operations; `src/provider.ts` owns SQLite,
signing-key acquisition, and server lifecycle. `acquireProvider` is the native
scoped Effect API; `startProvider` is its Promise compatibility adapter. The CLI
loads validated, branded bootstrap configuration once and supplies application-scoped
configuration and acquired signing identity services. Persisted signing identity
remains authoritative; configuration cannot replace it. HTTP binding acquisition is
protected from interruption until it settles, preventing a late listener from
escaping scope cleanup; the CLI retains its three-second shutdown watchdog.
The HTTP app can be tested with
an injected service Layer without opening a database.

Tests use the matching `@effect/vitest` release. `it.live` retains real HTTP, SDK,
SQLite, and subprocess behavior, with scoped cleanup for provider instances and
temporary directories. JWT verification with an overridden date and persisted
expiry metadata checks are not proof of expiry after actual elapsed time; that
lifecycle verification remains separate.

## Implemented core

Effect, platform-node, and sql-sqlite-node are exactly `4.0.0-rc.112`. The Effect
SQLite Layer owns one scoped connection backed by Node 24 built-in SQLite; no
separate native database driver or ORM is required. It enables foreign keys,
uses a 50 ms busy timeout, and preserves the existing non-WAL journal behavior.
State files are mode 0600; the caller owns the
parent directory and cleanup. The parent must be an owner-only directory; existing
database/journal/WAL/SHM files must be same-owner regular files with no group/other
permissions. Symlinks are rejected, never chmodded. This assumes trusted same-UID
local processes, not protection against a hostile process racing filesystem changes.
SQLite uses a deliberately short synchronous 50 ms busy timeout. UUID signing generation, RSA private/public keys,
users, password verifiers, initial sessions and pending challenge references persist.
Passwords use asynchronous Node scrypt with random salts and timing-safe comparisons.
Opaque refresh/pending values are stored as SHA-256 verifiers, not plaintext.
JWTs use RS256, persisted kid, issuer/audience/client_id/sub/sid and five-minute expiry.
Sessions have a seven-day absolute expiry. JWKS is public; user reads omit secrets.

SDK 10.11.0 HTTP contracts cover create/list/get/empty identities, password rejection,
unverified-user rejection, client/API credentials, signed claims, key/user restart,
and separate database signing identity. Unverified sign-in never issues a session.
Local passwords require 12–128 Unicode code points without normalization. This is
an offline approximation, not WorkOS breach/tenant-policy parity. Bodies are capped
at 16 KiB. List lookup supports email, bounded limit, and forward `after` pagination.

## Dependency policy

JOSE `6.2.10` (published 2026-08-21) is pinned rather than reviewed `6.2.12`
(published 2026-09-05): the older maintained v6 RS256/JWK API passes unchanged pnpm
release-age policy. Install reported that the lockfile passes supply-chain policies.
No new release-age exception was added. `msgpackr-extract` execution is explicitly
denied via `allowBuilds: false`; existing esbuild approval is unchanged. Published
platform-node peers require Effect rc.112 and Redis >=5 <7; pnpm installs the peer,
but this provider imports no Redis client and starts no Redis service.

## Bootstrap identity contract

`startProvider` accepts the registry-allocated `port` and UUIDv4
`providerGeneration`. A new database adopts that generation; an existing database
with a different generation fails startup without replacing its signing identity.
The returned `providerGeneration` is authoritative persisted state. Explicit ports
never fall back when occupied; the listener remains loopback-only. Omitting these
options retains ephemeral-port/self-allocated identity behavior for isolated tests.
The launcher must pass both values and validate the response before publishing
paired mobile configuration. Restart, mismatch, occupied-port, and invalid-input
regressions run with the SDK suite.

### Launcher entrypoint

Run `node --experimental-strip-types packages/local-workos/src/cli.ts` with
`--database <absolute-path> --port <allocated-port> --provider-generation <UUID>`.
The launcher supplies the synthetic SDK credential through the child-only
`LOCAL_WORKOS_API_KEY` environment variable; the CLI neither generates nor persists
credentials and accepts no secret command-line option. It requires the reserved
local-only format `sk_test_local_` followed by 64 lowercase hex characters from
32 cryptographically random bytes. Ordinary real-WorkOS-shaped keys are rejected.
The same explicit local credential is supplied to the paired backend; no staging
credential fallback is permitted.

Before argument validation, the CLI snapshots this key into its Effect-local
configuration provider and deletes it from `process.env`, preventing later ambient
JavaScript reads and default inheritance by future child processes. This does not
wipe credential memory or erase the original OS process environment. Library
entrypoints do not delete environment values.

After the loopback server is serving, stdout emits one JSON readiness record with
`providerGeneration`, `issuer`, `clientId`, and `port`. The loopback-only
`GET /instance-info` endpoint returns those same public fields, allowing a launcher
to independently revalidate identity on resume without reading daemon logs. Startup failures emit a
generic diagnostic without input values. SIGINT/SIGTERM close the listener and
state, with a three-second shutdown deadline. The launcher still owns state paths,
credential persistence, process identity checks, and public-configuration publishing.

## Fixtures and boundaries

`provider.createIdentityFixture({email, provider: "GoogleOAuth" | "AppleOAuth"})`
is an asynchronous trusted in-process setup API for social-only identity metadata.
Await its returned Promise; it uses the same scoped SQL client as HTTP operations.
It stores no
password and exposes no HTTP fixture endpoint or working social authentication.
SDK identity reads retain the provider/type fields used by Recovery classification.
Forward cursor paging supports ascending/descending ID order; `before`, unknown
orders, nonexistent cursors, and invalid limits fail explicitly. Malformed bodies
return generic errors; declared bodies above 16 KiB are rejected before parsing.
Transport-enforced limits may close an oversized chunked request connection.

Full verification/reset/refresh belongs to #48: pending challenge references cannot
yet be completed, and unsupported grants fail explicitly. Session expiry is persisted
and access-token expiry is enforced by JWT consumers; refresh redemption/expiry
handling is not implemented here. No launcher, admin UI, app trust wiring, Tailscale,
deployment, or production credentials are included.
