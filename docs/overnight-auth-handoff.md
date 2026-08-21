# Overnight auth handoff

This file is the durable handoff for `docs/overnight-auth-plan.md`. Agents must verify it against Git and repository state before acting.

- **Current section:** 7. Harden behavior and accessibility
- **Next action:** review
- **Last known-good commit:** The sensitive-auth-data verification is green on top of reviewed commit `0e4e172`; see the current implementation commit.
- **Correction cycles for current section:** 0
- **Last successful checks:** The focused profile suite passed 3/3, the backend package TypeScript check passed, the bounded production-source privacy inspection passed, and `git diff --check` passed.
- **Tests added in current section:** Profile public-result coverage now explicitly rejects owner identity, user email, document ID, and creation-time metadata.
- **Review status:** Awaiting fresh review of the sensitive-auth-data verification transition.
- **Blocking condition:** None. Section 7 simulator accessibility/layout checks and protected-route history after sign-out remain explicit verification gaps.
- **Next bounded action:** Freshly review only the sensitive-auth-data verification commit for correctness, architecture, simplicity, auth security/privacy, Convex authorization, accessibility applicability, product fidelity, and test quality.

## Section 7 sensitive-auth-data verification implementation

The profile behavior suite now explicitly asserts that the authenticated public profile result excludes its server-owned owner ID, user email, Convex document ID, and creation-time metadata in addition to matching the narrow display-only shape. A temporary regression probe added a database identifier to the public mapper; the focused suite failed 1/3 at Convex return validation as intended, and the mutation was restored before the green run. No red state was committed.

A bounded production-source inspection found no console logging, verification-code identifiers, or access/refresh-token identifiers in application-owned mobile or Convex production source. It also confirmed that sign-in routes provider failures through the fixed safe-error mapper, profile and sign-out handlers ignore caught provider values, and the only application-defined public profile functions use explicit narrow return validators and the `publicProfile` mapper. Password is the only configured provider, so no application code generates or delivers verification codes. This source inspection is a verification check rather than a claim about arbitrary future code or provider internals.

`mise exec -- pnpm --filter @recovery/backend exec vitest run convex/profiles.test.ts` passed 3/3, `mise exec -- pnpm --filter @recovery/backend run check` passed, the bounded production-source privacy inspection passed, and `git diff --check` passed. No production code, mobile behavior, dependency, Expo configuration, generated Convex file, or deployment state changed.

## Section 7 stale profile-save-error regression correction cycle 2 final review

Fresh read-only review of `676e12d` found no actionable findings. The corrected test first selects each self-contained `TextField`, then extracts only that field's inline `onChangeText` callback before requiring its corresponding state setter followed by `setFormError(null)`. This directly closes the reviewed later-prop borrowing defect, and the documented mutation probe demonstrates that removing the first-name clear while adding a later `onFocus` clear now fails only the intended assertion. Production profile behavior remains unchanged and correct.

Architecture, simplicity, security/privacy, accessibility, adversarial/test-quality, and product-fit lenses reported no other findings. One adversarial candidate observed that lexical source matching could still be satisfied by deliberately inert nested or comment text inside the handler; the independent skeptic downgraded it because rejecting arbitrary semantic decoys exceeds this correction's sourced objective and the explicitly bounded static-test strategy. This remains a general static-contract limitation, not a blocker or a claim of mounted runtime coverage. No backend, Convex authorization, token storage, dependency, Expo configuration, generated code, or deployment boundary changed.

Fresh review reran `mise exec -- node --test apps/mobile/src/features/onboarding/profile-screen-contract.test.ts` (2/2 passed with only the existing module-type warning), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check HEAD^ HEAD` (passed). Mounted alert removal, focus retention, keyboard behavior, compact layouts, enlarged text, VoiceOver/TalkBack behavior, sign-out navigation history, and the sensitive-auth-data/public-result check remain open section 7 verification gaps.

## Section 7 stale profile-save-error regression correction cycle 2

The source contract now extracts the body of each selected field's `onChangeText` callback before asserting that its own state setter is followed by `setFormError(null)`. This closes the same-field borrowing gap without changing the already-correct profile screen production behavior.

For red evidence, a temporary mutation removed only the first-name handler's clear and added `onFocus={() => setFormError(null)}` later in the same `TextField`. The corrected focused contract failed 1/2 on the intended first-name assertion while the display-name assertion remained green; the temporary mutation was restored and no red state was committed. Against repository production code, `mise exec -- node --test apps/mobile/src/features/onboarding/profile-screen-contract.test.ts` passed 2/2 with only the existing module-type warning. `mise exec -- pnpm --filter @recovery/mobile run check` passed, and `git diff --check` passed. No production code, dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 7 stale profile-save-error regression correction cycle 1 review

Fresh review of `fbe615a` confirmed that selecting self-contained `TextField` blocks prevents the original sibling-field borrowing defect, and the documented one-handler removal probe is valid for the current source. One blocking P3 test-quality finding remains: the assertions at `profile-screen-contract.test.ts:34-35` match from the field setter through the rest of the entire `TextField`, not through only its `onChangeText` callback. A read-only mutation probe removed the first-name handler's clear and added a later `onFocus={() => setFormError(null)}` prop in the same field; the unchanged first-name assertion passed even though editing no longer cleared the stale error. The smallest correction is to extract or otherwise bound each `onChangeText` callback before asserting its setter and clear. Production code should remain unchanged unless the corrected regression exposes a separate defect.

Architecture, simplicity, security/privacy, accessibility, and product lenses reported no additional findings. The independent skeptic confirmed this P3 as blocking for the current test-correction objective. No backend, Convex authorization, token storage, dependency, Expo configuration, generated-code, or deployment boundary changed. Static source coverage still does not prove mounted alert removal, focus retention, keyboard behavior, compact layouts, enlarged text, or VoiceOver/TalkBack behavior; section 7's sign-out-history and sensitive-data checks also remain open.

Fresh review reran `mise exec -- node --test apps/mobile/src/features/onboarding/profile-screen-contract.test.ts` (2/2 passed with only the existing module-type warning), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check a893983..fbe615a` (passed). No production code or deployment state changed during review.

