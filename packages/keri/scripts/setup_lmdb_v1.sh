#!/usr/bin/env bash
set -euo pipefail

# Rebuild every local lmdb-js package tree that Node or Deno may actually load
# for this checkout. The key compatibility requirement is LMDB_DATA_V1=true, but
# on macOS/Deno the more subtle failure mode is addon provenance: Deno may load
# a shadow copy under node_modules/.deno/.../node_modules/lmdb instead of the
# top-level node_modules/lmdb tree. If we rebuild only one of those locations,
# we can still execute the wrong native addon and reintroduce old teardown bugs.

log() {
  printf '[setup_lmdb_v1] %s\n' "$*"
}

fail() {
  printf '[setup_lmdb_v1] ERROR: %s\n' "$*" >&2
  exit 1
}

NODE_GYP=""
NODE_GYP_ARGS=(rebuild)
# Use the highest ancestor that still owns node_modules. This script may be
# launched from the monorepo root, from packages/keri, or from a nested task.
# We want the real install root that both Node and Deno resolve npm packages
# from, not merely the current working directory.
ROOT_DIR="$(node -p "const fs=require('fs'); const p=require('path'); let dir=process.cwd(); let found=''; while (true) { if (fs.existsSync(p.join(dir,'node_modules'))) found=dir; const parent=p.dirname(dir); if (parent === dir) break; dir=parent; } if (found) { console.log(found); process.exit(0); } process.exit(1);")"

collect_lmdb_dirs() {
  # Collect all already-materialized lmdb package directories that may be
  # selected at runtime.
  #
  # 1. node_modules/lmdb
  #    This is the classic npm/Node location and is also used by some local
  #    tooling flows.
  #
  # 2. node_modules/.deno/*/node_modules/lmdb
  #    Deno's npm compatibility layer can shadow the top-level install with a
  #    per-package copy under .deno. That copy may build or resolve a different
  #    native addon than the top-level tree, so it must be rebuilt too.
  ROOT_DIR="${ROOT_DIR}" node <<'NODE'
const fs = require('fs');
const p = require('path');

const root = process.env.ROOT_DIR;
const dirs = new Set();

const nodeModulesLm = p.join(root, 'node_modules', 'lmdb');
if (fs.existsSync(nodeModulesLm)) {
  dirs.add(nodeModulesLm);
}

const denoRoot = p.join(root, 'node_modules', '.deno');
if (fs.existsSync(denoRoot)) {
  for (const entry of fs.readdirSync(denoRoot)) {
    const candidate = p.join(denoRoot, entry, 'node_modules', 'lmdb');
    if (fs.existsSync(candidate)) {
      dirs.add(candidate);
    }
  }
}

for (const dir of dirs) {
  console.log(dir);
}
NODE
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
    deno eval --config deno.json --node-modules-dir=auto --print \
      'new URL(".", import.meta.resolve("npm:lmdb@3.5.3")).pathname'
  )
}

mapfile -t LMDB_DIRS < <(collect_lmdb_dirs)
if DENO_LMDB_DIR="$(materialize_deno_lmdb_dir)"; then
  DENO_LMDB_DIR="${DENO_LMDB_DIR%/}"
  if [[ -d "${DENO_LMDB_DIR}" ]]; then
    # Deno may resolve to a path we did not see in the filesystem scan yet, or
    # to the same one with slightly different formatting. De-duplicate by exact
    # path and add it if needed so the runtime-selected tree is always rebuilt.
    already_present=0
    for LMDB_DIR in "${LMDB_DIRS[@]}"; do
      if [[ "${LMDB_DIR}" == "${DENO_LMDB_DIR}" ]]; then
        already_present=1
        break
      fi
    done
    if [[ ${already_present} -eq 0 ]]; then
      LMDB_DIRS+=("${DENO_LMDB_DIR}")
    fi
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
    node -e "const pkg=require(process.argv[1]); console.log(JSON.stringify({name:pkg.name, version:pkg.version, repository:pkg.repository?.url ?? pkg.repository}, null, 2))" "${LMDB_DIR}/package.json"
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
    if [[ -n "${NODE_GYP}" ]]; then
      node "${NODE_GYP}" "${NODE_GYP_ARGS[@]}"
    else
      npm exec --yes node-gyp "${NODE_GYP_ARGS[@]}"
    fi
  ) || fail "node-gyp rebuild failed for ${LMDB_DIR}. Ensure Python and native build tooling are available."
done

log "compat LMDB rebuild completed"
