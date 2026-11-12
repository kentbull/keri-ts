#!/usr/bin/env bash
# Usage: scripts/ci/playwright-version.sh
#
# Print the playwright-core version the browser lane imports, read from the one place it
# is pinned (packages/keri/scripts/browser_lane.ts). In GitHub Actions the version is
# also written to $GITHUB_OUTPUT as `version=` so the browser cache can be keyed on it.
set -euo pipefail

runner="$(dirname "$0")/../../packages/keri/scripts/browser_lane.ts"
version="$(grep -oE 'playwright-core@[0-9]+\.[0-9]+\.[0-9]+' "$runner" | head -n 1 | cut -d@ -f2)"

if [[ -z "$version" ]]; then
  echo "playwright-version: no playwright-core@X.Y.Z import found in $runner" >&2
  exit 1
fi

echo "$version"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "version=$version" >> "$GITHUB_OUTPUT"
fi