## Section 7 stale profile-save-error regression correction cycle 1

The source contract now splits `profile-screen.tsx` into self-contained `TextField` blocks and selects each field by its exact label before inspecting its change behavior. Each assertion requires the corresponding field setter followed by `setFormError(null)`, so the first-name assertion can no longer borrow the display-name handler's clear across JSX. Production behavior did not change.

For red evidence, a temporary copy of the profile screen removed only the first-name handler's `setFormError(null)`. Running the corrected focused contract against that copy failed 1/2 on the intended first-name assertion while the display-name assertion remained green; the temporary copy was removed and no red state was committed. Against repository production code, `mise exec -- node --test apps/mobile/src/features/onboarding/profile-screen-contract.test.ts` passed 2/2 with only the existing module-type warning. `mise exec -- pnpm --filter @recovery/mobile run check` passed, and `git diff --check` passed. No production code, dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 7 stale profile-save-error clearing review

Fresh review of `175fd65` found no production correctness, architecture, simplicity, auth security/privacy, accessibility, adversarial-behavior, or product-fidelity defect. Both production change handlers clear the sanitized form-level save error, preserve the other value, and independently clear the edited field's validation error. State remains feature-local; pending inputs remain non-editable; the backend, authorization, token storage, dependencies, Expo configuration, generated files, and deployment state are unchanged. Six read-only review lenses reported no findings.

One blocking P3 test-quality finding survived an independent skeptic review. In `profile-screen-contract.test.ts`, the `firstNameHandler` regex may start at the display-name `onChangeText` and span across JSX until `setFirstName(value)`. A read-only mutation probe removed only the first-name handler's `setFormError(null)` and verified that the captured text still included the display-name handler's clear, so both assertions would remain green. The correction must bound each assertion to its corresponding `TextField` or handler; production code should not change unless the corrected regression demonstrates a separate behavior defect.

Fresh review reran `mise exec -- node --test apps/mobile/src/features/onboarding/profile-screen-contract.test.ts` (2/2 passed with only the existing module-type warning), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check 232872a..175fd65` (passed). The source contract still does not mount React Native behavior, so alert removal, focus retention, and VoiceOver/TalkBack behavior remain device-verification gaps alongside the open section 7 simulator, sign-out-history, and sensitive-data checks. No production code or deployment state changed during review.

## Section 7 stale profile-save-error clearing implementation

After a failed profile save, editing either the display name or optional first name now clears the stale form-level save error while preserving the other field and independently clearing the edited field's validation error. The behavior stays in the existing feature-local screen state and does not change backend profile validation, persistence, or authorization.

The focused source contract first failed 1/2 with the intended mismatch because the display-name handler retained the prior form error; no red state was committed. After implementation, `mise exec -- node --test apps/mobile/src/features/onboarding/profile-screen-contract.test.ts` passed 2/2. `mise exec -- sh -lc 'node --test apps/mobile/src/components/ui/*.test.ts apps/mobile/src/features/auth/*.test.ts apps/mobile/src/features/onboarding/*.test.ts'` passed 16/16 with only the existing module-type warnings, and `mise exec -- pnpm --filter @recovery/mobile run check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed. Mounted native behavior remains a device-verification gap.

## Section 7 invalid sign-in field focus review

Fresh review of `03aab16` found no actionable findings across correctness, architecture, simplicity, auth security/privacy, accessibility, adversarial behavior, product fidelity, and test quality. Invalid submission computes errors once, records the non-color-only field messages, deterministically selects email before password, focuses the matching native input ref, and returns before any authentication request. Valid submission still normalizes email, preserves returning-user password policy, uses the synchronous duplicate-submit guard, retains credentials after failure, and renders only the existing sanitized provider error. State and refs remain feature-local, shared UI remains independent, and no backend, authorization, token-storage, dependency, configuration, generated-code, or deployment boundary changed. Six read-only review lenses and an independent skeptic confirmed approval.

The focused policy test proves priority selection but does not mount the screen or prove native ref focus. iOS and Android keyboard/focus behavior, compact layouts, enlarged text, VoiceOver/TalkBack announcement order, and logical reading order remain device-verification gaps. The broader section 7 checks for protected-route history after sign-out and absence of sensitive auth data in ordinary UI or public results also remain incomplete.

