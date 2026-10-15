/** Real V8 collection probe: the shared decoder must release source backing after success and failure. */
import { decodeKeriCbor } from "../../src/core/cbor.ts";

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("CBOR retention probe requires --expose-gc");

/** Only a two-byte view is decoded; the backing makes an accidentally retained DataView observable. */
function decodeSource(malformed: boolean): WeakRef<ArrayBuffer> {
  const backing = new ArrayBuffer(16 * 1024 ** 2);
  const raw = new Uint8Array(backing, 0, 2);
  raw.set(malformed ? [0x82, 1] : [0x61, 0x78]);
  if (malformed) {
    let failed = false;
    try {
      decodeKeriCbor(raw);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error("Expected truncated CBOR array failure");
  } else if (decodeKeriCbor(raw) !== "x") throw new Error("Unexpected CBOR string");
  return new WeakRef(backing);
}

for (const malformed of [false, true]) {
  const backing = decodeSource(malformed);
  // End the WeakRef creation job before explicit collections; do not dereference during collection.
  for (let pass = 0; pass < 5; pass++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
  if (backing.deref()) throw new Error(`CBOR decoder retains ${malformed ? "failed" : "successful"} source backing`);
}
