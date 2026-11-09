import { run } from "npm:effection@^3.6.0";
import { createLMDBer } from "../../../src/db/core/lmdber.ts";
import { MemStore } from "../../../src/db/core/memstore.ts";
import { storeContract, wrapperContract } from "./store-contract.ts";

/** Every `DBer` backend runs the same contract. */
const backends = [
  {
    backend: { name: "LMDBer" },
    open: () => run(() => createLMDBer({ name: `contract-${crypto.randomUUID()}`, temp: true })),
  },
  {
    backend: { name: "MemStore" },
    open: async () => {
      const store = new MemStore({ temp: true });
      await run(() => store.reopen());
      return store;
    },
  },
];

for (const { backend, open } of backends) {
  storeContract(open, backend);
  wrapperContract(open, backend);
}