Fresh review reran `mise exec -- node --test apps/mobile/src/features/auth/auth-policy.test.ts` (4/4 passed with only the existing module-type warning), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check 6f81f40 03aab16` (passed). No production code or deployment state changed during review.

## Section 7 invalid sign-in field focus implementation

Invalid sign-in submission now focuses the first field with a validation error: email first, then password when it alone is invalid. The screen keeps native input refs and uses the tested policy result before any authentication request; valid submission, credential retention, safe error mapping, and duplicate-submit prevention are unchanged. This bounded accessibility hardening does not claim mounted iOS, Android, VoiceOver, or TalkBack behavior has been verified.

The focused test first failed with the intended missing-export `SyntaxError` for `getFirstInvalidSignInField`; no red state was committed. After implementation, `mise exec -- node --test apps/mobile/src/features/auth/auth-policy.test.ts` passed 4/4. The full mobile policy/state command passed 15/15 with only the existing module-type warnings, `mise exec -- pnpm --filter @recovery/mobile run check` passed, and `git diff --check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 7 duplicate sign-out prevention review

Fresh review of `8412a24` found no actionable findings across correctness, architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fidelity, and test quality. The per-mount guard sets its lock before the first await, suppresses an immediate second request, and releases in `finally`; the screen preserves Convex Auth session ownership, local pending/error state, the fixed sanitized failure message, retry after failure, and the shared button's disabled/busy accessibility state. Generalizing the guard changes only its value type and leaves the existing sign-in runtime behavior intact. No backend, authorization, token-storage, dependency, configuration, generated-code, or deployment boundary changed. An independent skeptic confirmed approval.

The source contract proves wiring rather than mounted native behavior. Rapid taps through React Native, provider failure/retry integration, post-sign-out protected-route history, lifecycle transitions, and VoiceOver/TalkBack announcements remain device-verification gaps, alongside the open compact-layout, enlarged-text, logical reading-order, and sensitive-data/UI checks.

Fresh review reran `mise exec -- node --test apps/mobile/src/features/auth/authenticated-home-screen-contract.test.ts apps/mobile/src/features/auth/auth-submission.test.ts` (3/3 passed with only the existing module-type warnings), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check` (passed). No production code or deployment state changed during review.

## Section 7 duplicate sign-out prevention implementation

Sign-out now runs through the auth feature's synchronous submission guard rather than relying only on React's pending-state rerender. Two presses in the same render window therefore cannot start two token-removal operations. The existing sign-in guard was generalized only at its value type boundary so both auth operations share the already-tested concurrency behavior; pending UI and sanitized sign-out failure behavior remain unchanged.

The focused authenticated-home contract first failed 1/1 with the intended missing-guard assertion because the screen called `signOut` directly; no red state was committed. After implementation, `mise exec -- node --test apps/mobile/src/features/auth/authenticated-home-screen-contract.test.ts apps/mobile/src/features/auth/auth-submission.test.ts` passed 3/3 with only the existing module-type warnings, and `mise exec -- pnpm --filter @recovery/mobile run check` passed. `git diff --check` passed before commit. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed. Mounted rapid-tap behavior and sign-out navigation history remain device-verification gaps.

## Section 7 accessible restoration-loading review

Fresh review of `ec33183` found no actionable findings across correctness, architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fidelity, and test quality. The combined restoration branch still withholds every route guard until Convex Auth restoration and authenticated profile loading finish, while the new screen exposes visible scalable loading text and a named progress role without revealing account or profile data. No backend, authorization, token, logging, dependency, configuration, generated-code, or deployment boundary changed. An independent skeptic confirmed approval.

The static contract proves source wiring, not mounted native behavior. Cold restoration, delayed profile loading, lifecycle transitions, route-history stability, and VoiceOver/TalkBack naming and announcement behavior remain device-verification gaps, alongside compact layouts, enlarged text, logical screen-reader order, sign-out history, and sensitive-data/UI checks.

Fresh review reran `bash scripts/test-auth-route-contract.sh` (passed), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check` (passed). No production code or deployment state changed during review.

## Section 7 accessible restoration-loading implementation

Auth restoration and authenticated profile loading now render a visible `ActivityIndicator` and loading message in a progressbar-labeled accessibility group instead of a blank tree. Route guards still remain unavailable until restoration finishes, so the change adds loading feedback without flashing unauthenticated, onboarding, or authenticated content. This bounded change does not claim device-level screen-reader announcement behavior has been verified.

The focused auth route contract first failed with the two intended messages because the pending branch still returned `null` and no accessible loading name existed; no red state was committed. After implementation, `bash scripts/test-auth-route-contract.sh` passed, `mise exec -- pnpm --filter @recovery/mobile run check` passed, and `git diff --check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 7 stale sign-in-error clearing review

Fresh review of `c6d8943` found no actionable findings across correctness, architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fidelity, and test quality. Both credential inputs directly dispatch the tested reducer actions, which clear only the stale sanitized form error while preserving the unedited credential. Inputs remain non-editable during submission, duplicate-submit protection is unchanged, and transient state remains in the existing pure feature-local reducer. No backend, authorization, token, logging, dependency, configuration, generated-code, or deployment boundary changed. An independent skeptic confirmed approval.

The reducer test and direct wiring inspection establish the static behavior but do not prove the mounted native input-to-alert-removal path. VoiceOver/TalkBack handling when the alert disappears remains a device-verification gap, alongside the existing compact-layout, keyboard, enlarged-text, logical screen-reader-order, sign-out-history, and sensitive-data/UI checks.

Fresh review reran `mise exec -- node --test apps/mobile/src/features/auth/sign-in-state.test.ts` (2/2 passed), the full six-file mobile policy/state command (13/13 passed), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check` (passed); tests emitted only the existing module-type warnings. No production code or deployment state changed during review.

