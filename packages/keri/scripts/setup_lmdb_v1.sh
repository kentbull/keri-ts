#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[setup_lmdb_v1] %s\n' "$*"
}

fail() {
  printf '[setup_lmdb_v1] ERROR: %s\n' "$*" >&2
  exit 1
}

LMDB_DIR="$(node -p "const fs=require('fs'); const p=require('path'); let dir=process.cwd(); while (dir !== p.dirname(dir)) { const candidate=p.join(dir,'node_modules','lmdb'); if (fs.existsSync(candidate)) { console.log(candidate); process.exit(0); } dir=p.dirname(dir); } process.exit(1);")"
NODE_GYP=""
NODE_GYP_ARGS=(rebuild)

log "using LMDB_DIR=${LMDB_DIR}"
if [[ -f "${LMDB_DIR}/package.json" ]]; then
  log "installed lmdb package:"
  node -e "const pkg=require(process.argv[1]); console.log(JSON.stringify({name:pkg.name, version:pkg.version, repository:pkg.repository?.url ?? pkg.repository}, null, 2))" "${LMDB_DIR}/package.json"
fi
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

cd "${LMDB_DIR}"
export LMDB_DATA_V1=true

if [[ "$(uname -s)" == "Darwin" ]]; then
  NODE_GYP_ARGS+=(--use_robust=false)
fi

if [[ -n "${NODE_GYP}" ]]; then
  log "using global node-gyp at ${NODE_GYP}"
else
  log "using npm exec node-gyp"
fi

if [[ -n "${NODE_GYP}" ]]; then
  node "${NODE_GYP}" "${NODE_GYP_ARGS[@]}" || fail "node-gyp rebuild failed. Ensure Python and native build tooling are available."
else
  npm exec --yes node-gyp "${NODE_GYP_ARGS[@]}" || fail "npm exec node-gyp rebuild failed. Ensure Python and native build tooling are available."
fi

log "compat LMDB rebuild completed"
