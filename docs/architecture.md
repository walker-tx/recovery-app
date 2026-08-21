# Application architecture

This document is the durable architecture contract for the Recovery application. It defines invariants, defaults, and explicit triggers for adding complexity. Product requirements may change the design, but architectural exceptions should be deliberate rather than accidental.

## Rule levels

- **Invariant:** must hold unless superseded by an accepted architecture decision.
- **Default:** use this pattern unless the feature has a concrete reason not to.
- **Trigger:** evidence that justifies adding an abstraction, dependency, or layer.

## System boundaries

```text
Expo Router routes and layouts
              ↓
      mobile feature modules
              ↓
 shared UI and narrow platform adapters
              ↓
   Expo / React Native / Convex clients

public Convex functions
              ↓
 capability policy and model helpers
              ↓
       schema and database APIs
```

Dependencies point downward. Security is always enforced by the backend, regardless of mobile structure.

## Mobile organization

### Routes

`apps/mobile/src/app` is the route manifest and composition layer. Route files may own route parameters, navigation options, access decisions, route-level error boundaries, and feature-screen composition. Reusable feature behavior and UI live outside `src/app`.

Use Expo Router groups for navigation or access partitions, not to mirror source folders. As authenticated navigation grows, prefer `(auth)` and `(app)` groups guarded by `Stack.Protected`. Wait for Convex Auth restoration before evaluating guards. Route protection is UX, not authorization.

Keep nested navigators only where screens genuinely share navigation behavior. Retain typed routes and avoid type casts that bypass them.

### Features

Growing behavior is grouped by user capability:

```text
apps/mobile/src/
  app/
  features/
    daily-check-in/
      DailyCheckInScreen.tsx
      CheckInForm.tsx
      useCheckInDraft.ts
      checkInValidation.ts
  components/
    ui/
  theme/
```

Do not create empty folders. A route-local implementation becomes a feature module when it has multiple routes or consumers, independently testable behavior, substantial mixed concerns, or sections that change independently.

Feature names describe capabilities, such as `daily-check-in` or `support-network`. Avoid application-wide technical buckets and catch-all names such as `services`, `helpers`, `common`, or `utils`.

### Imports

- Routes may import features. Features never import routes.
- Shared UI never imports Router, Convex, or feature modules.
- Compose features at a route or screen boundary instead of coupling them.
- Do not deep-import another feature's internals.
- Use relative imports inside a feature and `@/*` across top-level mobile boundaries.
- Prefer direct file imports. Add a feature `index.ts` only when a narrow public API clarifies a real boundary.
- Do not create a shared workspace package until code has real consumers in multiple packages.

### UI primitives

Extract shared UI when repeated use needs one behavioral and accessibility contract, not merely to wrap a React Native component. Likely primitives include `Screen`, `Button`, and `TextField`. Keep theme tokens as plain TypeScript until a demonstrated requirement justifies a framework.

Shared controls own accessible names, roles, disabled and busy states, adequate touch targets, visible labels, and non-color-only error presentation. Preserve font scaling and validate important flows with VoiceOver and TalkBack.

## State ownership

Every value has one authoritative owner:

| State | Owner |
| --- | --- |
| Auth session | Convex Auth |
| Auth tokens | SecureStore through `ConvexAuthProvider` |
| Persisted and shared application data | Convex |
| Route identity and restorable navigation state | Expo Router |
| Input, modal, and transient interaction state | Nearest React component |
| Complex feature workflow | Feature-local reducer |
| Derived values | Computed during render |
| Durable draft or offline queue | Explicit product design |

Do not copy Convex query results into another cache or store. Preserve Convex query semantics: `undefined` is initial loading, `null` is legitimate absence, and an empty collection is a successful empty result.

Use discriminated unions when workflow states can otherwise contradict each other:

```ts
type OperationState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; code: string; message: string }
  | { status: "success" };
```

Use `useReducer` when transitions and invariants matter. Reducers remain pure; network calls, navigation, persistence, alerts, and analytics stay at the effect boundary.

