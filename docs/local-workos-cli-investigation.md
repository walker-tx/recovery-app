# Local WorkOS CLI investigation

Status: research and handoff, not an implementation plan or completion claim. Recorded 2026-09-07. No GitHub updates, production actions, or mutations to existing development stacks were performed for this investigation.

## User direction

Replace the FoldKit developer console described by issue #51 with an Effect-TS CLI optimized for both human and agent operation. It should select the correct development stack when multiple Git worktrees are running. The user approved proceeding with this direction and including worktree-scoped Mailpit inbox list/read capabilities. Defer inbox waiting initially.

This note records the conversation and evidence; it does not silently replace the existing approved specification or issue acceptance criteria. The issue still describes the FoldKit UI and needs reconciliation through the authorized delivery workflow.

## Recommendation

- Extend existing local-provider tooling using `effect/unstable/cli` at the existing exact Effect RC version.
- Use Effect Solutions for orientation and the pinned package source/tests as API authority.
- Default target discovery to the current Git worktree; allow an explicit `--worktree` override.
- Resolve stack identity, provider generation, and endpoints through the existing registry, not remembered ports or branch names.
- Use a separate administration HTTP listener on an owner-private Unix-domain socket in the existing provider process. Do not expose its admin routes on the provider's TCP listener.
- Keep provider state owned by the existing provider services. Do not make the CLI a second ad hoc SQLite writer or another stack orchestrator.
- Make ordinary operation noninteractive, with explicit machine-output and failure contracts.
- Read captured email through the selected Mailpit instance's existing loopback API rather than extracting verification credentials from provider storage.

The socket recommendation assumes co-located macOS/Linux clients and the existing trusted-same-OS-user threat boundary. It is not a hostile-tenant isolation mechanism. Windows or genuinely remote administration would require reevaluation.

## Effect resource comparison

The two supplied resources are complementary, not competing frameworks:

- https://github.com/Effect-TS/effect/tree/main/packages/effect/src/unstable/cli
- https://www.effect.solutions/cli

The guide teaches `effect/unstable/cli`. At inspection, its beta installation instructions resolved to an older release than the provider's baseline:

| Package/channel | Observed version |
| --- | --- |
| `effect` RC and existing provider baseline | `4.0.0-rc.112` |
| Matching `@effect/platform-node` | `4.0.0-rc.112` |
| `effect` beta | `4.0.0-beta.107` |
| `effect` latest | `3.22.1` |
| Separate Effect-3 `@effect/cli` | `0.77.0` |
| Repository Node runtime used in probes | `24.16.0` |

Do not mix the separate Effect-3 CLI package or stable platform defaults into this Effect-4 tool. Registry tags can move. The inspected Effect main revision was `d5c7cd2c47b2b01523aaea48d2dd039b89b36114`.

## Executed experiments

All experiments used disposable synthetic state outside the repository. Final verification reran the following independently of the initial research-agent reports:

| Experiment | Observed result |
| --- | --- |
| Baseline Effect CLI | 22 subprocess cases passed |
| Always-machine output variant | 9 subprocess cases passed |
| Actual disposable linked Git worktrees | 6 checks passed |
| Loopback HTTP administration protocol fixture | 11 checks passed |
| Pinned Effect HTTP over Unix socket | Round trip, permissions, address, and scoped-cleanup assertions passed |

These are distinct contract proofs, not a unified integration suite against Recovery's running stack.

### CLI behavior

The baseline implemented fixture-only status, user listing, and guarded deletion. Checks covered nested-cwd discovery, explicit worktree selection, two isolated fixture identities, wrong-stack refusal, missing confirmation, help, invalid/missing/extra arguments, and timeout. Failed commands checked that the selected fixture was not mutated.

Observed details:

