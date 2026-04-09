#!/usr/bin/env bash
set -euo pipefail

# Rebuild, install, and smoke-test the local npm tarballs for `cesr-ts`,
# `keri-ts`, and `tufa`.
deno task npm:build:all

TUFA_TARBALL="$(cd packages/tufa/npm && npm pack --silent | tail -n1)"
KERI_TARBALL="$(cd packages/keri/npm && npm pack --silent | tail -n1)"
CESR_TARBALL="$(cd packages/cesr/npm && npm pack --silent | tail -n1)"
TUFA_TARBALL_PATH="$PWD/packages/tufa/npm/$TUFA_TARBALL"
KERI_TARBALL_PATH="$PWD/packages/keri/npm/$KERI_TARBALL"
CESR_TARBALL_PATH="$PWD/packages/cesr/npm/$CESR_TARBALL"

echo "Installing local cesr-ts tarball globally: $CESR_TARBALL_PATH"
npm install -g "$CESR_TARBALL_PATH"

echo "Installing local keri-ts tarball globally: $KERI_TARBALL_PATH"
npm install -g "$KERI_TARBALL_PATH"

# Reinstalling Tufa should be idempotent across both the old unscoped package
# name and the scoped `@keri-ts/tufa` publish target.
if npm ls -g --depth=0 @keri-ts/tufa >/dev/null 2>&1; then
  echo "Removing existing global @keri-ts/tufa package before reinstall"
  npm uninstall -g @keri-ts/tufa >/dev/null 2>&1 || true
fi
if npm ls -g --depth=0 tufa >/dev/null 2>&1; then
  echo "Removing existing legacy global tufa package before reinstall"
  npm uninstall -g tufa >/dev/null 2>&1 || true
fi

echo "Installing local tufa tarball globally with local keri-ts and cesr-ts dependencies: $TUFA_TARBALL_PATH"
npm install -g --force \
  "$CESR_TARBALL_PATH" \
  "$KERI_TARBALL_PATH" \
  "$TUFA_TARBALL_PATH"

echo "Running tarball smoke test"
bash scripts/smoke-test-tufa-npm.sh \
  "$TUFA_TARBALL_PATH" \
  "$CESR_TARBALL_PATH" \
  "$KERI_TARBALL_PATH"
