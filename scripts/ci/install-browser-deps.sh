#!/usr/bin/env bash
# Usage: scripts/ci/install-browser-deps.sh
#
# Make a Linux runner able to run the three-engine browser lane: install the system
# libraries WebKit and Firefox need, then the Chromium, Firefox and WebKit binaries at the
# version the lane pins. This is the scripted equivalent of `playwright install --with-deps`.
# The binary download is a no-op when the Playwright cache was restored.
set -euo pipefail

version="$("$(dirname "$0")/playwright-version.sh")"
engines=(chromium firefox webkit)

echo "Installing system dependencies for: ${engines[*]} (playwright-core $version)"
sudo env "PATH=$PATH" npx --yes "playwright-core@$version" install-deps "${engines[@]}"

echo "Installing browser binaries"
npx --yes "playwright-core@$version" install "${engines[@]}"
