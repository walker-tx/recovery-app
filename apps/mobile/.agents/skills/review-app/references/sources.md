# Review workflow research sources

The local `review-app` skill uses repository-specific wording and does not vendor the following workflows. These sources informed its orchestration and lens design.

- [Dimillian review-swarm](https://github.com/Dimillian/Skills/tree/main/review-swarm) (MIT): shared intent packet, independent read-only reviewers, and parent synthesis.
- [Liatrio Code Gauntlet](https://github.com/liatrio-labs/claude-code-gauntlet) (Apache-2.0): independent validation, blind challenge, and false-positive controls.
- [Addy Osmani code-review-and-quality](https://github.com/addyosmani/agent-skills/tree/main/skills/code-review-and-quality) (MIT): shallow orchestration, preference-resistant review, and concrete structural remedies.
- [Dietrich Gebert ponytail-review](https://github.com/DietrichGebert/ponytail/tree/main/skills/ponytail-review) (MIT): narrowly scoped over-engineering review and concrete deletion taxonomy.
- [Community Access mobile accessibility](https://github.com/Community-Access/accessibility-agents) (MIT): React Native accessibility semantics and platform touch-target guidance.
- [Apple accessibility-audit skill](https://github.com/rshankras/claude-code-apple-skills/tree/main/skills/ios/accessibility-audit) (MIT): task-based device verification and conservative runtime claims.
- [GitHub gh-stack](https://github.com/github/gh-stack/tree/main/skills/gh-stack) (MIT): ordered stack model and immediate-parent layer scope.
- [PyGraphistry review skill](https://github.com/graphistry/pygraphistry/tree/master/agents/skills/review) (BSD-3-Clause): exact base/head scope and parent/current/child responsibility.
- [phuryn PM skills](https://github.com/phuryn/pm-skills) (MIT): sourced outcomes, observable acceptance criteria, and intended-versus-implemented analysis.
- [Trail of Bits differential-review](https://github.com/trailofbits/skills/tree/main/plugins/differential-review) (CC BY-SA 4.0): concrete attacker model, current reachability, history-aware trust-boundary review, and explicit coverage limitations. Only general concepts were independently expressed; no prompt text was copied.

Official project-specific review evidence continues to come from the installed Convex and Expo skills and from `docs/architecture.md`. External popularity is not proof of correctness; every borrowed pattern was narrowed to this mobile Expo + Convex repository and to a read-only Kit workflow.
