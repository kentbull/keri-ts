#!/usr/bin/env bash
set -euo pipefail

LMDB_DIR="$(node -p "const fs=require('fs'); const p=require('path'); let dir=process.cwd(); while (dir !== p.dirname(dir)) { const candidate=p.join(dir,'node_modules','lmdb'); if (fs.existsSync(candidate)) { console.log(candidate); process.exit(0); } dir=p.dirname(dir); } process.exit(1);")"
NODE_GYP=""
NODE_GYP_ARGS=(rebuild)

if npm_root="$(npm root -g 2>/dev/null)"; then
  candidate="${npm_root}/npm/node_modules/node-gyp/bin/node-gyp.js"
  if [[ -f "${candidate}" ]]; then
    NODE_GYP="${candidate}"
  fi
fi

cd "${LMDB_DIR}"
export LMDB_DATA_V1=true

# The workspace pins lmdb-js to one forked commit. Verify the cleanup-hook
# bridge that commit carries before rebuilding in LMDB_DATA_V1 mode.
grep -q 'bool cleanupHookRegistered;' src/lmdb-js.h
grep -q 'static void cleanupEnvWraps(void\* data);' src/lmdb-js.h
grep -q 'void EnvWrap::cleanupEnvWraps(void\* data) {' src/env.cpp
grep -q 'napi_add_env_cleanup_hook(napiEnv, cleanupEnvWraps, openEnvWraps);' src/env.cpp

if [[ "$(uname -s)" == "Darwin" ]]; then
  NODE_GYP_ARGS+=(--use_robust=false)
fi

if [[ -n "${NODE_GYP}" ]]; then
  node "${NODE_GYP}" "${NODE_GYP_ARGS[@]}"
else
  npm exec --yes node-gyp "${NODE_GYP_ARGS[@]}"
fi
