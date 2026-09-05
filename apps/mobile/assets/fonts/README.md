# Bundled typography

The app registers five unmodified static TTFs from the official Expo Google
Fonts npm packages, pinned by `pnpm-lock.yaml`:

- `@expo-google-fonts/barlow@0.4.1`: 400 Regular, 500 Medium,
  600 Semibold, 700 Bold.
- `@expo-google-fonts/barlow-condensed@0.4.1`: 600 Semibold.

Sources: https://github.com/expo/google-fonts and
https://github.com/jpt/barlow (the Barlow Project Authors, copyright 2017).
Both packages include the same SIL Open Font License 1.1 in `LICENSE_FONT`;
that license is retained here as `LICENSE.txt`. The package wrapper is MIT.
Only the five individual local TTF asset paths in `src/theme/fonts.ts` are
registered; there is no runtime font download. Expo Font loads these bundled
assets before mounting the existing auth/migration tree.

Shared Typography uses Barlow for body copy, labels, and captions, and Barlow
Condensed Semibold for heading variants, overlines, and semantic headers.
NativeWind resolves class and inline styles before face selection. Explicit
body 400/500/600/700 weights (including normal/medium/semibold/bold aliases)
select individual faces; native fontWeight is normalized only for those
bundled faces. Caller-specified font families and weights remain intact.
Unsupported body weights retain native weight behavior instead of silently
becoming regular. Heading variants deliberately default to condensed 600. TextField uses Barlow
Regular. This intentionally affects existing auth/onboarding/account UI as
well as Counts. Native glyph clipping, Dynamic Type, and auth screen visual
regressions still require rendered verification.
