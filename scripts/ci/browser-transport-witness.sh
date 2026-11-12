#!/usr/bin/env bash
# Run inside the Python container: create a KERIpy witness store with KERIpy's own `kli init` and
# `kli incept`, then serve it. Needs COMMIT (the keripy-reference.json commit), HTTP_PORT and TCP_PORT.
# KERIpy's source is at /k/$COMMIT and its virtualenv at /v/$COMMIT; state goes under /work/witness.
set -euo pipefail

source=/k/$COMMIT
python=/v/$COMMIT/bin/python
fixture=/work/repo/scripts/ci/keripy-witness-v1.py
root=/work/witness
export PYTHONPATH=$source/src

rm -rf "$root"
mkdir -p "$root/home"
python3 /work/repo/scripts/ci/browser-transport-witness-config.py \
  "$source/scripts/keri/cf/main/wan.json" "$root/cf" "$TCP_PORT" "$HTTP_PORT"

common=(--name wan --base b --passcode WitnessFixturePasscode)
"$python" "$fixture" --test-root "$root/home" --cli-module keri.cli.kli init "${common[@]}" \
  --config-dir "$root/cf" --config-file wan
"$python" "$fixture" --test-root "$root/home" --cli-module keri.cli.kli incept "${common[@]}" \
  --alias wan --config "$root/cf" --file "$source/scripts/demo/data/wil-witness-sample.json"
# WITNESS_PROTOCOL_VERSION=2 serves the witness at KERI v2 (the fixture defaults to v1).
exec "$python" "$fixture" --test-root "$root/home" "${common[@]}" --alias wan \
  --config-dir "$root/cf" --config-file wan --http "$HTTP_PORT" --tcp "$TCP_PORT" \
  ${WITNESS_PROTOCOL_VERSION:+--protocol-version "$WITNESS_PROTOCOL_VERSION"}
