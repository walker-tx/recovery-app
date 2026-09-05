# Counts product design

## Status and authority

The user approved the consolidated product design on 2026-09-05 and subsequently approved publishing the six-leaf issue hierarchy based on this specification. Issue publication and placement on the Recovery App Project are authorized. Starting implementation, merging, and deploying require separate authorization. This is a product specification, not an implementation plan; executable scopes and acceptance criteria belong in authorized GitHub Issues.

Sources:
- Original epic and five draft stories: session `s-1788119991167-7214-1`, including generation 87.
- Design artifact: https://claude.ai/code/artifact/b4d70f61-e317-44d3-8127-d88b9733440a
- Executable scope and dependencies: [Counts issue hierarchy #10](https://github.com/walker-tx/recovery-app/issues/10).

The approved reconciliation recorded here supersedes conflicting story or artifact text. Otherwise the artifact is the newer design baseline and compatible original requirements remain. Repository instructions and `docs/architecture.md` govern implementation architecture. The artifact was freshly retrieved successfully during reconciliation; inspect it again for implementation and visual verification rather than relying on prose or temporary captures.

## Purpose and scope

Counts gives people in recovery quiet, motivational evidence of elapsed time for freely named substances or behaviors. Counts is the first meaningful authenticated capability. Users can create multiple private Counts, view elapsed time and milestones, edit, manually order, and permanently delete them. Data belongs exclusively to its authenticated owner and synchronizes across signed-in devices.

There is no Reset, Correct, relapse or streak history, archive, undo, category, description, icon, color, time-of-day input, or custom milestone schedule. Deferred goals include shareable Counts, widgets, visual customization, notifications, next-milestone progress, translated interface copy, and persistent offline storage. Sharing permissions and behavior are not designed or promised for this release.

## Navigation and visual contract

Four tappable tabs appear in order: Counts, Today, Read, You. Today and Read contain their respective titles and `Coming later.` only. You remains the account/settings destination; Counts does not duplicate those controls or introduce new account capabilities. Use `Counts` as the product noun and `a Count` for one item, never `Your counts` as the home title.

Empty Counts has the central `Create your first Count` action and neither corner Add nor Reorder. This is the only action in its content area, not the entire screen; tabs remain available. Privacy copy is `Your Counts are private to you.` Retain the artifact’s multiplicity explanation without promising sharing. A populated list has separate top-right Add and Reorder controls.

Follow the artifact’s light off-white surfaces, dark typography, muted slate-blue accents, generous whitespace, flat rows and hairline separators, compact milestone pills, and outlined bottom Edit action. The leading elapsed numeral dominates subordinate units. Match actual artifact geometry, typography, spacing, and states during implementation; this description is not visual-fidelity evidence. Respect safe areas, Dynamic Type, screen readers, keyboard avoidance, touch targets, and Reduce Motion. Native interactions take platform limitations into account rather than imitating impossible controls.

## Create and names

Create is a full-screen `New Count` form with exactly Name and Start date. Save is inactive until both a trimmed nonblank name and a date are present and valid. Use the native OS date picker with a maximum of today; future dates cannot be selected. Do not introduce a client-facing future-date rejection state. Server validation still enforces valid input.

Names contain 1–100 user-perceived characters (Unicode grapheme clusters) after trimming outer whitespace. Preserve spelling, capitalization, punctuation, accents, and internal spacing. Reject over-limit names with `Use 100 characters or fewer.` Never silently truncate stored names.

Duplicates are allowed. While typing, show a nonblocking notice naming an existing matching Count and its localized start date. It never disables Save or requires confirmation. Match capitalization-insensitively and recognize canonically equivalent Unicode spellings; trim outer whitespace for matching. Do not fuzzy-match or remove accents: `Cafe` and `Café` differ, as do `Drinking` and `Alcohol`.

Successful creation returns to Counts with the new Count at the top and already counting. No success toast, notification, or optional `Just added` hint. Failed saves preserve both inputs and allow retry using non-blaming copy.

## Time and unit expression

A selected date means midnight in the device’s current time zone, converted to one stored UTC instant. Do not retain the originating zone. Format the Started/since date using the viewing device’s locale and current zone; a date shift after travel is accepted. Do not add zone labels, explanatory footnotes, or help text to the interface.

Use UTC for calculations so travel cannot alter elapsed readings or milestone eligibility. Days are exact 24-hour durations and weeks are seven days. Calendar months and years are anniversaries of the stored instant, clamped to the final day of shorter months. Calendar milestones may fall at a local hour other than midnight.

Each Count retains its own largest-unit setting: Hours, Days, Weeks, Months, or Years; default Days. The same setting drives list and detail. Units above the selection roll into it. Readings run through minutes, keep zero leading and intermediate units, never show seconds, and update at minute granularity; drift inside a minute is accepted. The artifact examples establish these unit sequences:
- Hours: hours, minutes.
- Days: days, hours, minutes.
- Weeks: weeks, days, hours, minutes.
- Months: months, days, hours, minutes.
- Years: years, months, days, hours, minutes.

Thus weeks are a selectable expression, not an intermediate unit in calendar month/year readings. Units is reached from detail via the artifact’s full-screen picker.

## List, detail, and milestones

The list follows persisted manual order, not name, date, or duration. Each row shows name, full selected-unit elapsed reading, localized since date, and latest milestone when present. Long names truncate to one line with an ellipsis before the pinned milestone badge. Detail shows the full name over as many lines as necessary without squeezing the elapsed reading.

Detail contains name, elapsed reading, Units, latest milestone when present, Started date, Edit, and Delete. Edit is the sole bottom-rail action and also appears in the header overflow menu. Delete exists only in that menu.

Milestones are 30, 60, and 90 exact elapsed days; six calendar months; one calendar year; and every additional calendar year. Only the latest achieved milestone appears. English labels are `30 days`, `60 days`, `90 days`, `6 months`, `1 year`, `2 years`, and so on. Localize displayed numbers and dates using the device locale; interface text is English. User-entered names may use any language.

Before 30 days, omit the badge and Latest milestone label entirely and close the layout gap. The badge persists until replaced by the next achieved milestone, except that editing the start date recalculates it. No milestone notification, animation, interstitial, confetti, dismissal, history, or next-milestone progress.

## Edit and discard

Reuse Create’s full-screen layout, titled `Edit Count`, with existing values. Apply the same validation and duplicate notice, excluding the Count being edited. Enable Save only when valid and different from the original values. Editing does not change list position or units.

If the date field is unchanged, preserve the exact stored instant, even after travel. A different selected date is interpreted as current-device local midnight and converted to UTC. Changing it recalculates elapsed time and milestone; no reset/history record is created. Success returns to detail without a toast; failure retains entered values and permits retry.

Cancel/back leaves immediately when unchanged. Otherwise Create and Edit share a native alert:
- Title: `Discard changes?`
- Message: `Your changes haven’t been saved.`
- Actions: Keep editing and destructive Discard.

Keep editing preserves the form. Discard returns to Counts from Create or detail from Edit without saving. Apply to Cancel and back navigation, including system-back gestures where supported. Restoring original field values removes the need for confirmation.

## Reorder and delete

Reorder enters an explicit Done/Cancel mode. Show drag handles, hide Add, and disable opening detail. Support drag plus accessible Move up/Move down actions. Rows shift smoothly, respecting Reduce Motion. Done saves and exits; Cancel abandons changes. Back asks for discard confirmation if the order changed. Prevent further moves and repeat submissions during saving. Failure retains the proposed order with Retry and Cancel. New Counts still start at the top.

Delete uses a native alert:
- Title: `Delete Count?`
- Message: `“{name}”, started {localized start date}, will be permanently deleted. This can’t be undone.`
- Actions: Cancel and destructive Delete.

Prevent repeat submissions while deleting. Success returns to Counts; deleting the last Count shows the empty state. Failure stays on detail, preserves the Count, and shows `We couldn’t delete this Count. Please try again.`

## Loading, failure, and synchronization

First load shows a loading indicator, not an empty list. Only a successful response confirming zero Counts may show the empty state. List/detail retrieval failure shows a short error and Retry.

After connection loss, retain already-loaded list/detail with `Offline. Showing last synced Counts.` Elapsed readings continue locally. Preserve Create/Edit drafts and proposed orders. Explain that saving requires reconnection; do not begin saves, deletes, unit changes, or reorder submissions while known offline. There is no promise of offline syncing or persistent cached data after app restart.

On reconnection, refresh automatically without overwriting local unsaved drafts/orders. Competing edits, reorder saves, and unit selections use last successful server write wins, not device timestamps. No stale-edit rejection, conflict-review UI, or merge workflow. Writes remain operation-scoped: editing name/date cannot overwrite units or order.

## Architectural and verification constraints

Follow the existing mobile-only Expo/Convex architecture; no web app or new general-purpose state/service layer is authorized. Routes compose Counts capability UI. Server data is authoritative for saved Counts; forms and reorder mode own their unsaved drafts. Derive readings and milestone recognition from start instant and current time rather than introducing milestone history.

Backend public boundaries require explicit argument/return validators, server-derived identity, per-resource ownership, and indexed bounded access. Mobile route protection does not replace authorization. Preserve the existing auth and token-storage contracts and never hand-edit generated Convex code. Specific module choices and executable work decomposition belong to subsequent issue-backed planning.

Verification should cover owner isolation, create/edit/delete persistence and failures, duplicate and Unicode names, unchanged-date edits after travel, calendar clamping/leap years, unit sequences and zeros, milestone boundaries, reorder accessibility and persistence, reconnect behavior, and approved visual states. Use the actual artifact for visual comparison. This document defines expected behavior, not evidence that implementation passes these checks.

## Reconciliation summary

The original five draft stories remain the conceptual core: empty Counts, create, list, detail, milestone recognition. Their compact two-unit list reading, optional omission of leading zeros, early/quarterly milestone ladder, and no-speculative-tabs direction are superseded here. Management and persistence behavior are specified above for later issue-backed decomposition, not silently assigned to the original five stories.

Artifact editorial corrections: there are five original stories, not four; Story 5 is milestone rules, not deletion confirmation. Empty-screen action wording applies to Counts content only. Duplicate names save without blocking or extra confirmation, not without an informational notice. Sharing copy is replaced, corner controls are absent in the empty state, and deletion names both the Count and its start date.
