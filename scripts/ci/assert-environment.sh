#!/usr/bin/env bash
# CI environment probe used by multiple workflows.
# Purpose:
# - fail early if Node/Deno pins drift from what the workflow declared
# - print the active runtime toolchain into the job log
# - surface LMDB and optional KERIpy/KLI state before tests start
# This script is intentionally read-only; it documents and validates the
# environment contract but does not mutate it.
set -euo pipefail

assert_exact_version() {
  local tool="$1"
  local expected="$2"
  local actual="$3"

  if [[ -n "${expected}" && "${actual}" != "${expected}" ]]; then
    echo "Expected ${tool} ${expected}, got ${actual}." >&2
    exit 1
  fi
}

NODE_VERSION="$(node --version | sed 's/^v//')"
NPM_VERSION="$(npm --version)"
DENO_VERSION="$(deno --version | awk 'NR==1{print $2}')"

# Hard fail on version drift so the workflow cannot silently run on a different
# runtime than the maintainer thought they pinned in YAML.
assert_exact_version "Node" "${EXPECTED_NODE_VERSION:-}" "${NODE_VERSION}"
assert_exact_version "Deno" "${EXPECTED_DENO_VERSION:-}" "${DENO_VERSION}"

echo "Node: v${NODE_VERSION}"
echo "npm: ${NPM_VERSION}"
echo "Deno:"
deno --version

if command -v python >/dev/null 2>&1; then
  echo "Python: $(python --version 2>&1)"
else
  echo "Python: not installed"
fi

echo "LMDB_DATA_V1: ${LMDB_DATA_V1:-unset}"

# LMDB version/path output is especially useful in this repo because KERIpy
# interop depends on the native addon being rebuilt with LMDB data-format v1.
node <<'EOF'
const fs = require("fs");
const path = require("path");

try {
  const lmdbDir = path.dirname(path.dirname(require.resolve("lmdb")));
  const pkg = JSON.parse(
    fs.readFileSync(path.join(lmdbDir, "package.json"), "utf8"),
  );
  console.log(`lmdb: ${pkg.version}`);
  console.log(`lmdb dir: ${lmdbDir}`);
} catch {
  console.log("lmdb: not installed");
}
EOF

if command -v kli >/dev/null 2>&1; then
  echo "kli path: $(command -v kli)"
  if kli version >/dev/null 2>&1; then
    echo "KLI version:"
    kli version
  else
    echo "KLI help:"
    kli --help | sed -n '1,2p'
  fi
elif [[ "${EXPECT_KLI:-false}" == "true" ]]; then
  # Some jobs require pinned KERIpy to exist before tests begin. Make that
  # requirement explicit instead of letting failures show up later and noisier.
  echo "Expected kli to be installed, but it was not found on PATH." >&2
  exit 1
else
  echo "kli: not installed"
fi
