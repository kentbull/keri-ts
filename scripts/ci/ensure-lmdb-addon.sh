#!/usr/bin/env bash
# Make sure the checkout loads the KERI-compatible prebuilt LMDB addon from @keri-ts/lmdb-js.
#
# Usage: ensure-lmdb-addon.sh <cache-hit>
#   <cache-hit>  "true" when the dependency cache restored an exact entry
#
# @keri-ts/lmdb-js ships its data-v1 N-API addon in a platform package, so nothing is compiled.
# An exact cache hit already holds that package, and the gate (`scripts/ci/report-lmdb-runtime.ts`
# of the checkout) runs first. On a miss, or when the restored tree fails the gate, `deno install`
# fetches the dependencies and the gate must then pass. Run from the checkout whose dependencies
# are installed (for a release, the tag's).
set -euo pipefail

CACHE_HIT="${1:-false}"

step() {
  printf '\n[ensure-lmdb-addon] %s\n' "$*"
}

# 1. A restored tree that passes the gate is used as is.
if [[ "${CACHE_HIT}" == "true" ]]; then
  step "exact cache hit: checking the restored addon"
  if deno run -A scripts/ci/report-lmdb-runtime.ts; then
    step "restored addon passes the gate"
    exit 0
  fi
  step "restored addon failed the gate; reinstalling (bump cachePrefix in scripts/ci/deps-cache-key.ts if this repeats)"
else
  step "no exact cache hit: installing"
fi

# 2. Install the dependency graph, which selects the platform package, then require the gate to pass.
deno install
deno run -A scripts/ci/report-lmdb-runtime.ts
step "installed addon passes the gate"
