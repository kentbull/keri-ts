#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec deno run -A "${SCRIPT_DIR}/run-keri-test-group.ts" "$@"
