#!/usr/bin/env sh
set -eu

npm install -g "$@" >/dev/null
echo "Node runtime: $(node --version), npm: $(npm --version)" >&2

cesr --help | grep -q "Usage: cesr <command>"
cesr validate --in "/samples/${SAMPLE_STREAM_REL}"
cesr annotate --in "/samples/${SAMPLE_STREAM_REL}" | awk "NR==1{print; exit}" | grep -q "SERDER KERI"

echo "Smoke test passed for cesr-ts on ${SMOKE_NODE_IMAGE:-node}"
