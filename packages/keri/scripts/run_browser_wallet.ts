/**
 * Real-browser wallet scenario: a wallet opened with `openWebWallet` on IndexedDB inside Chromium,
 * WebKit or Firefox, talking to a KERIpy witness, a Tufa mailbox and a Tufa counterparty that run in
 * Docker (`scripts/ci/browser-wallet-servers.sh`). The scenario steps are in
 * `test/browser-wallet/scenario.ts` (Deno side) and `steps.ts` (page side); the machinery is in
 * `browser_wallet_lane.ts`.
 *
 * Usage (from packages/keri, or `deno task test:browser:wallet` anywhere):
 *   deno task test:browser:wallet [chromium|firefox|webkit ...]
 */

import { steps } from "../test/browser-wallet/scenario.ts";
import { engines } from "./browser_lane.ts";
import { runLane } from "./browser_wallet_lane.ts";

await runLane({ entry: "test/browser-wallet/main.ts", steps, defaultEngines: Object.keys(engines) });
