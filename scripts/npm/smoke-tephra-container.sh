#!/usr/bin/env sh
set -eu

npm install -g "$@" >/dev/null
echo "Node runtime: $(node --version), npm: $(npm --version)" >&2

tephra --help | grep -q "Usage: tephra <command>"
tephra validate --in "/samples/${SAMPLE_STREAM_REL}"
tephra annotate --in "/samples/${SAMPLE_STREAM_REL}" | awk "NR==1{print; exit}" | grep -q "SERDER KERI"

echo "Smoke test passed for cesr-ts on ${SMOKE_NODE_IMAGE:-node}"
