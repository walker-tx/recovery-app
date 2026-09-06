# Local-stack route evidence and retirement contract

## Authority and scope

This specification refines the [approved provider design](https://github.com/walker-tx/recovery-app/blob/0a4444f67ea5e533a6f950008a0acb97741996e7/docs/superpowers/specs/local-workos-development-provider-design.md#worktree-safe-stack-lifecycle) for the narrow [#49](https://github.com/walker-tx/recovery-app/issues/49) contract supporting [#47](https://github.com/walker-tx/recovery-app/issues/47). [#58 recommendation and approval](https://github.com/walker-tx/recovery-app/issues/58#issuecomment-5560048068) authorize contract-first work only. It does not authorize the administration feature, route mutation, destructive execution, or reservation release. GitHub owns execution tasks.

## Observed mechanism, not inferred ownership

Source baseline: main `3543792` for `scripts/zero-tailnet.sh` and `scripts/stop.sh`; published PR55 `06ef7d245ebd7657f48ec862afcfc50c92261afd` for `scripts/stack-registry.cjs`, `scripts/stack-runtime.cjs`, and `scripts/stack-destruction-preflight.cjs`. No live Serve state was queried.

The legacy publisher records a worktree-local `.recovery-tailnet` directory containing `host`, `ts-command`, `added-routes.tsv` (HTTPS listener and proxy target), and `tcp-route.tsv` (Metro TCP listener and forwarding target). It writes intent before applying Serve changes and then checks the HTTPS root handler and TCP forward in `tailscale serve status --json`. The stop script compares those targets before scoped removal, verifies absence afterward, and retains incomplete/changed route bookkeeping on failure.

These are useful intent and target checks, **not authoritative whole-stack ownership**: the ledger has no stack UUID/provider generation, no complete inventory declaration, no allocation revision or retirement receipt, and no host-wide coordination. A matching target can have been recreated by another owner. Missing files cannot distinguish never-published from lost bookkeeping; partial startup can leave an intent without a route or only some routes applied. A worktree path or saved CLI path is not sufficient authority. Legacy routes remain unmanaged/unknown for #47; do not adopt them merely because their ports or targets match.

PR55 adds a host registry with stack UUID, canonical worktree, provider generation and reserved ports, and lock-protected reservation bookkeeping. That is not yet a Serve ownership registry. Its read-only destruction preflight accepts a fixture `state: absent`, `scope: whole-stack`, and matching identity tuple. Its production runtime intentionally supplies no route adapter. Those fields alone cannot establish completeness, freshness or retirement. `destructionImplemented` and `reservationReleaseAllowed` remain false. This contract does not promote fixtures into production evidence or change those flags.

## Authoritative evidence boundary

#49 owns the route ownership records and their read-only interpretation; #47 owns stack identity, lifecycle coordination and the final whole-stack retirement decision. The route owner must publish durable ownership intent before any future route allocation, reconcile the actual Serve result, and keep unresolved attempts represented. Do not add a second stack identity store or infer route ownership from process/port reservations.

Evidence is authoritative only when all of the following can be verified:

- The canonical existing worktree, stack UUID and provider generation match #47's current reservation. Missing/moved/deleted worktrees and old generations block; branch names and lexical path aliases are not identities.
- The host/Serve instance is identified and the complete owned route inventory is bound to that same identity tuple and an ownership revision. Inventory covers every stack service and every attempted allocation, including interrupted publication; an explicit initialized empty inventory is distinguishable from missing state.
- Every route has an unambiguous configuration key (host, protocol, listener, and exact handler path where applicable), expected target and relevant configuration, plus allocation identity/revision. HTTPS handler ownership does not imply ownership of its entire listener or sibling handlers. TCP forwarding is a separate resource.
- A successful, complete, supported Serve observation is reconciled against that inventory. Parse failures, unsupported configuration shapes, read errors, conflicts, pending intents, missing records or unverifiable coordination produce **unknown/blocking**, not an empty inventory or no-routes. Extra routes that could belong to the stack but lack ownership provenance also block; unrelated routes are preserved, not adopted.
- The evidence identifies its observation and inventory revision and whether coordination was held. A timestamp or TTL alone is not freshness. A standalone read-only observation is diagnostic, never a transferable deletion capability. No read path repairs, creates, adopts, retires or removes resources.

A known-empty result requires positively verified initialized whole-stack inventory, no pending allocation/retirement, and complete current reconciliation. Route absence in Serve alone is not proof of a complete owned inventory. Unknown must carry a sanitized reason and an actionable ownership-investigation step without credentials, raw environment or tokens.

These are semantic requirements, not a frozen JSON fixture schema. Select the adapter representation only with the actual coordinated publisher/ledger implementation and its consumer. No unused adapter or executable retirement API is introduced here.

## Coordination and deletion-time checks

All cooperating publishers, route stoppers and future destructive callers must use one host-wide Serve coordination domain in addition to per-stack lifecycle exclusion. #47's registry transaction alone does not cover Serve read/modify/write. Define and enforce one lock order before integrating these callers; no caller may acquire these domains in the opposite order. A read-only preflight does not acquire or manufacture a retirement transaction.

Within the future coordinated operation, before each effect and again after observations:

1. Re-read the current reservation and validate canonical worktree, stack UUID, provider generation and operation ownership against the originally confirmed target. Do not create a missing reservation or silently switch to a replacement target.
2. Validate the complete inventory, its revision, pending intents and the exact current Serve configuration for the selected route. Recheck the route allocation identity as well as its target; equal target after replacement is not sufficient ownership.
3. Remove only the owned configuration key with supported scoped operations. Never reset global Serve, stop unrelated services, remove sibling handlers/listeners, or use Funnel. If the CLI cannot safely express that scope, block.
4. Read back the resulting complete configuration, verify that exact allocation is absent and unrelated configuration is unchanged, and persist the verified outcome before proceeding.

Cooperative locking cannot serialize manual or foreign Serve writers. Target comparison plus locking must not be claimed to defeat an uncoordinated replace-with-the-same-target race. If exclusive coordination or stronger supported configuration identity cannot be established, retirement remains unknown/blocking; do not invent a Tailscale compare-and-swap capability. The broader design's trusted-local-process boundary does not waive this concurrency limitation.

On crash, timeout, changed identity/target/revision, incomplete reads, or uncertain effects, retain reservation and unresolved ownership intent. Do not auto-reclaim another operation's lock. Retry only after bounded ownership reconciliation; a retry cannot classify an uncertain deletion as successful solely because a later read is empty. Report each route as verified retired, verified never allocated, or unresolved, with remaining domains not attempted rather than complete.

## Retirement handoff and reservation release

#49 must supply durable retirement evidence bound to the same worktree/stack/generation, coordinated operation and inventory revision. It must account for every owned or attempted allocation, include verified post-removal observations (or positive never-allocated proof), contain no pending/uncertain entries, and attest complete inventory coverage. Partial successes remain recorded; the receipt is not a bearer authorization.

#47 consumes this evidence only while maintaining lifecycle exclusion and host coordination through the final identity/revision checks and reservation release, so no publisher can allocate a new route between proof and release. Release also requires independent completion of every other whole-stack domain (owned processes, ports, provider state/keys, local Convex data and Mailpit state). Route retirement alone never authorizes release. A changed/missing reservation, replaced generation, incomplete storage teardown or lost coordination blocks release even after all routes were removed. Bookkeeping must retain enough retirement provenance for interrupted-operation investigation rather than deleting the only evidence first.

## Validation boundary

Future implementation acceptance must cover missing/stale/partial ledgers; explicit initialized empty inventory; interrupted publication; moved worktree and changed generation; malformed/unsupported Serve output; multiple HTTPS handlers and TCP routes; foreign target or equal-target reallocation; concurrent publication/retirement; partial removal and failed readback; crash/retry; and replacement reservation before release. Prove sibling routes and unrelated previews remain unchanged. Fixtures prove policy only. Separately authorized live proof is still required for CLI scope, coordination and two-stack isolation; this documentation-only delivery performs none.

Current consequence: #47 can consume this reviewed semantic contract for design, but production route evidence remains unavailable. Whole-stack executable teardown and reservation release stay blocked until the actual ownership mechanism satisfies it and receives its own implementation review and execution authorization.
