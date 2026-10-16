#!/usr/bin/env sh
set -eu

WORK_DIR="$(mktemp -d)"
cd "${WORK_DIR}"
npm init -y >/dev/null 2>&1
npm install "$@" >/dev/null
echo "Node runtime: $(node --version), npm: $(npm --version)" >&2
cp /smoke-scripts/package-targets.mjs /smoke-scripts/smoke-keri-installed.mjs /smoke-scripts/keri-consumer.ts "${WORK_DIR}/"
node ./smoke-keri-installed.mjs
echo "Smoke test passed for keri-ts on ${SMOKE_NODE_IMAGE:-node}"
