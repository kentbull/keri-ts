#!/usr/bin/env bash
# Start ("up") or remove ("down") the two servers of the browser transport probe in Docker.
#
#   KERIpy witness  the keripy-reference.json profile ($KERI_TRANSPORT_KERIPY_PROFILE, default
#                   main), run through scripts/ci/keripy-witness-v1.py from the interop harness'
#                   cached source and virtualenv volumes (keri-interop-keripy, keri-interop-venvs).
#   Tufa mailbox    `tufa mailbox start` from this working tree, copied into a named volume.
#
# Ports are published on 127.0.0.1 only and all state lives in named volumes: nothing is
# bind-mounted from the host and no LMDB store is opened outside Docker. "up" prints one line of
# endpoint JSON on stdout (everything else goes to stderr), the shape run_browser_transport.ts reads.
set -euo pipefail

cd "$(dirname "$0")/../.."
VOLUME=${KERI_TRANSPORT_VOLUME:-keri-ts-browser-transport}
PY_IMAGE=${KERI_TRANSPORT_PYTHON_IMAGE:-keri-interop-runner-314:latest}
TS_IMAGE=${KERI_TRANSPORT_TUFA_IMAGE:-local/keri-ts-test:latest}
WITNESS_HTTP=55631
WITNESS_TCP=55632
MAILBOX_HTTP=55701

# Wait for a container's log to print "<label>  <value>" and echo the value.
logged() {
  for _ in $(seq 120); do
    value=$(docker logs "$1" 2>&1 | sed -n "s/^$2  //p" | head -1)
    if [ -n "$value" ]; then echo "$value"; return; fi
    sleep 1
  done
  echo "timed out waiting for '$2' in $1 logs" >&2
  return 1
}

# Wait until a URL answers any HTTP status.
ready() {
  for _ in $(seq 120); do
    if curl -s -o /dev/null --max-time 2 "$1"; then return; fi
    sleep 1
  done
  echo "timed out waiting for $1" >&2
  return 1
}

up() {
  down
  docker volume create "$VOLUME" > /dev/null
  profile=${KERI_TRANSPORT_KERIPY_PROFILE:-main}
  commit=$(node -p "require('./scripts/ci/keripy-reference.json').profiles['$profile'].commit")

  echo "copying the working tree into volume $VOLUME" >&2
  git ls-files -co --exclude-standard | tar -cf - -T - | docker run --rm -i -v "$VOLUME":/work \
    -e DENO_DIR=/work/deno-cache "$TS_IMAGE" bash -c '
      mkdir -p /work/repo && tar xf - -C /work/repo && cd /work/repo
      [ -d node_modules/lmdb ] || { deno install || true; deno task setup:compat-lmdb; } >&2' >&2

  docker run -d --name keri-transport-witness --init -p 127.0.0.1:$WITNESS_HTTP:$WITNESS_HTTP \
    -v "$VOLUME":/work -v keri-interop-keripy:/k:ro -v keri-interop-venvs:/v:ro \
    -e COMMIT="$commit" -e HTTP_PORT=$WITNESS_HTTP -e TCP_PORT=$WITNESS_TCP \
    "$PY_IMAGE" bash /work/repo/scripts/ci/browser-transport-witness.sh > /dev/null
  docker run -d --name keri-transport-mailbox --init -p 127.0.0.1:$MAILBOX_HTTP:$MAILBOX_HTTP \
    -v "$VOLUME":/work -e DENO_DIR=/work/deno-cache -w /work/repo "$TS_IMAGE" bash -c "
      rm -rf /work/mailbox
      exec deno run -A --unstable-ffi packages/tufa/mod.ts mailbox start --name mailbox --alias mailbox \
        --url http://127.0.0.1:$MAILBOX_HTTP --datetime 2026-01-01T00:00:00.000000+00:00 \
        --port $MAILBOX_HTTP --listen-host 0.0.0.0 --head-dir /work/mailbox --passcode abcdefghijklmnopqrstu" > /dev/null

  witness=$(logged keri-transport-witness Prefix)
  mailbox=$(logged keri-transport-mailbox "Mailbox Prefix")
  ready "http://127.0.0.1:$WITNESS_HTTP/oobi/$witness/controller"
  ready "http://127.0.0.1:$MAILBOX_HTTP/oobi/$mailbox/mailbox/$mailbox"
  echo "{\"keripy\":{\"origin\":\"http://127.0.0.1:$WITNESS_HTTP\",\"pre\":\"$witness\"},\"tufa\":{\"origin\":\"http://127.0.0.1:$MAILBOX_HTTP\",\"pre\":\"$mailbox\"}}"
}

down() {
  docker rm -f keri-transport-witness keri-transport-mailbox > /dev/null 2>&1 || true
}

"${1:?usage: browser-transport-servers.sh up|down}"
