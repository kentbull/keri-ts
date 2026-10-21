import { b, codeB64ToB2, t } from "../../src/core/bytes.ts";
import { Tholder } from "../../src/primitives/crypto/tholder.ts";
import { NumberPrimitive } from "../../src/primitives/values/number.ts";
import { SerderKERI } from "../../src/serder/serder.ts";
import vectors from "./native-seal-vectors.json" with { type: "json" };

/** Decode literal Python qb2 hex without going through the TS CESR converter. */
export function nativeSealBinary(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** Emit independently constructed TS bodies for the frozen Python reverse probe. */
export function emitNativeSealVectors() {
  const events = vectors.events.map((row) => {
    const event = new SerderKERI({ sad: row.sad, makify: true });
    return {
      name: row.name,
      sad: event.ked,
      qb64: t(event.raw),
      qb2: Array.from(codeB64ToB2(t(event.raw)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    };
  });
  const jsonEvents = vectors.jsonEvents.map((row) => {
    const event = new SerderKERI({ sad: row.sad, makify: true });
    return { name: row.name, sad: event.ked, raw: t(event.raw) };
  });
  const numbers = vectors.numbers.map(({ numh }) => {
    const value = BigInt(`0x${numh}`);
    const number = NumberPrimitive.fromNum(value);
    return {
      numh,
      qb64: number.qb64,
      qb2: Array.from(number.qb2, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      limen: new Tholder(value).limen,
    };
  });
  return { reference: vectors.reference, events, jsonEvents, numbers };
}

if (import.meta.main) {
  await Deno.stdout.write(b(JSON.stringify(emitNativeSealVectors(), null, 2) + "\n"));
}
