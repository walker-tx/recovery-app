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
