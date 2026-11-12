#!/usr/bin/env bash
# Run the browser wallet scenario in Firefox inside a Linux container (Firefox does not launch on the
# macOS host). The container joins the network namespace of the lane's servers, so the
# 127.0.0.1 addresses they advertise in their location replies work from the Firefox page too.
#
#   bash scripts/ci/browser-wallet-firefox.sh        starts the servers, runs, removes the servers
#
# Chromium and WebKit run on the host: `deno task test:browser:wallet chromium webkit`.
set -euo pipefail

cd "$(dirname "$0")/../.."
VOLUME=${KERI_WALLET_VOLUME:-keri-ts-browser-pr15b}
TS_IMAGE=${KERI_WALLET_TUFA_IMAGE:-local/keri-ts-test:latest}

servers=$(bash scripts/ci/browser-wallet-servers.sh up)
trap 'bash scripts/ci/browser-wallet-servers.sh down' EXIT

# The servers script already copied the tree into the volume; refresh it so uncommitted edits run.
git ls-files -co --exclude-standard | tar -cf - -T - | docker run --rm -i -v "$VOLUME":/work "$TS_IMAGE" \
  bash -c 'tar xf - -C /work/repo'
docker run --rm --network container:keri-wallet-net -v "$VOLUME":/work \
  -e DENO_DIR=/work/deno-cache -e KERI_WALLET_SERVERS="$servers" -w /work/repo "$TS_IMAGE" bash -c \
  'npx --yes playwright-core@1.56.1 install-deps firefox && npx --yes playwright-core@1.56.1 install firefox \
   && cd packages/keri && deno run -A scripts/run_browser_wallet.ts firefox'
