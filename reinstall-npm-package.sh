#!/usr/bin/env bash
set -euo pipefail

# Rebuild, install, and smoke-test the local npm tarballs for `cesr-ts` and
# `keri-ts` / `tufa`.
deno task npm:build:all

KERI_TARBALL="$(cd packages/keri/npm && npm pack --silent | tail -n1)"
CESR_TARBALL="$(cd packages/cesr/npm && npm pack --silent | tail -n1)"
KERI_TARBALL_PATH="$PWD/packages/keri/npm/$KERI_TARBALL"
CESR_TARBALL_PATH="$PWD/packages/cesr/npm/$CESR_TARBALL"

echo "Installing local cesr-ts tarball globally: $CESR_TARBALL_PATH"
npm install -g "$CESR_TARBALL_PATH"

echo "Installing local keri-ts tarball globally: $KERI_TARBALL_PATH"
npm install -g "$KERI_TARBALL_PATH"

echo "Running tarball smoke test"
bash scripts/smoke-test-keri-npm.sh \
  "$KERI_TARBALL_PATH" \
  "$CESR_TARBALL_PATH"

