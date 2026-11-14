#!/usr/bin/env sh
# Container half of smoke-test-package-npm.sh: install one packed @keri-ts package into a fresh project and
# run its installed-package probe (smoke-tufa-runtime.mjs).
# Usage: smoke-package-container.sh <package> <package.tgz> [local dependency .tgz...]
# Internal dependencies come from the npm registry at the versions the package pins, unless a local tarball
# for that exact name@version is given (a release dry run of versions npm does not have yet).
set -eu

PACKAGE="${1:?package is required}"
shift

WORK_DIR="$(mktemp -d)"
cd "${WORK_DIR}"
npm init -y >/dev/null 2>&1
npm install "$@" >/dev/null
echo "Node runtime: $(node --version), npm: $(npm --version)" >&2

cp /smoke-scripts/smoke-tufa-runtime.mjs "${WORK_DIR}/"
node ./smoke-tufa-runtime.mjs "${WORK_DIR}/node_modules/@keri-ts/${PACKAGE}" "${PACKAGE}"

echo "Smoke test passed for @keri-ts/${PACKAGE} on ${SMOKE_NODE_IMAGE:-node}"
