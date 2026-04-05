#!/usr/bin/env bash
set -euo pipefail

LMDB_DIR="$(node -p "const p=require('path'); p.dirname(p.dirname(require.resolve('lmdb')))")"
NODE_GYP=""

if npm_root="$(npm root -g 2>/dev/null)"; then
  candidate="${npm_root}/npm/node_modules/node-gyp/bin/node-gyp.js"
  if [[ -f "${candidate}" ]]; then
    NODE_GYP="${candidate}"
  fi
fi

cd "${LMDB_DIR}"
export LMDB_DATA_V1=true

if [[ -n "${NODE_GYP}" ]]; then
  node "${NODE_GYP}" rebuild
else
  npm exec --yes node-gyp rebuild
fi
