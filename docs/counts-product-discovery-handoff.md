# Counts product discovery handoff

This document preserves the Counts discovery and reconciliation record. The consolidated design and its six-leaf issue hierarchy are approved; the product contract is `docs/superpowers/specs/2026-09-05-counts-design.md`. The user authorized issue publication and Project placement, not starting implementation, merging, or deploying. GitHub Issues own executable scopes and the Project owns status.

## Current status

- **Feature:** Counts
- **Phase:** approved design; authorized issue publication
- **Implementation authorized:** no
- **Issue publication authorized:** yes — approved parent and six executable leaves only
- **Issue hierarchy:** https://github.com/walker-tx/recovery-app/issues/10
- **Project:** https://github.com/users/walker-tx/projects/3
- **Artifact:** https://claude.ai/code/artifact/b4d70f61-e317-44d3-8127-d88b9733440a
- **Artifact retrieval:** verified through the repository's `inspect-claude-design-artifacts` workflow; the artifact API and mounted `frame.claudeusercontent.com` frame returned HTTP 200 and yielded substantive rendered content. Re-run that workflow in a later session rather than relying on transient `/tmp` captures.

## Approved product direction from the discussion

The user approved a motivational MVP for private, account-backed recovery Counts:

- Users may create multiple Counts for substances or behaviors and name them with free-form text.
- Counts should be private to the authenticated user and synchronize across signed-in devices.
- Counts is the first meaningful authenticated capability.
- A Count accepts a date only. The date is interpreted as midnight in the creating device's current time zone, converted to a UTC instant, and stored without retaining the originating time zone.
- The stored instant and total elapsed duration remain stable across travel. A displayed calendar date may change when formatted in another device time zone; that is accepted.
- Users may edit a Count's name or start date. There is no Correct, Reset, relapse, or streak-history concept in the initial release.
- Users manually order Counts; a newly created Count is placed at the top.
- Delete is permanent and requires confirmation. There is no archive or undo in the initial release.
- Milestone recognition is persistent and in-app only. Notifications and next-milestone progress are separate backlog ideas.
- Widgets and visual customization are later backlog ideas.
- Shareable Counts are an approved future product goal, not initial-release scope. Sharing behavior and permissions remain undesigned; no GitHub issue has been created.
- Initial-release privacy copy is `Your Counts are private to you.`

The user approved the epic vision and boundary presented in chat. The first five draft stories were presented, but the user did not approve them before supplying the artifact. The artifact materially changes some of those draft criteria.

## Reconciled source authority

The user approved the designs as the newer baseline where they intentionally modify the stories, retaining compatible story requirements and resolving contradictions explicitly. The consolidated design was approved for specification writing. The written specification records the controlling behavior; the artifact's claim that no questions remain is not blanket authorization for unspecified behavior.

Approved changes include per-Count largest-unit readings through minutes on both surfaces, the 30/60/90-day, six-month, then annual milestone ladder, and four tabs with Today/Read placeholders. These supersede the conflicting original draft criteria.

## Artifact requirements that augment the draft

The accepted artifact requirements, with approved reconciliation overrides, include:

- Use **Counts** as the product noun and **a Count** for one item; do not label the screen `Your counts`.
- Empty Counts has one central create action and no corner add button. Populated Counts has separate reorder and add controls in the upper-right corner.
- Create is a full-screen flow, not a sheet. It contains exactly Name and Start date.
- Save remains inactive until a trimmed nonblank name and a date are present.
- The native OS date picker has a maximum of today; future dates are visible but unselectable, with no client-facing future-date rejection message.
- Duplicate names are permitted. An as-you-type, nonblocking warning identifies the existing Count and its start date.
- Canceling after entering data requires discard confirmation.
- Save failure preserves both values, keeps retry available, and uses non-blaming copy.
- Successful creation returns to Counts with the new Count at the top and already counting. There is no success toast or notification. **Reconciliation approved:** omit the artifact’s optional `Just added` hint; placement at the top and immediate counting provide creation feedback.
- List rows show the name, complete elapsed reading, localized `since` date, and latest milestone when one exists. The start date disambiguates duplicate names.
- A long list name truncates before a pinned milestone badge; detail displays the full name over as many lines as necessary without squeezing the elapsed reading.
- The selected leading elapsed unit is retained at zero. Readings update at minute granularity and never show seconds.
- Month and year calculations and calendar milestones clamp to the last day of shorter months.
- Detail contains name, elapsed reading, Units, latest milestone when present, Started date, Edit, and Delete.
- Edit is the sole bottom-rail action and is repeated in the header overflow menu. Delete appears only in the overflow menu.
- Before the first milestone, omit both the `Latest milestone` label and badge and close the layout gap; do not show a placeholder.
- Milestone recognition is a persistent badge only. There is no notification, animation, interstitial, confetti, dismissal, history, or next-milestone progress.

