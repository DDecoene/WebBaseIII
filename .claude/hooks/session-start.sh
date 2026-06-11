#!/bin/bash
set -euo pipefail

# Only needed in Claude Code on the web remote containers.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

npm install

# Install the Playwright Chromium browsers (linux-x64).
# Preferred path: the official installer. Some remote network policies block
# cdn.playwright.dev (and apt PPAs needed by --with-deps), so fall back to
# downloading the same Chrome for Testing build from Google's public bucket.
BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

read -r REVISION VERSION < <(node -e "
const b = JSON.parse(require('fs').readFileSync('node_modules/playwright-core/browsers.json', 'utf8'))
  .browsers.find(x => x.name === 'chromium');
console.log(b.revision, b.browserVersion);
")

if [ -x "$BROWSERS_DIR/chromium-$REVISION/chrome-linux64/chrome" ] &&
   [ -x "$BROWSERS_DIR/chromium_headless_shell-$REVISION/chrome-headless-shell-linux64/chrome-headless-shell" ]; then
  echo "Playwright Chromium r$REVISION already installed in $BROWSERS_DIR"
elif npx playwright install chromium --with-deps; then
  echo "Playwright Chromium installed via official installer"
else
  echo "playwright install failed — falling back to Chrome for Testing $VERSION"
  CFT="https://storage.googleapis.com/chrome-for-testing-public/$VERSION/linux64"
  tmp=$(mktemp -d)
  curl -fsSL "$CFT/chrome-linux64.zip" -o "$tmp/chrome.zip"
  curl -fsSL "$CFT/chrome-headless-shell-linux64.zip" -o "$tmp/shell.zip"
  mkdir -p "$BROWSERS_DIR/chromium-$REVISION" "$BROWSERS_DIR/chromium_headless_shell-$REVISION"
  unzip -q -o "$tmp/chrome.zip" -d "$BROWSERS_DIR/chromium-$REVISION/"
  unzip -q -o "$tmp/shell.zip" -d "$BROWSERS_DIR/chromium_headless_shell-$REVISION/"
  touch "$BROWSERS_DIR/chromium-$REVISION/INSTALLATION_COMPLETE" \
        "$BROWSERS_DIR/chromium_headless_shell-$REVISION/INSTALLATION_COMPLETE"
  rm -rf "$tmp"
  "$BROWSERS_DIR/chromium-$REVISION/chrome-linux64/chrome" --version
fi
