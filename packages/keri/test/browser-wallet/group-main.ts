/** Browser entry of the group lanes: expose `keriWallet.step(name, args)`; the Deno runner calls it once per step. */

import { crashCause, type GroupStepArgs, steps } from "./group-steps.ts";

(globalThis as unknown as { keriWallet: { step(name: string, args: GroupStepArgs): Promise<unknown> } }).keriWallet = {
  async step(name, args) {
    const step = steps[name];
    if (!step) throw new Error(`Unknown group wallet step ${name}`);
    try {
      return await step(args);
    } catch (error) {
      const cause = await crashCause();
      if (!cause || (error instanceof Error && error.message.includes("wallet health:"))) throw error;
      throw new Error(`${error instanceof Error ? error.message : error}${cause}`, { cause: error });
    }
  },
};