## Visual and interaction contract observed in the artifact

The mobile boards use an off-white/light-gray surface, near-black primary text, muted slate-blue accents, roughly 20-point horizontal insets, small tracked uppercase metadata labels, large bold titles, a dominant leading elapsed numeral, and smaller gray subordinate units. Layout favors whitespace, flat rows, hairline separators, and registration-mark-like corner details rather than elevated cards, gradients, or pronounced shadows. Primary buttons use muted-blue fills with white text. Milestones are compact pale-blue pills with darker slate-blue text. Edit is a full-width outlined action in the bottom rail.

Observed screens and states include:

- Empty Counts home with `RECOVERY`, `Counts`, `NO COUNTS YET`, `Track your sobriety.`, explanatory copy, `Create your first Count`, a privacy/multiplicity note, and the four-tab bar.
- Empty New Count form; name entered with keyboard; duplicate-name warning; and save-failure retry state.
- Populated five-row Counts list demonstrating duplicate names, long-name truncation, milestone badges, start-date tiebreakers, and full minute-level readings.
- Count detail with achieved milestone; no-milestone detail; long-name detail; full-screen Units picker; and overflow menu containing Edit and Delete.

Implementation must eventually compare against the artifact itself, not approximate these prose notes. Native safe areas, Dynamic Type, VoiceOver/TalkBack, keyboard avoidance, touch targets, and platform behavior remain requirements even where the artifact does not depict them.

## Internal artifact inconsistencies to resolve

Record these explicitly; do not smooth them over during implementation:

1. **“Only tap target” versus tabs — resolved:** `Create your first Count` is the only action within the empty Counts content area, not the entire screen. All four bottom tabs remain available.
2. **Account/settings reachability — resolved:** Account and settings are reachable through You, including from empty Counts. Counts does not duplicate these controls.
3. **Global add action versus empty exception — resolved:** Top-right add and reorder controls appear only when at least one Count exists. Empty Counts has neither control and uses the central create action instead.
4. **Incorrect deletion reference — corrected in specification:** Story 5 is milestone rules. The separately approved deletion flow below replaces the erroneous reference.
5. **Story count mismatch — corrected in specification:** There are five original stories, not four.
6. **Duplicate-name wording — resolved:** Duplicate names are allowed. While typing, show a nonblocking informational notice identifying the existing Count and its start date. The notice never disables Save or requires extra confirmation. Replace “without complaint” with “without blocking or requiring confirmation.”
7. **Privacy versus sharing copy — resolved:** Replace `Counts are private unless you share them` with `Your Counts are private to you.` The user approved shareable Counts as a future goal, outside the initial release.
8. **Artifact authority — resolved:** Designs are the newer baseline where they intentionally modify stories; explicit reconciliation decisions govern contradictions. See Reconciled source authority above.

## Approved deletion flow

- Use a native confirmation alert.
- Title: `Delete Count?`
- Message: `“{name}”, started {localized start date}, will be permanently deleted. This can’t be undone.`
- Actions: Cancel and destructive Delete.
- Prevent duplicate submissions while deletion is in progress.
- On success, return to Counts. Deleting the last Count shows the empty state.
- On failure, stay on detail, preserve the Count, and show `We couldn’t delete this Count. Please try again.`

## Approved edit flow

- Reuse the full-screen Create form’s layout and behavior, titled `Edit Count`, with existing Name and Start date filled in.
- Apply the same validation and nonblocking duplicate-name notice, excluding the Count being edited.
- Enable Save only when the form is valid and differs from its original values.
- Update the existing Count without changing its list position or selected elapsed unit.
- Changing the start date recalculates elapsed time and the latest milestone; it creates no reset or history records.
- If the start-date field is unchanged, preserve the exact stored UTC instant, including when editing only the name after travel.
- If the user chooses a different date, interpret it as midnight in the device’s current time zone and convert to UTC, just like creation.
- Successful saving returns to detail without a success toast.
- Failed saving preserves entered values and allows retry.
- Cancel or back returns to detail immediately if unchanged; unsaved changes require discard confirmation.

## Approved discard-changes flow

- Create and Edit share a native confirmation alert for leaving with unsaved changes.
- Title: `Discard changes?`
- Message: `Your changes haven’t been saved.`
- Actions: Keep editing and destructive Discard.
- Keep editing preserves the form exactly as it is.
- Discard leaves without saving: back to Counts from Create, or detail from Edit.
- Apply this to Cancel and back navigation, including system-back gestures where supported.
- If all fields are restored to their original values, leaving no longer requires confirmation.

## Approved reorder flow

