#!/usr/bin/env bash
# Start ("up") or remove ("down") the servers of the browser wallet scenario in Docker:
#
#   KERIpy witness  the same fixture as browser-transport-servers.sh (browser-transport-witness.sh),
#                   served at KERI v2 (KERI_WALLET_WITNESS_VERSION=1 selects v1): a v1 identifier
#                   cannot take part in v2 issuance
#   Tufa mailbox    `tufa mailbox start` from this working tree
#   Tufa peer       a control server (browser-wallet-peer.ts) that runs `tufa` commands for the
#                   counterparty identifier, so the scenario can script the other party over HTTP
#
# All three share one network namespace, owned by an anchor container that publishes the ports on
# 127.0.0.1. Inside that namespace every server is `127.0.0.1:<port>`, which is also the address the
# servers advertise in their location replies; a browser on the host reaches them through the
# published ports, and the Firefox container joins the same namespace (`--network container:`), so
# the advertised URLs work for every engine. State lives in the named volume (default
# keri-ts-browser-pr15b); nothing is bind-mounted and no LMDB store is opened on the host.
# "up" prints one line of endpoint JSON on stdout (everything else goes to stderr).
set -euo pipefail

cd "$(dirname "$0")/../.."
VOLUME=${KERI_WALLET_VOLUME:-keri-ts-browser-pr15b}
PY_IMAGE=${KERI_WALLET_PYTHON_IMAGE:-keri-interop-runner-314:latest}
TS_IMAGE=${KERI_WALLET_TUFA_IMAGE:-local/keri-ts-test:latest}
ANCHOR=keri-wallet-net
WITNESS_HTTP=55831
WITNESS_TCP=55832
MAILBOX_HTTP=55801
PEER_CONTROL=55811

# Wait for a container's log to print "<label>  <value>" and echo the value.
logged() {
  for _ in $(seq 180); do
    value=$(docker logs "$1" 2>&1 | sed -n "s/^$2  //p" | head -1)
    if [ -n "$value" ]; then echo "$value"; return; fi
    sleep 1
  done
  echo "timed out waiting for '$2' in $1 logs" >&2
  return 1
}

# Wait until a URL answers any HTTP status.
ready() {
  for _ in $(seq 180); do
    if curl -s -o /dev/null --max-time 2 "$1"; then return; fi
    sleep 1
  done
  echo "timed out waiting for $1" >&2
  return 1
}

up() {
  down
  docker volume create "$VOLUME" > /dev/null
  profile=${KERI_WALLET_KERIPY_PROFILE:-main}
  commit=$(node -p "require('./scripts/ci/keripy-reference.json').profiles['$profile'].commit")

  echo "copying the working tree into volume $VOLUME" >&2
  git ls-files -co --exclude-standard | tar -cf - -T - | docker run --rm -i -v "$VOLUME":/work \
    -e DENO_DIR=/work/deno-cache "$TS_IMAGE" bash -c '
      mkdir -p /work/repo && tar xf - -C /work/repo && cd /work/repo
      [ -d node_modules/lmdb ] || { deno install || true; deno task setup:compat-lmdb; } >&2' >&2

  docker run -d --name "$ANCHOR" --init \
    -p 127.0.0.1:$WITNESS_HTTP:$WITNESS_HTTP -p 127.0.0.1:$MAILBOX_HTTP:$MAILBOX_HTTP \
    -p 127.0.0.1:$PEER_CONTROL:$PEER_CONTROL "$TS_IMAGE" sleep infinity > /dev/null
  docker run -d --name keri-wallet-witness --init --network container:$ANCHOR \
    -v "$VOLUME":/work -v keri-interop-keripy:/k:ro -v keri-interop-venvs:/v:ro \
    -e COMMIT="$commit" -e HTTP_PORT=$WITNESS_HTTP -e TCP_PORT=$WITNESS_TCP \
    -e WITNESS_PROTOCOL_VERSION="${KERI_WALLET_WITNESS_VERSION:-2}" \
    "$PY_IMAGE" bash /work/repo/scripts/ci/browser-transport-witness.sh > /dev/null
  docker run -d --name keri-wallet-mailbox --init --network container:$ANCHOR \
    -v "$VOLUME":/work -e DENO_DIR=/work/deno-cache -w /work/repo "$TS_IMAGE" bash -c "
      rm -rf /work/mailbox
      exec deno run -A --unstable-ffi packages/tufa/mod.ts mailbox start --name mailbox --alias mailbox \
        --url http://127.0.0.1:$MAILBOX_HTTP --datetime 2026-01-01T00:00:00.000000+00:00 \
        --port $MAILBOX_HTTP --listen-host 0.0.0.0 --head-dir /work/mailbox --passcode abcdefghijklmnopqrstu" > /dev/null
  docker run -d --name keri-wallet-peer --init --network container:$ANCHOR \
    -v "$VOLUME":/work -e DENO_DIR=/work/deno-cache -e PEER_PORT=$PEER_CONTROL -w /work/repo "$TS_IMAGE" bash -c "
      rm -rf /work/peer
      exec deno run -A scripts/ci/browser-wallet-peer.ts" > /dev/null

  witness=$(logged keri-wallet-witness Prefix)
  mailbox=$(logged keri-wallet-mailbox "Mailbox Prefix")
  ready "http://127.0.0.1:$WITNESS_HTTP/oobi/$witness/controller"
  ready "http://127.0.0.1:$MAILBOX_HTTP/oobi/$mailbox/mailbox/$mailbox"
  ready "http://127.0.0.1:$PEER_CONTROL/ready"
  echo "{\"witness\":{\"origin\":\"http://127.0.0.1:$WITNESS_HTTP\",\"pre\":\"$witness\"},\"mailbox\":{\"origin\":\"http://127.0.0.1:$MAILBOX_HTTP\",\"pre\":\"$mailbox\"},\"peer\":{\"origin\":\"http://127.0.0.1:$PEER_CONTROL\"}}"
}

down() {
  docker rm -f keri-wallet-witness keri-wallet-mailbox keri-wallet-peer "$ANCHOR" > /dev/null 2>&1 || true
}

"${1:?usage: browser-wallet-servers.sh up|down}"
