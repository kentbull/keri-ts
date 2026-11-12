/**
 * The cases the browser lane runs. Deno and the browser both register through here, so the
 * runner can require the browser to execute exactly the cases Deno collects.
 */

import { b } from "cesr-ts";
import { assertEquals } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { indexedDbOpener } from "../../db-indexeddb.ts";
import { MemStore } from "../../src/db/core/memstore.ts";
import type { WebDBer } from "../../src/db/core/webdber.ts";
import { storeContract, wrapperContract } from "../unit/db/store-contract.ts";
import { registerEngineCases } from "./engine-cases.ts";
import { registerHaltCases } from "./halt-cases.ts";
import { registerWalletCases } from "./wallet-cases.ts";

/** A fresh `WebDBer` on real IndexedDB under a unique database name; `close(true)` deletes it. */
async function openWeb(name = `contract-${crypto.randomUUID()}`): Promise<WebDBer> {
  const store = indexedDbOpener().create({ tail: "db" }, { name });
  await run(() => store.reopen());
  return store;
}

/** Every byte value, so the round trip cannot hide a text or sign-extension fault. */
const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, i) => i);

/** Write, flush, close, reopen through a fresh opener, and read back byte-identical rows. */
async function reopenFidelity(): Promise<void> {
  const name = `reopen-${crypto.randomUUID()}`;
  const first = await openWeb(name);
  try {
    const plain = first.openTable("plain.");
    const dups = first.openTable("dups.", { dupsort: true });
    first.setVal(plain, ALL_BYTES, ALL_BYTES.toReversed());
    first.setVal(plain, b("empty"), new Uint8Array(0));
    first.addVal(dups, b("k"), ALL_BYTES);
    first.addVal(dups, b("k"), b("second"));
    await run(() => first.flushed());
    await run(() => first.close());

    const second = await openWeb(name);
    try {
      assertEquals(second.getVal(second.openTable("plain."), ALL_BYTES), ALL_BYTES.toReversed());
      assertEquals(second.getVal(second.openTable("plain."), b("empty")), new Uint8Array(0));
      assertEquals(second.getVals(second.openTable("dups.", { dupsort: true }), b("k")), [ALL_BYTES, b("second")]);
    } finally {
      await run(() => second.close(true));
    }
  } finally {
    await run(() => first.close(true));
  }
}

/** Register the contract for `WebDBer` over IndexedDB and for `MemStore`, plus reopen fidelity. */
export function registerCases(): void {
  const backends = [
    { backend: { name: "WebDBer/IndexedDB" }, open: openWeb },
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
    storeContract(() => open(), backend);
    wrapperContract(() => open(), backend);
  }
  registerEngineCases();
  registerHaltCases();
  registerWalletCases();
  Deno.test("indexeddb reopen fidelity: flushed rows are byte-identical through a fresh opener", reopenFidelity);
}
