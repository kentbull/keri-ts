import { b, concatBytes } from "../../src/core/bytes.ts";
import { Counter } from "../../src/primitives/base/counter.ts";
import { Matter } from "../../src/primitives/base/matter.ts";
import { Noncer } from "../../src/primitives/crypto/noncer.ts";
import { SealNonce } from "../../src/primitives/structuring/structing.ts";
import { Vrsn_2_0 } from "../../src/tables/versions.ts";

/** Hex output makes binary expectations independent of TS base64 decoding. */
export function wireHex(raw: Uint8Array): string {
  return Array.from(raw, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Decode fixture bytes literally without deriving qb2 from the expected qb64. */
export function hexWire(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

/** Emit changed wire families from TS constructors for independent Python consumption. */
export function currentReferenceVectors() {
  const gram = new Matter({ code: "b", soft: "ABC", raw: Uint8Array.of(1, 2, 3) });
  const nonces = [
    new Noncer({ code: "1AAP", raw: new Uint8Array() }),
    new Noncer({ code: "0A", raw: Uint8Array.from({ length: 16 }, (_, i) => i) }),
    new Noncer({ code: "a", raw: Uint8Array.from({ length: 32 }, (_, i) => i) }),
    new Noncer({ code: "E", raw: Uint8Array.from({ length: 32 }, (_, i) => i) }),
  ];
  const seals = nonces.map((nonce) => SealNonce.fromTuple([nonce]));
  const payload = seals.map((seal) => SealNonce.qb64(seal)).join("");
  const groups = ["-N", "--N"].map((code) => {
    const counter = new Counter({ code, count: payload.length / 4, version: Vrsn_2_0 });
    return {
      code,
      count: counter.count,
      qb64: counter.qb64 + payload,
      qb2: wireHex(concatBytes(counter.qb2, ...seals.map((seal) => SealNonce.qb2(seal)))),
    };
  });
  const counters = ["-N", "--N", "-G", "--G", "-J", "--J"].flatMap((code) =>
    [0, 1, 4095, 4096].map((count) => {
      const counter = new Counter({ code, count, version: Vrsn_2_0 });
      return {
        requestedCode: code,
        code: counter.code,
        count,
        name: counter.name,
        fullSize: counter.fullSize,
        qb64: counter.qb64,
        qb2: wireHex(counter.qb2),
      };
    })
  );
  return {
    gramHead: {
      code: gram.code,
      soft: gram.soft,
      raw: wireHex(gram.raw),
      fullSize: gram.fullSize,
      fullSizeB2: gram.fullSizeB2,
      qb64: gram.qb64,
      qb2: wireHex(gram.qb2),
    },
    nonces: nonces.map((nonce, index) => ({
      code: nonce.code,
      raw: wireHex(nonce.raw),
      sad: SealNonce.toSad(seals[index]),
      qb64: nonce.qb64,
      qb2: wireHex(nonce.qb2),
    })),
    groups,
    counters,
  };
}

if (import.meta.main) {
  await Deno.stdout.write(b(JSON.stringify(currentReferenceVectors(), null, 2) + "\n"));
}
