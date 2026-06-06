#!/usr/bin/env bash
# Smoke-test a packed `keri-ts` npm library artifact by installing the tarball
# into a fresh runtime and verifying only the supported library entrypoints are
# public.
# Optional second arg:
# - a locally built `cesr-ts` tarball, so smoke tests validate the artifact pair
#   produced by this repo rather than whatever CESR version is on npm.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/packages/keri/npm"

TARBALL_PATH="${1:-}"
CESR_TARBALL_PATH="${2:-}"
if [[ -z "${TARBALL_PATH}" ]]; then
  echo "No tarball provided; building and packing keri-ts..."
  (
    cd "${ROOT_DIR}/packages/keri"
    deno task build:npm
  )
  TARBALL_NAME="$(cd "${PACKAGE_DIR}" && npm pack --silent | tail -n1)"
  TARBALL_PATH="${PACKAGE_DIR}/${TARBALL_NAME}"
fi

if [[ ! -f "${TARBALL_PATH}" ]]; then
  echo "Tarball not found: ${TARBALL_PATH}" >&2
  exit 1
fi

assert_tarball_export_targets() {
  local manifest_json
  local target_paths
  manifest_json="$(tar -xOzf "${TARBALL_PATH}" package/package.json)"
  target_paths="$(MANIFEST_JSON="${manifest_json}" node --input-type=module - <<'EOF'
const manifest = JSON.parse(process.env.MANIFEST_JSON ?? "{}");
const targets = [];

function collectTarget(target) {
  if (typeof target === "string") {
    targets.push(target);
    return;
  }
  if (!target || typeof target !== "object") {
    return;
  }
  for (const value of Object.values(target)) {
    collectTarget(value);
  }
}

collectTarget(manifest.main);
collectTarget(manifest.module);
collectTarget(manifest.types);
for (const target of Object.values(manifest.exports ?? {})) {
  collectTarget(target);
}

for (const target of [...new Set(targets)]) {
  if (!target.startsWith("./")) {
    continue;
  }
  console.log(`package/${target.slice(2)}`);
}
EOF
)"

  if [[ -z "${target_paths}" ]]; then
    echo "No package export targets found in ${TARBALL_PATH}" >&2
    exit 1
  fi

  local listing
  listing="$(tar -tzf "${TARBALL_PATH}")"
  while IFS= read -r target_path; do
    if ! grep -qxF "${target_path}" <<<"${listing}"; then
      echo "Packed tarball is missing package export target: ${target_path}" >&2
      echo "Export targets:" >&2
      echo "${target_paths}" >&2
      echo "Matching package contents:" >&2
      grep -E '^package/(package\.json|esm/|types/)' <<<"${listing}" | head -200 >&2
      exit 1
    fi
  done <<<"${target_paths}"
}

assert_tarball_export_targets

TARBALL_DIR="$(cd "$(dirname "${TARBALL_PATH}")" && pwd)"
TARBALL_NAME="$(basename "${TARBALL_PATH}")"
INSTALL_TARGETS=("/pkg/${TARBALL_NAME}")
DOCKER_ARGS=(-v "${TARBALL_DIR}:/pkg")

if [[ -n "${CESR_TARBALL_PATH}" ]]; then
  if [[ ! -f "${CESR_TARBALL_PATH}" ]]; then
    echo "CESR tarball not found: ${CESR_TARBALL_PATH}" >&2
    exit 1
  fi

  CESR_TARBALL_DIR="$(cd "$(dirname "${CESR_TARBALL_PATH}")" && pwd)"
  CESR_TARBALL_NAME="$(basename "${CESR_TARBALL_PATH}")"
  DOCKER_ARGS+=(-v "${CESR_TARBALL_DIR}:/cesr-pkg")
  INSTALL_TARGETS=("/cesr-pkg/${CESR_TARBALL_NAME}" "${INSTALL_TARGETS[@]}")
fi

SMOKE_NODE_IMAGE="${SMOKE_NODE_IMAGE:-node:alpine}"

echo "Running Docker smoke test with ${TARBALL_NAME} on ${SMOKE_NODE_IMAGE}"
docker run --rm \
  "${DOCKER_ARGS[@]}" \
  "${SMOKE_NODE_IMAGE}" /bin/sh -lc "
set -eu
WORK_DIR=\$(mktemp -d)
cd \"\$WORK_DIR\"
npm init -y >/dev/null 2>&1
npm install ${INSTALL_TARGETS[*]} >/dev/null
echo \"Node runtime: \$(node --version), npm: \$(npm --version)\" >&2
node --input-type=module - <<'EOF'
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as keri from 'keri-ts';
import * as runtime from 'keri-ts/runtime';
import * as db from 'keri-ts/db';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageRoot = 'node_modules/keri-ts';
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const targetPaths = new Set();

function collectTarget(target) {
  if (typeof target === 'string') {
    targetPaths.add(target);
    return;
  }
  if (!target || typeof target !== 'object') {
    return;
  }
  for (const value of Object.values(target)) {
    collectTarget(value);
  }
}

collectTarget(manifest.main);
collectTarget(manifest.module);
collectTarget(manifest.types);
for (const target of Object.values(manifest.exports ?? {})) {
  collectTarget(target);
}

for (const target of targetPaths) {
  if (!target.startsWith('./')) {
    continue;
  }
  const installedPath = join(packageRoot, target.slice(2));
  assert(
    existsSync(installedPath),
    'installed keri-ts package is missing export target ' + target,
  );
}

assert(typeof keri.PACKAGE_VERSION === 'string' && keri.PACKAGE_VERSION.length > 0, 'keri-ts root missing PACKAGE_VERSION');
assert(typeof keri.DISPLAY_VERSION === 'string' && keri.DISPLAY_VERSION.length > 0, 'keri-ts root missing DISPLAY_VERSION');
assert(typeof runtime.createAgentRuntime === 'function', 'keri-ts/runtime missing createAgentRuntime');
assert(typeof db.createBaser === 'function', 'keri-ts/db missing createBaser');

assert(!('startServer' in keri), 'keri-ts root leaked startServer');
assert(!('createTufaApp' in keri), 'keri-ts root leaked createTufaApp');
assert(!('tufa' in keri), 'keri-ts root leaked tufa CLI');
assert(!('reportCliFailure' in keri), 'keri-ts root leaked CLI failure helper');

console.error('keri-ts root exports:', Object.keys(keri).sort().join(', '));
console.error('keri-ts/runtime exports:', Object.keys(runtime).slice(0, 12).sort().join(', '));
console.error('keri-ts/db exports:', Object.keys(db).slice(0, 12).sort().join(', '));
EOF
echo \"Smoke test passed for keri-ts on ${SMOKE_NODE_IMAGE}\"
"
