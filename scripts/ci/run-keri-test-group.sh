#!/usr/bin/env bash
# Runs logical keri-ts test groups with the right balance of concurrency and
# isolation for each category.
#
# Design rules:
# - DB-core tests are safe to run with `deno test --parallel` because they use
#   temp databases and avoid process-global mutation.
# - CLI/app tests that override `console`, mutate `HOME`, or depend on persisted
#   local state are run one file at a time to avoid flakiness from shared
#   process globals.
# - Interop tests get dedicated groups because they are the slowest tests and
#   they depend on pinned KERIpy + LMDB v1 compatibility in CI.
#
# `DENO_JOBS` may be set externally to tune module-worker parallelism for the
# safe groups. When unset, Deno uses its default CPU-based worker count.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/packages/keri"
GROUP="${1:-}"

if [[ -z "${GROUP}" ]]; then
  echo "Usage: $0 <group>" >&2
  exit 1
fi

cd "${PACKAGE_DIR}"

ensure_lmdb_setup() {
  if [[ -n "${KERI_LMDB_SETUP_DONE:-}" ]]; then
    return
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "==> Rebuilding patched LMDB-js for Deno on macOS"
    deno task setup
  fi

  export KERI_LMDB_SETUP_DONE=1
}

ensure_lmdb_setup

COMMON_ARGS=(deno test --allow-all --unstable-ffi)
DB_FAST_ARGS=(deno test --allow-all)

run_parallel_group() {
  echo "==> Running parallel-safe group: $*"
  "${COMMON_ARGS[@]}" --parallel "$@"
}

run_db_fast_parallel_group() {
  echo "==> Running db-fast parallel-safe group: $*"
  "${DB_FAST_ARGS[@]}" --parallel "$@"
}

run_isolated_files() {
  local file
  for file in "$@"; do
    echo "==> Running isolated file: ${file}"
    "${COMMON_ARGS[@]}" "${file}"
  done
}

run_quality_groups() {
  "$0" db-fast
  "$0" app-light
  "$0" app-stateful-a
  "$0" app-stateful-b
  "$0" interop-parity
  "$0" interop-gates-b
  "$0" interop-gates-c
}

run_db_fast_groups() {
  echo "==> Running db-fast core group"
  run_db_fast_parallel_group \
    test/unit/db/core/path-manager.test.ts \
    test/unit/db/core/keys.test.ts \
    test/unit/db/core/lmdber-core-parity.test.ts \
    test/unit/db/core/lmdber-dup.test.ts \
    test/unit/db/core/lmdber-helpers.test.ts \
    test/unit/db/core/lmdber-ioset.test.ts \
    test/unit/db/core/lmdber-lifecycle.test.ts \
    test/unit/db/core/lmdber-on.test.ts \
    test/unit/db/core/lmdber-plain.test.ts

  echo "==> Running db-fast wrapper group"
  run_db_fast_parallel_group \
    test/unit/db/basing.test.ts \
    test/unit/db/escrowing.test.ts \
    test/unit/db/keeping.test.ts \
    test/unit/db/koming.test.ts \
    test/unit/db/subing.test.ts
}

case "${GROUP}" in
  db-fast)
    run_db_fast_groups
    ;;
  app-light)
    run_isolated_files \
      test/integration/app/main.test.ts \
      test/integration/app/effection.test.ts \
      test/integration/app/db-dump.test.ts \
      test/unit/app/annotate.test.ts \
      test/unit/app/benchmark.test.ts \
      test/unit/app/version.test.ts \
      test/unit/app/configing.test.ts
    ;;
  app-stateful-a)
    run_isolated_files \
      test/unit/app/cli.test.ts \
      test/unit/app/incept.test.ts \
      test/unit/app/habbing.test.ts
    ;;
  app-stateful-b)
    run_isolated_files \
      test/unit/app/list-aid.test.ts \
      test/unit/app/export.test.ts \
      test/unit/app/compat-list-aid.test.ts
    ;;
  interop-parity)
    run_isolated_files test/integration/app/interop-kli-tufa.test.ts
    ;;
  interop-gates-b)
    echo "==> Running interop gate scenarios for Gate B"
    "${COMMON_ARGS[@]}" \
      --filter 'Interop gate harness ready scenario: B-' \
      test/integration/app/interop-gates-harness.test.ts
    ;;
  interop-gates-c)
    echo "==> Running interop gate scenarios for Gate C and matrix coverage"
    "${COMMON_ARGS[@]}" \
      --filter 'Interop gate harness matrix covers Gate A-G' \
      test/integration/app/interop-gates-harness.test.ts
    "${COMMON_ARGS[@]}" \
      --filter 'Interop gate harness ready scenario: C-KLI-COMPAT-STORE-OPEN' \
      test/integration/app/interop-gates-harness.test.ts
    ;;
  server)
    run_isolated_files test/integration/app/server.test.ts
    ;;
  quality)
    run_quality_groups
    ;;
  full)
    run_quality_groups
    "$0" server
    ;;
  *)
    echo "Unknown keri test group: ${GROUP}" >&2
    exit 1
    ;;
esac
