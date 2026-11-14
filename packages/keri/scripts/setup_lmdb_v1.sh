#!/usr/bin/env bash
set -euo pipefail

# Rebuild the local lmdb-js package trees that Node or Deno actually load for
# this checkout. The key compatibility requirement is LMDB_DATA_V1=true, but on
# macOS/Deno the more subtle failure mode is addon provenance: Deno may load a
# shadow copy under node_modules/.deno/.../node_modules/lmdb instead of the
# top-level node_modules/lmdb tree. If we rebuild only one of those locations,
# we can still execute the wrong native addon and reintroduce old teardown bugs.
#
# The targets are the top-level node_modules/lmdb tree and the tree Deno
# resolves for the pinned npm:lmdb specifier, each compiled once by real path:
# node_modules/lmdb is often a symlink to that same .deno tree. Other .deno
# copies (a stale lockfile specifier such as lmdb@3.4.4) are loaded by nothing
# and are not rebuilt.

log() {
  printf '[setup_lmdb_v1] %s\n' "$*"
}

fail() {
  printf '[setup_lmdb_v1] ERROR: %s\n' "$*" >&2
  exit 1
}

NODE_GYP=""
NODE_GYP_ARGS=(rebuild)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Use the highest ancestor that still owns node_modules. This script may be
# launched from the monorepo root, from packages/keri, or from a nested task.
# We want the real install root that both Node and Deno resolve npm packages
# from, not merely the current working directory.
ROOT_DIR="$(deno run --allow-read "${SCRIPT_DIR}/lmdb/resolve-install-root.ts")"

real_dir() {
  # Physical path of a directory, so a symlink and its target compile once.
  (cd "$1" && pwd -P)
}

materialize_deno_lmdb_dir() {
  # Force Deno to resolve npm:lmdb the same way the live CLI/test process will.
  # This serves two purposes:
  #
  # - it materializes the .deno package tree if Deno has not created it yet
  # - it tells us the exact lmdb package directory Deno will anchor native addon
  #   resolution from for this checkout/config
  #
  # We then rebuild that package tree directly so Deno prefers the local rebuilt
  # addon over a stale or incompatible optional prebuild.
  (
    cd "${ROOT_DIR}"
    deno run --allow-read --config deno.json --node-modules-dir=auto "${SCRIPT_DIR}/lmdb/resolve-deno-lmdb-dir.ts"
  )
}

LMDB_DIRS=()
add_lmdb_dir() {
  local dir
  dir="$(real_dir "$1")"
  # The +-expansion keeps an empty array safe under `set -u` in macOS bash 3.2.
  for existing in ${LMDB_DIRS[@]+"${LMDB_DIRS[@]}"}; do
    if [[ "${existing}" == "${dir}" ]]; then
      log "${1} is ${dir}, already a rebuild target"
      return
    fi
  done
  LMDB_DIRS+=("${dir}")
}

# 1. node_modules/lmdb: the classic npm/Node location, also used by some local
#    tooling flows.
if [[ -d "${ROOT_DIR}/node_modules/lmdb" ]]; then
  add_lmdb_dir "${ROOT_DIR}/node_modules/lmdb"
fi
# 2. The tree Deno's npm compatibility layer loads for npm:lmdb, which can
#    shadow the top-level install and build or resolve a different addon.
if DENO_LMDB_DIR="$(materialize_deno_lmdb_dir)"; then
  DENO_LMDB_DIR="${DENO_LMDB_DIR%/}"
  if [[ -d "${DENO_LMDB_DIR}" ]]; then
    add_lmdb_dir "${DENO_LMDB_DIR}"
  fi
fi

if [[ ${#LMDB_DIRS[@]} -eq 0 ]]; then
  fail "could not locate any lmdb package directories under ${ROOT_DIR}"
fi

log "repo root=${ROOT_DIR}"
for LMDB_DIR in "${LMDB_DIRS[@]}"; do
  log "using LMDB_DIR=${LMDB_DIR}"
  if [[ -f "${LMDB_DIR}/package.json" ]]; then
    log "installed lmdb package:"
    deno run --allow-read "${SCRIPT_DIR}/lmdb/read-package-summary.ts" "${LMDB_DIR}/package.json"
  fi
done
log "node=$(node --version)"
if command -v python3 >/dev/null 2>&1; then
  log "python3=$(python3 --version 2>&1)"
else
  log "python3 not found on PATH"
fi

if npm_root="$(npm root -g 2>/dev/null)"; then
  candidate="${npm_root}/npm/node_modules/node-gyp/bin/node-gyp.js"
  if [[ -f "${candidate}" ]]; then
    NODE_GYP="${candidate}"
  fi
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  # lmdb-js robust mutex support has been unreliable in our macOS maintainer
  # flows, especially when combined with Deno/npm native-addon rebuilds. We
  # intentionally mirror the existing compat rebuild behavior here.
  NODE_GYP_ARGS+=(--use_robust=false)
fi

if [[ -n "${NODE_GYP}" ]]; then
  # Prefer the globally installed node-gyp that ships with npm when available.
  # That gives us a predictable rebuild path even if the local package manager
  # state is partially materialized. Fall back to npm exec for portability.
  log "using global node-gyp at ${NODE_GYP}"
else
  log "using npm exec node-gyp"
fi

for LMDB_DIR in "${LMDB_DIRS[@]}"; do
  log "rebuilding ${LMDB_DIR}"
  (
    cd "${LMDB_DIR}"
    # keri-ts expects LMDB data-v1 locking/layout semantics. Rebuilding without
    # this env var can produce a native addon that passes compilation but fails
    # at runtime or behaves incompatibly with the stores our tests create.
    export LMDB_DATA_V1=true
    # Node-header V8 symbols can load successfully in Deno, then terminate the
    # process when a row exceeds the 16 MiB shared-buffer threshold. The official
    # NAPI build avoids that runtime-specific ABI while retaining data-v1 layout.
    export ENABLE_V8_FUNCTIONS=false
    if [[ -n "${NODE_GYP}" ]]; then
      node "${NODE_GYP}" "${NODE_GYP_ARGS[@]}"
    else
      npm exec --yes node-gyp "${NODE_GYP_ARGS[@]}"
    fi
  ) || fail "node-gyp rebuild failed for ${LMDB_DIR}. Ensure Python and native build tooling are available."
done

log "compat LMDB rebuild completed"
