#!/usr/bin/env bash
set -euo pipefail

# Rebuild, install, and smoke-test the local npm tarballs for `cesr-ts` and
# `tufa`.
deno task npm:build:all

TUFA_TARBALL="$(cd packages/tufa/npm && npm pack --silent | tail -n1)"
CESR_TARBALL="$(cd packages/cesr/npm && npm pack --silent | tail -n1)"
TUFA_TARBALL_PATH="$PWD/packages/tufa/npm/$TUFA_TARBALL"
CESR_TARBALL_PATH="$PWD/packages/cesr/npm/$CESR_TARBALL"

echo "Installing local cesr-ts tarball globally: $CESR_TARBALL_PATH"
npm install -g "$CESR_TARBALL_PATH"

echo "Installing local tufa tarball globally: $TUFA_TARBALL_PATH"
npm install -g "$TUFA_TARBALL_PATH"

echo "Running tarball smoke test"
bash scripts/smoke-test-tufa-npm.sh \
  "$TUFA_TARBALL_PATH" \
  "$CESR_TARBALL_PATH"
