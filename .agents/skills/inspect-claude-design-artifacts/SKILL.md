---
name: inspect-claude-design-artifacts
description: Use when a user supplies a `claude.ai/code/artifact/...` link and asks to inspect, extract, screenshot, or compare a Claude Design artifact, especially when curl or headless Playwright returns 403 or a misleading Page not found response even though the link opens in Incognito.
---

# Inspect Claude Design artifacts

## Overview

Treat a headless `403` as possible bot detection, not proof that an artifact is private. Use a clean **headful** Chrome context, locate the mounted `frame.claudeusercontent.com` iframe, and inspect that frame rather than the outer Claude shell.

Never open the user's normal browser profile or reuse cookies, credentials, or authenticated sessions.

## Workflow

1. Validate that the URL matches `https://claude.ai/code/artifact/<id>`.
2. A normal fetch may identify the shell, but it does not prove artifact accessibility.
3. If curl, web fetch, or headless Playwright returns `403` or `Page not found`, run the bundled inspector with headful system Chrome:

```bash
SKILL_DIR="$HOME/.agents/skills/inspect-claude-design-artifacts"
"$SKILL_DIR/scripts/inspect-artifact.sh" "$ARTIFACT_URL"
```

The script prints an output directory containing:

- `artifact.txt`: complete rendered text from the artifact frame
- `artifact.png`: visible artifact-frame capture
- `page.png`: outer-page capture
- `metadata.json`: page title, response evidence, and resolved frame URL

4. Confirm success from evidence, not appearance alone:
   - artifact API response is `200`;
   - a `frame.claudeusercontent.com` frame mounted;
   - `artifact.txt` contains substantive design content rather than Claude navigation.
5. Search the full text for the requested screen or section. Artifacts can contain long internal canvases whose relevant content is below the first viewport.
6. For visual comparison, use the relevant frame plus the implementation screenshot. Compare hierarchy, geometry, typography, spacing, colors, borders, shadows, controls, and responsive framing. Separate visual mismatches from functionality that has not been implemented.
7. Close the browser and leave transient captures under `/tmp` unless the user requests another location.

## Access classification

| Evidence | Conclusion |
|---|---|
| Headless `403`, `Page not found`, or Cloudflare challenge | Inconclusive; retry headful |
| Headful clean Chrome mounts artifact frame with substantive text | Publicly accessible |
| Headful clean Chrome gets an explicit authorization/request-access response | Restricted |
| Outer shell loads but no artifact frame appears | Retrieval failed; report exact response evidence |
| Artifact frame loads but requested screen is absent | Artifact accessible; requested design not present |

## Safety rules

- Use `chromium.launch({ headless: false })` with system Chrome; Playwright's ordinary launch creates a temporary profile.
- Never use `launchPersistentContext` with the user's Chrome data directory.
- Never copy cookies, read browser databases, automate an authenticated profile, or ask for credentials merely to inspect a public artifact.
- A temporary browser window appearing briefly is expected; close it automatically.
- Do not modify project files while retrieving an artifact.

## Common mistakes

| Mistake | Corrective action |
|---|---|
| Calling the artifact private after one headless `403` | Retry with clean headful Chrome and inspect response evidence |
| Reading only the outer page title or body | Locate the `frame.claudeusercontent.com` child frame |
| Comparing only the first visible board | Search all of `artifact.txt` for the requested flow |
| Using the user's signed-in Chrome profile | Use Playwright's temporary context with system Chrome |
| Reporting telemetry `403`s as retrieval failure | Judge the artifact API and mounted frame; telemetry may fail independently |

## Example

For a user asking, “Compare my sign-in implementation with this Claude artifact,” retrieve the artifact, find `SIGN IN` or `WELCOME BACK` in `artifact.txt`, capture the relevant design area when possible, then report strong matches, definite mismatches, screenshot-scaling uncertainty, and a prioritized correction order.
