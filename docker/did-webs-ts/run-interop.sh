#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/root}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/root/.cache}"
export KERIPY_INTEROP_PYTHON="${KERIPY_INTEROP_PYTHON:-$(uv python find 3.14)}"
export DID_WEBS_RESOLVER_PYTHON="${DID_WEBS_RESOLVER_PYTHON:-$(uv python find 3.13)}"

if [[ $# -gt 0 ]]; then
  exec "$@"
fi

exec deno task test:quality:keri:interop-did-webs