## Section 7 stale sign-in-error clearing implementation

After a failed sign-in, editing either the email or password now clears the stale form-level authentication error while preserving the other credential. The screen already dispatches these reducer actions directly from each input, so the behavior remains owned by the existing feature-local reducer and requires no new UI state or dependency. Field-level validation errors continue to clear independently in the input handlers.

The focused reducer test first failed 1/2 with the intended mismatch because `emailChanged` retained the prior form error; no red state was committed. After implementation, `mise exec -- node --test apps/mobile/src/features/auth/sign-in-state.test.ts` passed 2/2. The full six-file mobile policy/state command passed 13/13 with only the existing module-type warnings, `mise exec -- pnpm --filter @recovery/mobile run check` passed, and `git diff --check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 7 display-name return-key review

Fresh review of `cce230b` found no actionable findings across correctness, architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fidelity, and test quality. The display-name field pairs `returnKeyType="next"` with an `onSubmitEditing` focus handoff and `submitBehavior="submit"`; the shared `TextField` forwards the ref and native input props unchanged. Installed React Native 0.86.2 defines `submit` as emitting the submit event without blurring on both supported native implementations. Focus state remains local to the onboarding feature, and no backend, authorization, persistence, token, logging, generated-code, dependency, configuration, or deployment boundary changed. An independent skeptic confirmed approval.

The static contract test proves the required source wiring but not native runtime behavior. iOS and Android keyboard continuity, visual flicker, hardware-keyboard and alternate-IME behavior, VoiceOver/TalkBack announcements, compact-layout keyboard reachability, enlarged text, and logical screen-reader order remain explicit device-verification gaps. Sign-out navigation history and sensitive-data/UI checks also remain incomplete section 7 work.

Fresh review reran `mise exec -- node --test apps/mobile/src/features/onboarding/profile-screen-contract.test.ts` (1/1 passed), the full mobile policy/state command (12/12 passed), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check` (passed); tests emitted only the existing module-type warnings. No production code or deployment state changed during review.

## Section 7 display-name return-key implementation

The profile screen now handles the display-name keyboard return action by focusing the optional first-name input. Its `submitBehavior="submit"` keeps the keyboard active while focus advances, matching the existing `returnKeyType="next"`. This is one bounded keyboard-accessibility hardening behavior and does not claim device-level keyboard, compact-layout, enlarged-text, or screen-reader verification.

Because the repository has no rendered mobile interaction harness and introducing one for this single wiring behavior would be broad infrastructure, the smallest meaningful test is a static screen contract over the production `TextField` props. It first failed with the intended assertion because the display-name field had no `onSubmitEditing` focus handoff; no red state was committed. After implementation, `mise exec -- node --test apps/mobile/src/features/onboarding/profile-screen-contract.test.ts` passed 1/1 with only the existing module-type warning. The full mobile policy/state command passed 12/12 with only existing module-type warnings, `mise exec -- pnpm --filter @recovery/mobile run check` passed, and `git diff --check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 7 field-error association review

Fresh review of `27caa0b` found no actionable findings across correctness, architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fidelity, and test quality. `TextField` preserves a caller-provided hint, adds the current error or valid-state description, gives errors precedence over descriptions, and passes the result directly to the native `TextInput` without allowing `...props` to overwrite it. Shared UI remains independent of Router, Convex, and feature state, and no backend, authorization, persistence, token, logging, generated-code, or deployment boundary changed. An independent skeptic confirmed approval.

Static review does not prove VoiceOver or TalkBack behavior. Dynamic hint updates while an input remains focused, hint-disabled settings, announcement order or duplication between the hint and separate alert, compact layouts, keyboard visibility, enlarged text, logical screen-reader order, sign-out history, and sensitive-data display checks remain section 7 verification gaps. The pure helper test covers the composition policy but not rendered native props; direct production wiring was inspected, and adding broad interaction infrastructure remains unjustified for this bounded change.

Fresh review reran `mise exec -- node --test apps/mobile/src/components/ui/field-accessibility.test.ts` (2/2 passed with only the existing module-type warning), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check` (passed). No production code or deployment state changed during review.

## Section 7 field-error association implementation

The shared `TextField` now exposes its current error or valid-state description through the native input's `accessibilityHint`, so assistive technology encounters the field message while focused on the input rather than relying only on a separate alert node. A caller-provided hint is preserved and combined with the field message. Visible, selectable, non-color-only error text and existing field focus behavior remain unchanged. This bounded change applies consistently to profile and sign-in fields without adding interaction-test infrastructure, and it does not claim device-level VoiceOver or TalkBack behavior has been verified.