- Shared flags worked before, between, and after nested subcommands.
- Optional boolean flags required an explicit default in this RC; the first run exposed the missing-default mistake.
- Tested subprocesses used closed/piped stdin and did not prompt.
- SIGINT during a delay exited 130 with empty stdout/stderr.
- Timeout exited 2 under the prototype's error policy. This is not a claim that Effect assigns that exit code by default.
- Node 24.16.0 executed the machine variant's TypeScript directly without `tsx` or a build step.
- A final five-run warm-cache status measurement was 266.0, 270.8, 261.3, 267.9, and 270.9 ms; median 267.9 ms. This is end-to-end local invocation timing, not a cold-start or comparative benchmark.

### Machine-output trap and proof

A `--json` flag alone does not make Effect's default parser-error path machine-safe. Unknown arguments produced human help on stdout and diagnostics on stderr. `renderErrors: false` still permits help rendering.

A separate always-machine variant proved an adapter without introducing another argv parser:

- Command results use a dedicated stdout emitter.
- Framework help output is buffered and flushed only after successful command execution, so parser-failure help does not pollute stdout.
- Caught failures emit one allowlisted JSON error record on stderr with a nonzero exit.
- `CliOutput` produces an abbreviated JSON help/version representation.
- `CliConfig.builtIns` allows Help and Version only, disabling Wizard and other unnecessary built-ins.
- Root/leaf wizard requests failed immediately with closed stdin.
- An invalid-flag secret-like canary was absent from output.

This variant is not a finished output policy: it has generic error categories, abbreviated help, and no complete coverage of uncaught defects or every logging channel. Its console override also applies to handlers. Typechecking and linting were not performed on the throwaway TypeScript.

### Worktree discovery

The Git experiment verified that nested cwd and symlinked paths resolve to the owning worktree, siblings have distinct worktree roots/private Git directories despite sharing a common Git directory, and branch changes preserve discovery identity. Outside-checkout discovery failed. A nested separate repository resolved independently instead of inheriting the outer stack.

Recommended targeting contract:

1. Resolve the current or explicitly supplied worktree to its canonical root.
2. Look up that worktree's existing stack record.
3. Verify readiness and provider generation before administration.
4. Bind mutations to the expected target/generation on the server as well.
5. Refuse absent, stale, foreign, or ambiguous targets; never select the latest running stack as a fallback.

Every result should identify its selected stack. Discovery alone is not authorization, and a successful preflight cannot prevent a generation change before the subsequent mutation.

### Transport and mutation failures

The 11-check HTTP fixture exercised correct-target isolation, wrong-port/identity refusal before credential transmission, bad credentials, server-side identity rejection, redirect refusal, remote/userinfo/DNS-target rejection under the fixture's strict loopback policy, timeout, separate target operation, stale generation, generation change between preflight and mutation, and a lost response after a committed mutation.

The last case demonstrates why uncertain writes must not be blindly retried: the fixture committed the deletion and then dropped the response. A transport error did not mean that no mutation occurred.

This comparison fixture used loopback HTTP and synthetic bearer credentials. It did not implement the recommended socket integration or test real provider authorization.

### Unix socket proof

Pinned Effect server/client APIs successfully exchanged HTTP over a Unix socket:

- `NodeHttpServer.make(createServer, { path })` owns the socket listener.
- A scoped Undici agent with `connect: { socketPath }` supplies `NodeHttpClient.Dispatcher` to `NodeHttpClient.makeUndici`.
- HTTP status 200 and the expected synthetic body were asserted.
- Parent directory mode 0700 and socket mode 0600 were asserted.
- Server address was the expected `UnixAddress`.
- Scoped close removed the socket before fixture-directory cleanup, so cleanup could not mask a missing unlink.
- Outer scope removed its synthetic directory.

No browser unlock, admin bearer distribution, or additional TCP admin port is necessary under the stated OS-account trust boundary. Keep socket paths short for macOS/Linux limits; crash-stale sockets still require ownership-checked handling rather than unconditional unlink. The proof did not test cross-user OS denial, crash recovery, Windows, or a real provider admin route.

## Inbox direction

Keep the actual authentication flow intact:

```text
Native app initiates verification/reset
  -> Recovery backend sends its normal email
  -> selected stack's Mailpit captures it
  -> CLI lists/reads that captured message
  -> human or native automation enters the code/opens the link normally
```

Initial scope is list/read only:

