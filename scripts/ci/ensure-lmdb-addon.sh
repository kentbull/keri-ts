#!/usr/bin/env bash
# Make sure the checkout loads the KERI-compatible LMDB-js addon, rebuilding it only when needed.
#
# Usage: ensure-lmdb-addon.sh <cache-hit>
#   <cache-hit>  "true" when the dependency cache restored an exact entry (common-release-setup).
#
# An exact cache hit already contains the rebuilt addon, so the gate (`scripts/ci/report-lmdb-runtime.ts`
# of the checkout) runs first and nothing is compiled when it passes. On a miss, or when the restored addon
# fails the gate, the checkout's own `deno task setup:compat-lmdb` rebuilds it and the gate must then pass.
# Run from the checkout whose dependencies are installed (for a release, the tag's).
set -euo pipefail

CACHE_HIT="${1:-false}"

step() {
  printf '\n[ensure-lmdb-addon] %s\n' "$*"
}

# 1. A restored addon that passes the gate is used as is.
if [[ "${CACHE_HIT}" == "true" ]]; then
  step "exact cache hit: checking the restored addon"
  if deno run -A scripts/ci/report-lmdb-runtime.ts; then
    step "restored addon passes the gate; nothing to rebuild"
    exit 0
  fi
  step "restored addon failed the gate; rebuilding (bump cachePrefix in scripts/ci/deps-cache-key.ts if this repeats)"
else
  step "no exact cache hit: rebuilding"
fi

# 2. Rebuild with the checkout's own LMDB setup, then require the gate to pass.
deno task setup:compat-lmdb
deno run -A scripts/ci/report-lmdb-runtime.ts
step "rebuilt addon passes the gate"
