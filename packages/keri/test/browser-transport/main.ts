/** Browser entry: expose `keriTransport.run(config)`; the Deno runner drives it once per engine. */

import { type Config, type ProbeResult, runProbes } from "./probes.ts";

(globalThis as unknown as { keriTransport: { run(config: Config): Promise<ProbeResult[]> } }).keriTransport = {
  run: runProbes,
};
