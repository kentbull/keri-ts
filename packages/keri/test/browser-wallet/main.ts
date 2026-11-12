/** Browser entry: expose `keriWallet.step(name, args)`; the Deno runner calls it once per scenario step. */

import { crashCause, type StepArgs, steps } from "./steps.ts";

(globalThis as unknown as { keriWallet: { step(name: string, args: StepArgs): Promise<unknown> } }).keriWallet = {
  async step(name, args) {
    const step = steps[name];
    if (!step) throw new Error(`Unknown wallet step ${name}`);
    try {
      return await step(args);
    } catch (error) {
      // A failed step may be a crashed runtime, which closes the wallet's stores and says nothing.
      const cause = await crashCause();
      if (!cause) throw error;
      throw new Error(`${error instanceof Error ? error.message : error}${cause}`, { cause: error });
    }
  },
};
