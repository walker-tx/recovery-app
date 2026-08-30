---
name: audit-design-artifact
description: Use when auditing, implementing, or reviewing Recovery mobile screens against the Claude Recovery Tracker design artifact, when a page is reported as visually misaligned, or before claiming an artifact-backed screen matches its design.
---

# Audit the Recovery design artifact

## Overview

Audit the complete reachable flow, not one screenshot or one string. Combine rendered evidence, source/state inspection, honest product behavior, and executable screen contracts.

## Reference artifact

- URL: `https://claude.ai/code/artifact/00dd61ff-dd96-4c83-abed-5e88ffbd2638`
- Title: `Recovery Tracker App Design`

Invoke `inspect-claude-design-artifacts` to retrieve it. A headless `403` or `Page not found` is inconclusive; use that skill's clean headful Chrome workflow and bundled inspector script. Require its four evidence outputs before trusting retrieval: `artifact.txt`, `artifact.png`, `page.png`, and `metadata.json` with response and resolved-frame evidence. Keep transient captures under `/tmp`.

## Current correspondence map

Resolve `REPO_ROOT="$(git rev-parse --show-toplevel)"` and `MOBILE_ROOT="$REPO_ROOT/apps/mobile"`. Paths in this skill are relative to `MOBILE_ROOT`, so the workflow is stable whether Kit starts at the repository or mobile root.

| App screen | Route or owner | Artifact section |
| --- | --- | --- |
| Welcome | `src/app/(auth)/index.tsx` | `RECOVERY TRACKER / Count the days, not alone` |
| Email signup | `src/app/(auth)/sign-up.tsx` | `NEW ACCOUNT / Your email and a password` |
| Email verification | `src/app/(auth)/verify-email.tsx` | submitted email / `Six digits, from your inbox` |
| Returning sign-in | `src/app/(auth)/sign-in.tsx` | `WELCOME BACK / Sign in` |
| Recovery request | `src/app/(auth)/forgot-password.tsx` | `PASSWORD / Reset it` |
| Recovery sent | state of forgot-password screen | `Check your email` |
| Password reset | `src/app/(auth)/reset-password.tsx` | account label / `Set a new password` |
| Profile onboarding | `src/app/(onboarding)/profile.tsx` | `LAST STEP / What should we call you?` |
| Authenticated fork | `src/app/(app)/home.tsx` | `YOU'RE IN, MARCUS / Where do you want to start?` |

Re-inventory `src/app` and `*screen.tsx` every time. The table is a starting map, not permission to ignore new routes or states.

## Scope rules

- Email/password is the implemented authentication scope. Apple and Google controls in the artifact do not require implementation until explicitly requested.
- Authenticated Home must not show fake group or invite actions. Treat it as pending until those destinations are functional.
- System UI and unsupported future flows are not app-owned screens.
- Backend truth overrides screenshot wording when exact copy would lie. Document the divergence. Current examples include manual reset tokens instead of links and returning to sign-in after password reset instead of creating a session.
- Never add an inactive control, fake countdown, decorative resend action, or dead navigation solely to match the board.

## 1. Inventory the full flow

List every implemented route, screen component, and user-visible state, including pending, success, cooldown, validation, recovery, retry, missing-configuration, and authenticated states. Map each to an artifact board or label it `no artifact correspondence`.

Extract exact artifact headings, copy, actions, line breaks, and state transitions from the full rendered text. Do not infer the entire flow from the visible board crop.

## 2. Gather evidence

For every mapped screen collect, when reachable:

- artifact frame or focused crop;
- current implementation screenshot at a comparable viewport;
- rendered text and accessibility names;
- source component, route plumbing, state transitions, and backend capability behind every action.

Classify evidence explicitly:

- **Rendered comparison** — both design and implementation were captured.
- **Source-to-artifact** — protected or stateful implementation could not be rendered.
- **Unverified geometry** — board scaling or clipping prevents exact spacing claims.

Never call a source-only audit a pixel match. Arrange legitimate local state or fixtures before fine-grained visual correction; do not bypass authentication.

## 3. Compare by impact

Review each screen in this order:

1. User-visible behavior and reachable actions.
2. Heading hierarchy and defining copy.
3. Open composition versus card/sheet structure.
4. Field treatment, button order, password visibility, and keyboard flow.
5. Accessibility names, focus, live announcements, disabled/busy state, and touch targets.
6. Typography, line breaks, spacing, color, border, and shadow.

Separate definite mismatches from clipped geometry, unsupported functionality, and preference. Rank Critical/Important/Minor rather than producing a flat style list.

## 4. Correct with contracts

Before production changes, add or update the narrowest meaningful source or behavior contract and verify it fails for the expected reason. Preserve auth security, normalization, submission guards, rate limits, token handling, and navigation history.

After each flow segment:

```bash
mise exec -- node --test <targeted tests>
mise exec -- pnpm --filter @recovery/mobile run check
git diff --check
```

At the end run all mobile tests and a fresh independent source-to-artifact audit. Render reachable screens again when preview support is available.

## Completion report

Report:

- screens audited and evidence level for each;
- corrections made;
- unsupported or blocked artifact actions and why;
- exact verification commands and counts;
- whether Authenticated Home, Apple, Google, or resend behavior remains deferred.

Do not claim full alignment while a known artifact-backed state is unreviewed.

## Common mistakes

- Auditing only the page named by the latest complaint.
- Matching words while missing the defining line break or composition.
- Using stale Metro output as a rendered verification.
- Treating source contracts as visual screenshots.
- Reintroducing dishonest link/session language to copy the artifact literally.
- Forgetting sent, cooldown, error, and correction states.
