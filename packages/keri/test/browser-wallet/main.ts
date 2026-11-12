/** Browser entry: expose `keriWallet.step(name, args)`; the Deno runner calls it once per scenario step. */

import { type StepArgs, steps } from "./steps.ts";

(globalThis as unknown as { keriWallet: { step(name: string, args: StepArgs): Promise<unknown> } }).keriWallet = {
  async step(name, args) {
    const step = steps[name];
    if (!step) throw new Error(`Unknown wallet step ${name}`);
    return await step(args);
  },
};
