/**
 * Lane 15c, "group wallet": the browser wallet as one member of a 2-of-3 group with two Tufa CLI members, a group
 * issuance with a tab reload in the middle, and a browser-proposed group rotation. Written, not yet run.
 *
 * Usage: `deno task test:browser:wallet:group [chromium|firefox|webkit ...]` (default chromium). Local only.
 */

import { steps } from "../test/browser-wallet/group-scenario.ts";
import { runLane } from "./browser_wallet_lane.ts";

await runLane({ entry: "test/browser-wallet/group-main.ts", steps, defaultEngines: ["chromium"] });
