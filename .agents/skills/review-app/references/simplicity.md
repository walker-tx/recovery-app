# Simplicity lens

Review only unnecessary complexity. Leave correctness, security, accessibility, performance, and product fit to their own lenses. A short implementation is not automatically a simple or safe implementation.

Report only a demonstrated opportunity with an exact location, what can be removed, and the smaller concrete replacement. Useful categories:

- `delete` — dead code, unused compatibility, or speculative behavior; nothing replaces it.
- `stdlib` — hand-rolled behavior already provided by the language standard library.
- `platform` — code or a dependency replaced by an installed-version Expo, React Native, React, or Convex capability.
- `yagni` — unused configurability, a one-implementation abstraction, or a pass-through layer with one caller.
- `shrink` — the same contract and safety properties with materially less control flow or fewer concepts.

Require evidence that flexibility is unused. Verify any proposed native/platform replacement exists in the versions installed by this repository. Estimate removed concepts and indirection before line count. If nothing meaningful can be removed, report `Lean already.`

Never flag required runtime validators, authentication, authorization, indexes, transaction boundaries, generated-code boundaries, SecureStore handling, route/layout boundaries, platform behavior, accessibility semantics, negative security tests, or meaningful smoke tests merely because they add code. Never replace mature validation or safety behavior with a toy heuristic just to reduce lines.

This lens adapts the narrow deletion-oriented approach of Dietrich Gebert's MIT-licensed `ponytail-review`; see `sources.md`.