The focused test first failed with the intended `ERR_MODULE_NOT_FOUND` for the absent field-accessibility policy; no red state was committed. After implementation, `mise exec -- node --test apps/mobile/src/components/ui/field-accessibility.test.ts` passed 2/2 with only the existing module-type warning. The full mobile policy/state command passed 11/11 with only existing module-type warnings, `mise exec -- pnpm --filter @recovery/mobile run check` passed, and `git diff --check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 7 invalid profile field focus review

Fresh review of `8fade53` found no actionable findings across correctness, architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fidelity, and test quality. The profile screen keeps transient validation and focus state locally, deterministically selects display name before first name, forwards React 19 refs through `TextField` to the native inputs, returns before mutation on invalid input, and preserves the valid submission path. No backend, authorization, persistence, token, logging, generated-code, or deployment boundary changed. An independent skeptic confirmed approval.

The focused policy test proves field priority but does not prove native ref/focus behavior on devices. Runtime verification still needs to cover iOS and Android focus, VoiceOver/TalkBack announcement order, keyboard visibility on compact layouts, enlarged text, logical reading order, and exact touch targets. Programmatic field-error association and display-name return-key focus remain known static section 7 follow-ups; sign-out history and sensitive-data checks also remain incomplete.

Fresh review reran `mise exec -- node --test apps/mobile/src/features/onboarding/onboarding-policy.test.ts` (3/3 passed with only the existing module-type warning), `mise exec -- pnpm --filter @recovery/mobile run check` (passed), and `git diff --check` (passed). No production code or deployment state changed during review.

## Section 7 invalid profile field focus implementation

Invalid profile submission now deterministically focuses the first field with an error: display name first, then optional first name when it alone exceeds its limit. The screen keeps native input refs and uses the tested policy result after setting the non-color-only field errors; valid submission behavior is unchanged. This is one bounded accessibility hardening behavior and does not claim the remaining keyboard, field-error association, screen-reader, layout, or device checks are complete.

The focused test first failed with the intended missing-export `SyntaxError` for `getFirstInvalidProfileField`; no red state was committed. After implementation, `mise exec -- node --test apps/mobile/src/features/onboarding/onboarding-policy.test.ts` passed 3/3. The full mobile policy/state command passed 9/9 with only existing module-type warnings, `mise exec -- pnpm --filter @recovery/mobile run check` passed, and `git diff --check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 5 mobile profile and authenticated-home final review

Fresh read-only review of `448329b` found no blocking defect. Route files remain composition-only, Convex owns profile completion, local React state owns transient form behavior, and the root guard distinguishes auth restoration from authenticated profile loading. The profile backend retains explicit validators, server-derived identity, owner-indexed bounded access, narrow public results, and per-owner mutation isolation. The mandatory auth-foundation check passed, and the deterministic authorization scan found zero client-supplied identity, missing ownership, PII-by-client-ID, or unchecked parent-container write shapes.

The independent skeptic confirmed three nonblocking follow-ups. The profile copy says details can be changed later although no edit entry point exists; remove or fulfill that promise in later product work. Field-error association and first-invalid-field focus remain the previously accepted section 7 accessibility scope, and the profile screen's `returnKeyType="next"` still needs matching focus behavior. Returning `null` during profile loading extends the previously accepted blank-loading P3 gap and also remains section 7 hardening. Simulator/device checks for keyboard obstruction, compact layout, enlarged text, VoiceOver/TalkBack order and announcements, exact touch targets, and sign-out history remain unverified.

Fresh review reran `mise exec -- sh -lc 'node --test apps/mobile/src/features/auth/*.test.ts apps/mobile/src/features/onboarding/*.test.ts'` (8/8 passed with only existing module-type warnings), `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/profiles.test.ts` (3/3 passed), both mobile and backend package checks (passed), `bash scripts/test-auth-route-contract.sh` (passed), and `git diff --check` (passed). No production code or deployment state changed. Section 5 is approved, section 6 remains complete through its reviewed privacy deferral, and the next transition is section 7 implementation.

## Section 5 mobile profile and authenticated-home implementation

The root route boundary now skips the owner profile query while unauthenticated, waits for the authenticated query's initial loading state, and separately protects onboarding and app groups according to Convex-owned completion state. The profile route composes a capability screen with accessible fields, local validation, normalized optional first-name handling, synchronous duplicate-submit prevention, pending controls, and a sanitized save error. The backend enforces the same 80-character display-name and 50-character first-name limits. Successful completion updates the reactive query and exposes the minimal protected home, whose sign-out action reports only a sanitized failure.

The mobile policy test first failed with the intended `ERR_MODULE_NOT_FOUND` for the absent onboarding policy; no red state was committed. The backend regression then failed 1/3 because an 81-character display name was accepted and persisted. After implementation, `mise exec -- node --test apps/mobile/src/features/onboarding/onboarding-policy.test.ts` passed 2/2 and `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/profiles.test.ts` passed 3/3.

`bash scripts/test-auth-route-contract.sh` initially failed because its static assertions still described the pre-profile guard shape; after updating that existing contract to require distinct onboarding/app guards and the combined restoration wait, it passed. `mise exec -- pnpm --filter @recovery/mobile run check` and `mise exec -- pnpm --filter @recovery/backend run check` passed. The full mobile Node test set passed 8/8 with only the existing module-type warnings, `mise run check` passed both workspace tasks, Expo Doctor passed 17/17 checks with a non-failing bundled-native-module fetch warning, and `git diff --check` passed. No deployment-affecting command ran. Device interaction remains for section 7 hardening.

## Section 5 backend correction cycle 1 final review