## Forms and client libraries

Controlled React state and plain validation functions are the default for small forms. Client validation improves UX but never replaces Convex validators or backend invariants.

Libraries are welcome when they consolidate demonstrated complexity:

- **React Hook Form:** repeated dirty/touched/error plumbing, dynamic fields, conditional fields, cross-field rules, or multiple complex forms.
- **Zod or Valibot:** repeated nontrivial runtime schemas, unknown external JSON, or versioned persisted drafts. Choose one. Zod is the default absent a measured bundle reason.
- **Zustand:** substantial client-only state shared across distant routes that is neither Convex-owned nor Router-owned and has explicit reset/sign-out behavior.
- **Redux Toolkit:** multiple complex global client domains that demonstrably need middleware, action tracing, or multi-team conventions. Do not add RTK Query for Convex data.

Do not adopt a library for hypothetical scale. Record what concrete duplication, defect, or capability it removes.

## Client/server contract

Use generated Convex references directly from React hooks. Do not wrap ordinary Convex calls in a generic service or repository layer, because that hides reactive loading, pagination, cache, and generated typing semantics.

A feature hook is appropriate when it adds real orchestration, argument normalization, pagination composition, expected-error mapping, or reusable behavior while preserving Convex semantics. Imperative adapters are appropriate for non-React entry points and third-party SDKs.

Do not hand-maintain duplicates of Convex IDs, arguments, or return types. Keep UI-only view types local to the feature that owns them.

## Convex modules and functions

Keep the backend flat while it is small. Add one module per capability, such as `checkIns.ts` or `profiles.ts`. Split a module only when it develops independently changing concerns.

A registered function's file path and export name determine its generated `api` or `internal` reference. Treat moving a registered function or nesting it under a directory as a client/server contract change, not merely file organization. If a capability eventually needs submodules, name them for coherent capability areas such as `checkIns/history.ts`, not technical categories such as `queries/checkIns.ts`.

Public names express user intent, for example `listMine`, `getById`, `create`, `recordResponse`, and `archive`. Prefer specific domain mutations over generic patch endpoints.

Every public query, mutation, action, and HTTP action is an internet-facing boundary and must have:

1. Explicit argument validators.
2. An explicit return validator, including `v.null()` when appropriate.
3. Server-derived authentication.
4. Resource-level authorization.
5. Indexed, bounded data access.
6. A narrow client-facing result shape.

Use `getAuthUserId` directly in the first capability functions. Extract a narrow shared `requireUserId` helper only when multiple endpoints need the same sanitized unauthenticated-error contract. Keep resource ownership and membership checks capability-local; authentication does not imply authorization. Never accept client-provided owner IDs, roles, or authorization decisions as authority.

Keep short endpoint implementations direct. Extract plain TypeScript helpers for named invariants, authorization policies, deterministic transformations, or genuine reuse. When several registered functions need substantial shared capability logic, place capability-specific helpers under `convex/model`, such as `model/checkIns.ts`; do not create the directory or pass-through helpers in anticipation of growth.

Use internal Convex functions only for real backend-callable boundaries such as actions, HTTP actions, scheduling, cron, or intentional CLI/dashboard operations. Reuse, privacy, and testability alone call for a plain TypeScript helper, not an `internalQuery`, `internalMutation`, or `internalAction`.

## Data modeling and indexes

Use typed IDs for relationships. User-owned records normally store an owner derived by the server:

```ts
ownerId: v.id("users")
```

Indexes correspond to real query contracts and place equality-constrained ownership or tenancy fields first. Use `withIndex` to bound normal queries. Do not rely on unbounded `collect()` followed by application filtering. Use pagination for histories and collections that can grow.

Treat schema changes as deployments. For populated data, the repository default is a backward-compatible rollout: add an optional or compatible shape, update readers and writers, backfill in bounded batches, verify completion, and tighten the validator in a later deployment. Introduce migration tooling only when a real deployed backfill or multi-step transition requires it. Remove indexes only after all consumers have moved away from them.

