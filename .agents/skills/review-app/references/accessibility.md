# Accessibility lens

Review the changed user journey, not only isolated JSX props. Static review can identify risks but cannot prove VoiceOver, TalkBack, contrast, keyboard, or motion behavior.

## Controls and semantics

- Every action has an accessible name, role, and useful hint where the result is not obvious.
- Disabled, busy, selected, checked, expanded, and invalid states are exposed through state/value semantics.
- Touch targets are at least 44×44 pt on iOS and 48×48 dp on Android, or have an equivalent hit area without overlapping actions.
- Icon-only and custom controls have equivalent semantics. Informational and decorative images are distinguished.
- Modals contain accessibility focus and hide inactive background content.

## Forms and feedback

- Inputs have persistent visible labels; placeholders are not labels.
- Error text is associated with the relevant field and not communicated by color alone.
- Submission success/failure and asynchronous updates are announced without noisy repetition.
- Focus moves intentionally for invalid forms, dialogs, route changes, and destructive confirmation.
- Keyboard appearance does not obscure fields or actions on small screens.

## Perception and platform behavior

- Text can scale without clipping, overlap, or lost actions.
- Contrast and state cues do not rely on color alone.
- Reading and focus order match visual order.
- Motion respects reduced-motion preferences and is not required to understand state.
- Platform-specific behavior remains coherent on both iOS and Android.

For each finding, name the affected user action and the likely assistive-technology failure. Prefer React Native Testing Library assertions by role, accessible name, and state when tests are warranted. Put device-only checks under residual verification gaps rather than asserting a defect without static evidence.

Runtime verification should follow primary user tasks across every changed screen and meaningful loading, empty, error, and modal state. When applicable, record gaps for VoiceOver, TalkBack, Voice Control, Dynamic Type/large text, increased contrast, reduced motion, light/dark appearance, and external keyboard behavior. Automated checks complement rather than replace assistive-technology testing.
