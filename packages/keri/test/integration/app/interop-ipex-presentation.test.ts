/** Direct presentation proofs use the pinned upstream main witness implementation. */
import { presentationCutoff } from "./ipex-presentation-workflow.ts";

for (const count of [1, 2]) {
  Deno.test(
    `IPEX presentation cutoff: ${count}-signer TS holder, independent stores, three KERIpy witnesses`,
    () => presentationCutoff(count),
  );
}