- Tap the top-right reorder control to enter an explicit Done/Cancel mode; moves are not saved immediately.
- Show row drag handles, temporarily hide Add, and disable opening Count details.
- Support dragging plus accessible Move up / Move down actions.
- Rows shift smoothly into place; respect Reduce Motion.
- Done saves the order and exits. Cancel abandons changes. Back navigation asks for discard confirmation if the order changed.
- While saving, prevent further moves and repeat submissions.
- If saving fails, retain the proposed order with Retry and Cancel available.
- Newly created Counts still go to the top.
- Competing reorder saves use the last-saved-wins policy below.

## Approved loading and offline policy

- Initial release keeps already-loaded Counts useful offline but requires a connection to save changes; it does not promise offline syncing.
- On first load, show a loading indicator, not the empty state. Show the empty state only after a successful response confirms no Counts.
- List/detail load failure shows a short error with Retry, never an empty list in place of an error.
- If connection is lost after loading, keep the loaded list/detail visible with `Offline. Showing last synced Counts.` Elapsed readings continue updating locally.
- Preserve Create/Edit drafts during connection loss and explain that saving requires reconnection.
- Do not start saves, deletes, unit changes, or reorder submissions while known to be offline.
- On reconnect, refresh automatically without replacing unsaved form values or a proposed reorder.
- Previously loaded Counts are not guaranteed after an offline app restart; persistent offline storage is outside initial-release scope.

## Approved cross-device conflict policy

- Use last saved wins for competing edits, reorder saves, and unit selections. Here, last saved means the last successful server write, not a device timestamp.
- Do not add stale-edit rejection, conflict-review screens, or merge workflows to the initial release. The user considers simultaneous multi-device editing unlikely.
- Preserve unsaved local drafts and proposed orders during reactive updates, as required by the loading/offline policy.
- This does not expand a save beyond its intended operation: editing Name/Start date does not overwrite selected units or list order.

## Approved naming policy

- Names must contain 1–100 user-perceived characters (Unicode grapheme clusters) after trimming leading/trailing whitespace. An emoji or accented letter counts as one user-perceived character.
- Treat canonically equivalent Unicode spellings and capitalization as matching for the duplicate notice. Accents remain meaningful: `Cafe` and `Café` are distinct. Preserve entered spelling and formatting apart from trimming outer whitespace.
- Preserve capitalization, punctuation, and internal spacing.
- Detect duplicates without regard to capitalization or leading/trailing whitespace: `Alcohol` and ` alcohol ` trigger the nonblocking notice but remain allowed.
- Do not use fuzzy matching; `Drinking` and `Alcohol` are distinct names.
- Reject over-limit names with `Use 100 characters or fewer.` Never silently cut saved text.
- Long names truncate in the list before the milestone badge. Detail shows the full name, wrapping as needed.

## Approved milestone wording and localization

- Initial-release interface copy is English. Use the device’s locale for displayed dates and number formatting.
- Milestone badge labels are `30 days`, `60 days`, `90 days`, `6 months`, `1 year`, `2 years`, and so on, with singular/plural year wording.
- Show only the latest achieved milestone in the badge, not the current elapsed duration.
- Before the first milestone, omit both the badge and the `Latest milestone` label/placeholder.
- Translated interface copy is deferred. User-entered names may use any language.

## Approved tab destinations

- Keep all four tabs tappable: Counts, Today, Read, You.
- Today and Read are placeholder screens titled `Today` and `Read`, each displaying `Coming later.`
- These placeholders introduce no additional features or promises in the initial release.
- You remains the account/settings destination.

## Approved time-calculation basis

- Use UTC for calendar calculations; display the Started date in the device’s local time zone.
- Days are exact 24-hour durations; weeks are seven days.
- Months and years use anniversaries of the stored UTC instant, clamped to the last day of shorter months.
- Elapsed readings and milestone eligibility do not change when the user travels.
- Calendar milestones may occur at a local hour other than midnight. This is accepted in exchange for stable calculations without retaining a home time zone.

## Source recheck in the reconciliation session

- Re-inspected the live artifact with the repository inspector: artifact API and mounted frame both returned HTTP 200, with 21,770 characters of substantive rendered content. Transient evidence: `/tmp/claude-design-artifact.lQJ7Ba`; future sessions must retrieve fresh evidence.
- Recovered the original five draft stories from session `s-1788119991167-7214-1` (generation 87).
- **Deletion identification — resolved:** The user approved adding the localized start date to the deletion message, matching the artifact SPEC requirement to identify a Count by both name and start date. All other approved deletion behavior is unchanged.

## Remaining delivery gates

- Land the specification and handoff through normal repository review before implementation handoff. The documentation PR does not authorize starting implementation or merging.
- Use the approved GitHub issue hierarchy for executable scope, dependencies, and delivery evidence; Project fields own status.
- Obtain explicit implementation authorization for an executable leaf before using executing-project-work. Issue publication does not authorize merging, deployments, or safeguard bypasses.
- Reinspect the live artifact for implementation and visual verification; temporary captures are not durable evidence.