Fresh read-only review found no actionable findings in `73e3e65`. The second authenticated identity now invokes `api.profiles.complete`, reads its distinct profile, and coexists with the first owner's later update; the test also proves exactly two rows linked to the two distinct owner IDs. This closes the documented mutation-isolation regression gap. The production functions remain server-authenticated, owner-indexed, bounded, validated, and narrow in their public return shape.

Architecture, simplicity, security/privacy, Convex authorization, adversarial behavior, product fit, and test quality lenses reported no findings; accessibility was not applicable to this backend-only test/documentation correction. The deterministic Convex authorization scan found no client-supplied identity, missing ownership check, PII-by-client-ID query, or unchecked parent-container write shape. An independent skeptic confirmed approval.

Fresh review reran `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/profiles.test.ts` (3/3 passed), `mise exec -- pnpm --filter @recovery/backend run check` (passed), and `git diff --check` (passed). No production code or deployment state changed. Mobile/device behavior remains unverified and belongs to the next implementation and later hardening work.

## Section 5 backend correction cycle 1

The ownership regression was introduced test-first. Before the second authenticated mutation was added, the focused profile suite failed 1/3 with the intended mismatch: the second owner read `null` instead of its expected distinct profile. No red state was committed. The completed test now has both authenticated identities call `api.profiles.complete`, verifies each identity reads its own values, and verifies two persisted rows reference the two distinct owner IDs. Existing production authorization already satisfied the regression, so no production code changed.

After correction, `mise exec -- pnpm --filter @recovery/backend exec vitest run convex/profiles.test.ts` passed 3/3, `mise exec -- pnpm --filter @recovery/backend run check` passed, and `git diff --check` passed. No deployment-affecting command ran.

## Section 5 backend fresh review of `fa9c7ba`

One P2 blocking test-quality finding survived fresh review: the test creates two users but only the first user invokes `complete`; the second user performs a read only. The current production mutation correctly derives `ownerId` server-side and performs an owner-indexed lookup, but the test would not catch a future mutation regression that located and patched the first existing profile for a second caller. This contradicts the section acceptance and handoff claim that cross-user mutation isolation is covered.

No Convex authorization defect was found. The auth foundation is present, public functions accept no caller-supplied identity or document/container ID, both endpoints authenticate with `getAuthUserId`, reads are bounded by `by_owner`, writes target only the owner-scoped result, and public results omit owner and Convex metadata. Architecture, correctness, security/privacy, accessibility applicability, product scope, and generated API changes produced no other blocking findings.

Two nonblocking P3 items were recorded for later cleanup/hardening rather than expanding this correction: profile strings have no application-level maximum yet, so define product-appropriate bounds before the mobile profile form ships; and the explicit test `import.meta.glob` plus direct Vite typings/dependency are unnecessary for the conventional `packages/backend/convex` layout supported by installed `convex-test` 0.0.56. Neither item violates the current backend acceptance or permits cross-user access.

Fresh review reran the focused profile suite (3/3), backend TypeScript check, and `git diff --check`; all passed. Review used architecture, simplicity, security/privacy, Convex authorization, accessibility, adversarial, and product/test-quality lenses plus an independent skeptic. No production code or deployment state changed.

## Section 5 backend profile implementation

The backend now owns one profile per authenticated user in a `profiles` table indexed by `ownerId`. Public `getMine` and `complete` functions derive the user ID from Convex Auth, declare argument and return validators, use the owner index, return no owner metadata, normalize names, reject blank display names, and upsert only the caller's profile in one transaction. The generated API was refreshed by the local Convex CLI; no generated file was hand-edited.

The new behavior test initially failed all three cases with `Could not find module for: "profiles"`, demonstrating the intended missing registered capability; no red state was committed. The green run passed 3/3 and covers unauthenticated rejection, absent-profile behavior, owner create/update persistence, cross-user isolation, a single owned row, blank display-name rejection, and public shape through `api.profiles`. The existing auth policy tests still pass 2/2.

The first local sync exposed that the existing hyphenated `auth-policy.ts` filename was not a valid Convex module path, so it was renamed without behavior changes to `authPolicy.ts`. The colocated Convex test harness adds exact `convex-test`, Vitest, and Vite development dependencies plus their required TypeScript types. After those bounded setup corrections, backend TypeScript passed, the local-anonymous sync completed, generated API types include `profiles`, and `git diff --check` passed. No cloud or production deployment was selected or changed.

## Section 3 correction cycle 2 final review

No actionable blocking findings survived verification. The reducer is the authoritative owner used by `SignInScreen`, its authentication-failure transition preserves both credentials while accepting only a sanitized error message, duplicate submission remains synchronously guarded, and no production backend or public Convex contract changed. The deterministic Convex authorization scan found no application-defined public query/mutation, client-supplied identity, document-ownership, PII-by-ID, or parent-container write shape.

The shared field primitive does not yet programmatically associate field errors with inputs, and invalid submission does not focus the first invalid field. Both behaviors predate `dab694c`, were not worsened by the correction, and remain nonblocking section 7 accessibility hardening work alongside mounted retention/double-tap checks, compact layout, keyboard, enlarged text, and VoiceOver/TalkBack verification. The inherited account-dependent provider timing/error behavior remains a package-level limitation; the mobile UI renders only a fixed sanitized failure, and signup/reset remain unavailable under the accepted deferral.

