#!/usr/bin/env bash
set -euo pipefail

URL=${1:-}
OUT=${2:-}

if [[ ! $URL =~ ^https://claude\.ai/code/artifact/[0-9A-Za-z-]+([/?#].*)?$ ]]; then
  echo "usage: $0 https://claude.ai/code/artifact/<id> [output-directory]" >&2
  exit 64
fi

if [[ -z $OUT ]]; then
  OUT=$(mktemp -d /tmp/claude-design-artifact.XXXXXX)
else
  mkdir -p "$OUT"
  OUT=$(cd "$OUT" && pwd -P)
fi

CHROME=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  if [[ -x $candidate ]]; then
    CHROME=$candidate
    break
  fi
done
if [[ -z $CHROME ]]; then
  echo "No supported system Chrome executable found" >&2
  exit 69
fi

PW_PACKAGE=${PW_PACKAGE:-}
if [[ -z $PW_PACKAGE ]]; then
  shopt -s nullglob
  candidates=(
    "$HOME"/.local/share/mise/installs/npm-playwright/*/*/.pnpm/playwright@*/node_modules/playwright
    "$(npm root -g 2>/dev/null || true)"/playwright
  )
  shopt -u nullglob
  for candidate in "${candidates[@]}"; do
    if [[ -f $candidate/package.json ]]; then
      PW_PACKAGE=$candidate
      break
    fi
  done
fi
if [[ -z $PW_PACKAGE || ! -f $PW_PACKAGE/package.json ]]; then
  echo "Playwright package not found; install Playwright or set PW_PACKAGE" >&2
  exit 69
fi

TMP_SCRIPT=$(mktemp /tmp/inspect-claude-design-artifact.XXXXXX.cjs)
trap 'rm -f "$TMP_SCRIPT"' EXIT
cat >"$TMP_SCRIPT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PW_PACKAGE);

const url = process.argv[2];
const out = process.argv[3];
const executablePath = process.env.CHROME;
const responses = [];
let browser;

(async () => {
  browser = await chromium.launch({ headless: false, executablePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('response', (response) => {
    const responseUrl = response.url();
    if (responseUrl.includes('/api/frame/') || responseUrl.includes('frame.claudeusercontent.com')) {
      responses.push({ status: response.status(), url: responseUrl });
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  let artifactFrame = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    artifactFrame = page.frames().find((frame) => frame.url().includes('frame.claudeusercontent.com')) ?? null;
    if (artifactFrame) break;
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: path.join(out, 'page.png'), fullPage: true });
  const shellText = await page.locator('body').innerText().catch(() => '');
  const metadata = {
    requestedUrl: url,
    finalUrl: page.url(),
    title: await page.title(),
    artifactFrameUrl: artifactFrame?.url() ?? null,
    responses,
    shellText: shellText.slice(0, 2000),
  };

  if (!artifactFrame) {
    fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify(metadata, null, 2));
    console.log(JSON.stringify({ ok: false, outputDirectory: out, metadata }, null, 2));
    process.exitCode = 2;
    return;
  }

  const body = artifactFrame.locator('body');
  const artifactText = await body.innerText();
  fs.writeFileSync(path.join(out, 'artifact.txt'), artifactText);
  await body.screenshot({ path: path.join(out, 'artifact.png') });
  metadata.artifactTextCharacters = artifactText.length;
  fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify({
    ok: artifactText.trim().length > 0,
    outputDirectory: out,
    artifactFrameUrl: metadata.artifactFrameUrl,
    artifactTextCharacters: artifactText.length,
    responses,
  }, null, 2));
})().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
});
NODE

CHROME=$CHROME PW_PACKAGE=$PW_PACKAGE node "$TMP_SCRIPT" "$URL" "$OUT"
echo "Claude artifact inspection output: $OUT"