- List returns message ID, recipient, subject, and timestamp without body previews or credential extraction. Metadata may still be sensitive: subjects can contain codes or links, so this is not a guarantee of credential-free output.
- Explicit read returns message text and may reveal the synthetic verification code or reset link it contains; these are sensitive outputs and must not enter routine status/logging.
- Resolve the inbox through the selected stack's allocated Mailpit endpoint; do not assume port 8025 or search sibling inboxes.
- Do not add a socket proxy merely for uniformity: Mailpit already has a loopback HTTP API.
- Do not mark email verified, reset passwords, manufacture sessions, or trigger email delivery as a side effect of inbox reads.

A future bounded wait operation needs a before-action inbox boundary so tests do not consume old messages. The subsequent Mailpit runtime spike below tested the pinned list/read APIs and pagination behavior; real stack-registry wiring remains unproven. Example inbox commands discussed in chat are proposals, not installed commands. The user subsequently approved parsed reads marking messages read. Inbox listing is nonmutating; the overall list/read capability must not be described as strictly read-only.

## Mailpit runtime spike (2026-09-07)

The user authorized a disposable two-instance integration spike before final design approval. Mailpit reported `v1.31.0`, compiled for darwin/arm64. The candidate client used Effect, platform-node, and platform-node-shared `4.0.0-rc.112` on Node `24.16.0`. Installation reused 23 cached packages, downloaded none, and did not approve build scripts.

**Final result: 27 runtime checks passed, zero failed; all owned Mailpit children and HTTP fixtures were stopped.** The initial suite was 26 passed/1 failed; that failed timestamp assumption was investigated separately and its evidence retained, not silently discarded.

### Verified API behavior and design impact

| Finding | Runtime evidence / implication |
| --- | --- |
| HTTP send | Recovery-shaped `POST /api/v1/send` returned 200 and a storage ID; separate explicit databases retained separate synthetic inboxes |
| List projection | Wire summaries contain `Snippet`, including body codes; the candidate's allowlisted ID/To/subject/time projection excluded snippets and attachments |
| Metadata sensitivity | A synthetic subject canary remained in projected subjects; metadata is not guaranteed credential-free |
| Parsed-read mutation | `GET /api/v1/message/{id}` changed unread to read, including with `?markRead=false`; a client-side oversized-response refusal did not undo that server effect |
| Raw read | `GET /api/v1/message/{id}/raw` returned MIME source without marking read; decoded text without that effect would require MIME parsing, which was not added |
| Text provenance | HTML-only ingestion produced Mailpit-derived `Text`; it does not prove an original plain-text MIME part. Multipart reads preferred the supplied text. No fixture asset requests occurred |
| Recipient matching | Quoted `to:` search matched longer addresses and display names, not Cc-only recipients. `%` broadened matches despite URL encoding |
| Candidate filter | Exact case-insensitive comparison of structured To addresses within one bounded ordinary-list page excluded name/prefix matches without inserting input into Mailpit's search language |
| Page semantics | Empty filtered pages can still return a next cursor. Cursors reject another target/filter. They are best-effort pagination, not a stable snapshot |
| Zero limits | Raw list `limit=0` returned every fixture message despite `start=2`; zero-limit search returned none. The candidate refused 0 and values over 100 before requests |
| Arrivals and offsets | Inserting mail between offset pages caused a duplicate. A timestamp boundary is not a snapshot and cannot fix deletion/tie-order behavior |
| Timestamp formats | A fractional-seconds `Z` cutoff failed to exclude a later message in this binary. Equivalent `+00:00`, a seconds-only `Z` form, and epoch milliseconds worked in the focused probe. The internal parser failure mode was not instrumented; do not overclaim why the cutoff was ineffective |
| Instance information | `/api/v1/info` had database path/version/stats, not stack UUID, tenant ID, or label. The label appeared only in `/api/v1/webui` |
| Target failures | Wrong expected database refused before returning mail data; foreign IDs failed in the sibling inbox; an injected ownership change discarded a response; stopping one child left its sibling available |
| Transport bounds | Redirects were refused without contacting their destination; incomplete and oversized/chunked responses obeyed client deadline/byte limits |
| Effect-specific limit | `HttpIncomingMessage.MaxBodySize` did not bound `NodeHttpClient.makeUndici`'s `response.text` in this RC. The candidate used a streaming byte cap before buffering/JSON decoding instead |