Fresh review reran the focused mobile auth command (6/6), the mobile TypeScript check passed, and `git diff --check` passed; focused tests emitted only the existing package-module-type warnings. No production code, dependency, Expo configuration, generated Convex file, or deployment state changed during review.

## Section 3 correction cycle 2

The new regression first failed with the intended `ERR_MODULE_NOT_FOUND` because the screen-owned sign-in state transition did not yet exist as a testable boundary; no red state was committed. The screen now owns email, password, and form error in one reducer, and its authentication-failure action changes only the sanitized error. This makes credential retention an explicit tested transition rather than an assertion over an unrelated submission object.

After implementation, the combined focused mobile auth command passed 6/6, the mobile TypeScript check passed, and `git diff --check` passed. No dependency, Expo configuration, backend, generated Convex file, or deployment state changed.

## Section 3 correction cycle 1 fresh review of `b37f7d6`

One P2 blocking finding remains: `apps/mobile/src/features/auth/auth-submission.test.ts` passes a standalone object through `createSubmissionGuard` and proves callback identity, object non-mutation, and retry unlock, but it never observes the controlled `email` and `password` state in `SignInScreen`. Adding `setEmail("")` and `setPassword("")` to the screen's failure path would not fail this regression. The next correction must cover state actually owned by that failure path without adding broad interaction infrastructure.

The password correction is approved: mobile sign-in now requires only a nonempty password, backend profile normalization accepts legacy eight- and nine-character credentials, and the pinned 0.0.95 source confirms `validatePasswordRequirements` runs only for `signUp` and `reset-verification`. The ten-character creation/reset rule therefore remains intact. Deterministic Convex authz review found no client-supplied identity, resource-ownership, PII-by-ID, or unchecked parent-container write in application backend code. No raw provider error is displayed, and unsupported password flows remain fail-closed.

Nonblocking gaps remain assigned to hardening: mounted-screen retention and double-tap coverage, direct-entry Back fallback, stale form-error clearing, local-backend sign-in, compact layout, keyboard, enlarged text, and assistive-technology checks. The inherited account-dependent sign-in errors/timing and mixed-case legacy-account compatibility question remain documented limitations, not blockers for the current safe work. No production code was edited and no deployment-affecting command ran during review.

## Section 3 correction cycle 1

Regression-first evidence covered both review blockers. Before production changes, the mobile focused command failed 3/5 for the intended reasons: the policy still rejected an eight-character password and the submission guard did not accept or pass the form values into its callback. The backend focused command failed with the intended `ERR_MODULE_NOT_FOUND` for the absent profile-policy module. No red state was committed.

The correction now validates only that a returning-user password is present on mobile, permits existing eight- and nine-character credentials through the backend profile normalization boundary, and preserves the ten-character rule in the provider's creation/reset hook. The submission guard now passes a read-only snapshot of the screen-owned email/password state to the callback that invokes Convex Auth; its failure test verifies that exact object drives the callback, remains unchanged, and can be retried.

After implementation, focused mobile tests passed 5/5 and focused backend tests passed 2/2. Mobile TypeScript passed. The first backend TypeScript run exposed `TS5097` for the new explicit `.ts` test import; enabling the same no-emit TypeScript import option already used by mobile resolved it, after which backend TypeScript and `mise run check` passed (2/2 workspace tasks). No deployment-affecting command ran.

## Section 3 fresh review of `62bd24f`

Two blocking findings require one correction cycle:

1. **P2 correctness/product — sign-in revalidates legacy credentials.** `apps/mobile/src/features/auth/auth-policy.ts` and `packages/backend/convex/auth.ts` reject every password shorter than ten characters before credential verification. Pinned Auth 0.0.95 previously allowed creation with its eight-character default, and its `validatePasswordRequirements` hook intentionally runs only for `signUp` and `reset-verification`. The returning-user flow must not lock out an otherwise valid existing eight- or nine-character credential. Preserve the ten-character rule for future credential creation/reset without applying it during sign-in.
2. **P2 test quality — value retention is not tested.** `auth-submission.test.ts` compares a standalone `values` object that is never passed to the guard, callback, or screen. The assertion necessarily passes even if the rendered form clears both fields. Replace it with regression coverage over state that the sign-in flow actually owns; keep the meaningful retry-unlock assertion.

Nonblocking findings and residual gaps: direct-entry Back fallback and stale form-error clearing are P3 hardening candidates; rendered double-tap, successful local-backend sign-in, keyboard, compact-layout, enlarged-text, and assistive-technology checks remain unverified. Pinned Auth's direct public sign-in action has account-dependent error/timing behavior inherited from the parent provider configuration; the mobile flow does not display those raw errors, and the accepted protocol-level deferrals remain limited to signup/verification/reset. Deterministic Convex authz scanning found no client-supplied identity, missing document-ownership check, PII-by-ID query, or unchecked parent-container write in application Convex code. No production code was edited during review, and no deployment-affecting command ran.

Fresh read-only lenses covered correctness, architecture, simplicity, security/privacy, Convex authorization, accessibility, adversarial behavior, product fidelity, tooling, and test quality. An independent skeptic confirmed both blockers after inspecting the repository contract and pinned provider source.

## Section 3 implementation

