/**
 * Lane 15d, "KERIpy member added by rotation". The Tufa and browser half is written; the KERIpy half is a scaffold
 * whose steps fail with a list of what is missing (see `keripy-member-scenario.ts`). Not yet run.
 *
 * Usage: `deno task test:browser:wallet:keripy-member [chromium|firefox|webkit ...]` (default chromium). Local only.
 */

import { steps } from "../test/browser-wallet/keripy-member-scenario.ts";
import { runLane } from "./browser_wallet_lane.ts";

await runLane({ entry: "test/browser-wallet/group-main.ts", steps, defaultEngines: ["chromium"] });