## Transactions and side effects

One mutation owns one database invariant: authenticate, authorize, read preconditions, validate the transition, perform related writes, and return the result in the same transaction. Never split one invariant across client mutation calls. Each `ctx.runQuery` or `ctx.runMutation` invoked by an action is a separate transaction, so combine reads or writes that must observe one consistent state in a single internal query or mutation.

Mutations stay deterministic and do not call external services. External work uses durable intent and internal actions:

```text
public mutation → authorize → persist operation → schedule internal action
internal action → external provider → internal mutation records outcome
```

Design idempotency before adding retries. Persist stable operation identifiers and provider outcomes. Scheduled work does not inherit authentication; authorize the initiating request and let the worker re-read durable state.

## Errors and asynchronous UX

Use stable, sanitized structured errors for expected client-actionable failures. Use ordinary errors for unexpected defects. Never expose provider payloads, stack traces, tokens, or sensitive recovery information.

Query and render failures belong to scoped error boundaries. Mutation, action, and auth failures are awaited and caught by the initiating handler. Preserve user input after failure, prevent duplicate submission, and retry deterministic failures only after correction.

Distinguish initial loading, empty data, missing data, reconnecting with existing data, expected operation failure, and unavailable screens. Do not replace existing content with a spinner during brief reconnects.

## Testing contract

Introduce tests with substantive behavior rather than placeholder coverage. The first user-owned backend capability should add a colocated `convex-test` file, such as `checkIns.test.ts`, covering unauthenticated access, owner success, cross-user denial, missing records, invalid transitions, persistence, and public return shape. Add a shared `test.setup.ts` only when multiple tests need the same recursive module loading or backend test configuration. Exercise registered behavior through generated `api` and `internal` references; test deterministic policy and transformation helpers as plain TypeScript.

Add mobile interaction tests when forms, reducers, auth routing, error translation, or shared interactive primitives have stable behavior. Test through accessible roles and labels; avoid implementation-detail snapshots and deep Convex mocks. Keep a smaller real-backend smoke layer for behavior the Convex test harness cannot reproduce.

## Extraction and dependency triggers

Add an abstraction when existing code demonstrates at least one of these:

- Multiple real consumers need the same behavior.
- A module has multiple independent reasons to change.
- Routing, data orchestration, state transitions, and presentation are substantially interleaved.
- A named invariant needs isolated testing.
- Repeated defects justify automated enforcement.
- Unrelated changes repeatedly collide.

File length alone is not a rule. Do not introduce controllers, repositories, use-case layers, dependency injection, global stores, broad barrel exports, shared packages, or architecture plugins solely in anticipation of future scale.

## Architecture decisions

Create a lightweight ADR under `docs/decisions/` for difficult-to-reverse choices involving persistent data migrations, identity or authorization policy, offline synchronization, major external services, global state architecture, cross-package abstractions, or significant native dependencies. Include context, decision, alternatives, consequences, validation, and rollback. Routine implementation choices do not require an ADR.

## Sources

- [Expo Router authentication](https://docs.expo.dev/router/advanced/authentication/)
- [Expo Router protected routes](https://docs.expo.dev/router/advanced/protected/)
- [Expo Router route notation](https://docs.expo.dev/router/basics/notation/)
- [React: choosing state structure](https://react.dev/learn/choosing-the-state-structure)
- [React: extracting state logic into a reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer)
- [Convex best practices](https://docs.convex.dev/understanding/best-practices/)
- [Convex validation](https://docs.convex.dev/functions/validation)
- [Convex function names and nested modules](https://docs.convex.dev/functions/query-functions#query-names)
- [Convex internal functions](https://docs.convex.dev/functions/internal-functions)
- [Convex Auth authorization](https://labs.convex.dev/auth/authz)
- [Convex indexes](https://docs.convex.dev/database/reading-data/indexes/)
- [Convex schemas](https://docs.convex.dev/database/schemas)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex testing](https://docs.convex.dev/testing/convex-test)
- [AGENTS.md](https://agents.md/)