The welcome and returning-user sign-in routes now compose capability screens under `features/auth`. The sign-in screen preserves email/password values after failure, disables editable controls while pending, blocks immediate duplicate auth calls synchronously, supplies email/password autofill and keyboard metadata, and renders validation/provider failures as non-color-only alerts without displaying raw provider errors. The provider profile is the server-side normalization boundary and rejects every Password flow except `signIn`, preserving the accepted signup/reset deferrals.

Red evidence was captured before production files existed. Both test commands failed specifically because their imported policy/submission modules were absent; no red state was committed. After implementation, the combined focused run passed all five assertions. An initial mobile TypeScript check exposed missing Node test types and an invalid typed absolute route; adding the section's test type dependency/config and using the typed relative route resolved those failures before the final green checks. No deployment-affecting command was run.

## Section 2 review

Fresh read-only lenses covered correctness, architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fit, and test quality for `542d904`. No backend code changed, so Convex authorization review was not applicable. The independent skeptic confirmed the only candidate: returning `null` during restoration removed the prior labeled loading indicator. It classified this as a non-blocking P3 accessibility gap owned by section 7 rather than a failure of section 2 routing acceptance. No production code was edited during review.

## Operator-approved safe deferral

The operator approved safe deferral after the final section 1 review. This decision supersedes the prior run-wide block without weakening any security requirement:

- Signup/verification and reset are accepted as unavailable for this milestone because pinned 0.0.95 cannot meet the non-enumeration policy and signup also fails the concurrent-resend gate.
- Provider-owned non-atomic token persistence is documented as an inherited session-consistency limitation. A residual token remains subject to backend validation; this milestone does not fork or replace Convex Auth token storage.
- No code-generating email provider is enabled, so package DEBUG code logging is currently unreachable. Before a future provider is enabled, a bounded environment and observed-log check must be added.
- Routing, returning-user sign-in, profile onboarding, protected home, sign-out, and hardening may proceed. Reviewed feature-level deferrals advance rather than setting the whole run to `blocked`.

## Findings and decisions

- Password auth precedes social auth.
- Local verification/reset delivery uses secure six-digit codes printed only in local Convex logs.
- Resend, OAuth, groups, linked-method management, and production/cloud deployment are deferred.
- Password reset is gated on verified non-enumerating behavior from supported pinned APIs. The pinned 0.0.95 `reset` implementation currently fails this gate because absent and existing password accounts have observably different outcomes; keep reset unavailable pending a separately reviewed solution.
- Each feature uses red/green/refactor, then a fresh review, with at most two correction cycles.

## Historical corrections applied for review findings on `6e1024e`

1. The contract now requires both `AUTH_LOG_LEVEL=DEBUG` and `AUTH_LOG_SECRETS=true` to remain unset for every code-generating run, including local console delivery, and records that the code-creation DEBUG call bypasses `maybeRedact`.
2. Section 3 keeps normalization, password guidance, and safe-error mapping in pure policy tests, moves duplicate-submit behavior to a focused submission state-machine test, and requires a bounded simulator double-tap wiring check.
3. Section 4 now separates backend code-lifecycle/concurrency tests from mobile verification-state tests and records a bounded SecureStore fault-injection simulator exception for provider-owned token writes.
4. The contract and plan add a concurrent-resend safety gate with a forced reversed-delivery-completion test; signup/resend remains unavailable unless the last delivered code is redeemable across overlapping clients and retries.
5. Lost-response and partial token-write states now require no protected navigation before success, discarded verification state, awaited best-effort sign-out, fail-closed restoration if cleanup fails, and normal password sign-in as the supported recovery. A fresh code and exactly-once completion are explicitly not promised.

## Historical final-review findings resolved by operator deferral

1. **Blocking — partial token persistence is not fail-closed on restart.** The pinned client writes access and refresh tokens sequentially, removes them sequentially during sign-out, restores from the access-token key alone, and considers any restored access token authenticated. If the refresh-token write fails and later access-token removal also fails, restart can render protected routes despite the contract's fail-closed claim. The contract would need pair-consistency or a durable quarantine plus selective write/remove/restart fault cases.
2. **Blocking — plaintext package logging lacks an executable verification owner.** The package directly logs verification-code creation arguments at DEBUG, while the section 4 strategy assigns no bounded check to verify local deployment logging configuration and observed output. A future strategy must prove the intended console provider is the only plaintext-code path or record a precise verification exception.

The accessibility candidate was rejected as outside this correction's diff scope: existing plan acceptance already covers labels, busy states, alerts, touch targets, font scaling, keyboard reachability, and non-color errors. Runtime VoiceOver, TalkBack, focus, announcement, Dynamic Type, and exact touch-target behavior remain future device-verification gaps, not findings on this documentation correction.

## Review coverage

Fresh read-only lenses covered architecture, simplicity, security/privacy, accessibility, adversarial behavior, product fit, test quality, Convex review, and the deterministic Convex authz scan. A separate skeptic confirmed both blocking findings and rejected the accessibility candidate. Review inspected the exact pinned source for logging, token writes/removals, restoration, and auth-state publication. No production code was edited, no deployment-affecting command was run, and runtime/device behavior remains unverified.

## Recovery note

If an invocation ends unexpectedly, inspect `git status`, `git diff`, `git log -5 --oneline`, this file, and the current checklist section. Do not assume the interrupted invocation succeeded or failed. Preserve valid partial tests and edits, rerun the smallest focused command, and continue only the current handoff transition.