Source inspection of the pinned Mailpit handlers additionally found that search materializes all matching summaries before slicing, positive limits have no handler maximum, and ordering is `Created DESC` without an explicit unique tie-breaker. A small search response limit therefore does not establish bounded server-side search work. These are source findings, distinct from measured allocation or concurrency tests.

### Candidate adaptation and approved read-status choice

The evidence supports ordinary bounded-list pages with an exact local To-address filter, safe field projection, explicit best-effort continuation, and streaming response limits. This does not add an all-pages search, snapshot store, raw-body renderer, or a second inbox service.

**User-approved decision:** `inbox read` uses normal Mailpit parsed-read semantics and marks the message read, with the effect disclosed in help/results. A failed client response may still have changed the unread flag. Do not restore unread afterward: that is a separate racy mutation. List remains nonmutating. No raw-MIME parser is added solely to preserve unread state. Reading does not initiate verification/reset or change authentication state.

The design records the verified API facts and the approved read-status decision. Its prior no-blocker document review predates these runtime findings. The user subsequently approved the complete written CLI revision; issue-backed scope reconciliation and implementation remain separate workflow steps.

### Reproduction and limits

Retained temporary workspace: `/tmp/recovery-mailpit-spike.4dxvVU`. It contains `client.mjs`, `harness.mjs`, `test.mjs`, `discover.mjs`, `cutoff.mjs`, exact dependency metadata/lockfile, `README.md`, `results-initial.json`, and final `results.json`. Synthetic databases/logs remain under that owned directory. Temporary paths may disappear during cleanup.

```sh
mise exec -- mailpit version --no-release-check
mise exec -- node /tmp/recovery-mailpit-spike.4dxvVU/test.mjs
mise exec -- node /tmp/recovery-mailpit-spike.4dxvVU/cutoff.mjs
```

The harness uses the installed pinned binary, private temporary directories, explicit independent database paths, allocated loopback HTTP/SMTP ports, a minimal child environment and temporary HOME/cwd. Version checking and SMTP reverse DNS were disabled. No relay configuration or live inbox was used. Local asset traps saw zero requests, but external networking was not OS-blocked or packet-captured.

Database-path checks plus a synthetic ownership callback are not actual Recovery registry integration, OS listener attribution, or cryptographic instance identity. Cursor protection is validated local bookkeeping, not an authenticated capability. No native UI/email-flow coverage, production command wrapper, TypeScript/lint acceptance, raw MIME parser, inbox waiting, or attachment feature is claimed.

Pinned sources:

- [API query bounds and date parsing](https://github.com/axllent/mailpit/blob/v1.31.0/server/apiv1/api.go)
- [Message list/read storage behavior](https://github.com/axllent/mailpit/blob/v1.31.0/internal/storage/messages.go)
- [Search semantics and materialization](https://github.com/axllent/mailpit/blob/v1.31.0/internal/storage/search.go)
- [Raw/parsed message handlers](https://github.com/axllent/mailpit/blob/v1.31.0/server/apiv1/message.go)
- [Info and presentation metadata](https://github.com/axllent/mailpit/blob/v1.31.0/server/apiv1/application.go)
- [Send API](https://github.com/axllent/mailpit/blob/v1.31.0/server/apiv1/send.go)

## Existing implementation and preserved boundaries

Read-only inspection found the more developed implementation in the `console-51` worktree, branch `feat/51-foldkit-console`, at `c7486c1` during inspection. References below are relative to that implementation, not a guarantee about this worktree's current files:

- `packages/local-workos/src/cli.ts`: existing Effect provider-startup CLI.
- `packages/local-workos/src/http.ts`: WorkOS-compatible endpoints, not a completed separate admin API.
- `packages/local-workos/src/provider.ts`: reusable provider operations.
- `packages/local-workos/console/entry.ts` and `console/commands.ts`: injected console adapters, not a default live admin transport.
- `scripts/stack-registry.cjs`: canonical worktree ownership, stack UUIDs and separate provider-generation UUIDs.
- `scripts/stack-runtime.cjs` and `scripts/stack-readiness.cjs`: selected-stack runtime/status and allocated-endpoint readiness.

Do not equate UI test coverage with a connected administrative backend. Existing registry status takes locks/transactions and is not necessarily filesystem-write-free.

Preserve the approved domain boundaries:

- Deleting provider users does not silently delete Convex data, device storage, or inbox state.
- Session revocation prevents refresh; already-issued JWTs may remain accepted until expiry.
- Provider setup does not create application profiles or inject sessions.
- User deletion retains explicit selected-email/target confirmation; the prototype's simpler fixture guard is not the final product contract.
- Whole-stack destruction remains separate from ordinary provider administration.

## GitHub tracking and authentication findings

Authenticated issue inspection later confirmed #51 open and still scoped to FoldKit; its declared dependency #49 was closed. No existing PR was returned for the inspected console branch. These are observations at lookup time, not proof that all dependency code is integrated. No issue, Project, PR, or authentication-configuration writes were made.

The configured personal-account Project #3 could not be resolved using the designated App installation token. Permission inspection found that the App and installation granted repository Projects access, but the wrapper's narrowed token omitted it. An in-memory test requesting repository Projects read access still returned no visible personal projects and could not resolve #3.

GitHub's REST documentation explicitly excludes App installation tokens, App user tokens, and fine-grained PATs from the user-project endpoint. The tested GraphQL query also failed after the missing repository grant was added. Therefore, simply adding that grant to the wrapper was not demonstrated to solve access. Do not generalize this into a claim that the owner cannot authorize another supported authentication route.

The user explicitly authorized accessing the Project as themselves. That route was not attempted because the active higher-priority agent instructions still prohibited personal-credential fallback. Earlier chat wording incorrectly suggested that conversational approval alone would remove that restriction. No personal token was retrieved or used, and no credentials are recorded here.

Tracking/implementation preflight remains unresolved. The user subsequently requested this local findings record; that does not authorize silently skipping the delivery gate.

Authentication references:

- https://docs.github.com/en/rest/projects/projects#get-project-for-user
- https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects

## Retained disposable artifacts

These paths existed when this note was written. They are temporary local artifacts, not committed or durable storage, and may disappear during cleanup:

| Directory | Contents |
| --- | --- |
| `/tmp/effect-cli-spike.fbFWZl` | Baseline and machine TypeScript variants, tests, captured results, README and limitations |
| `/tmp/recovery-worktree-discovery.OJqne7` | Repeatable real-Git-worktree discovery proof |
| `/tmp/recovery-admin-transport.5rIKhb` | HTTP identity/generation/failure-contract proof |
| `/tmp/recovery-uds-spike.6KBaUV` | Effect socket proof, exact dependency pins, lockfile and README |

From a Mise-enabled Recovery checkout, while those artifacts and their dependencies remain available:

```sh
mise exec -- node /tmp/effect-cli-spike.fbFWZl/test.mjs
mise exec -- node /tmp/effect-cli-spike.fbFWZl/machine-test.mjs
mise exec -- node /tmp/recovery-worktree-discovery.OJqne7/probe.mjs
mise exec -- node /tmp/recovery-admin-transport.5rIKhb/probe.mjs
mise exec -- node /tmp/recovery-uds-spike.6KBaUV/proof.mjs
```

Run baseline and machine CLI tests sequentially because they share synthetic fixtures. The baseline uses the disposable installation's `tsx`; the machine variant runs on Node's native TypeScript stripping. The initial baseline install encountered pnpm build-script policy warnings; no build scripts were approved. The retained socket proof was installed from cached packages with scripts ignored.

No full repository check was claimed for the throwaway experiments. Further delivery requires reconciliation of the approved specification/issue, safe ownership of an implementation branch, real admin/inbox integration tests, and the repository's normal verification and review safeguards.
