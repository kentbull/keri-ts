import { b, concatBytes } from "../../src/core/bytes.ts";
import { Counter } from "../../src/primitives/counter.ts";
import { Dater } from "../../src/primitives/dater.ts";
import { Matter } from "../../src/primitives/matter.ts";
import { Noncer } from "../../src/primitives/noncer.ts";
import { NumberPrimitive } from "../../src/primitives/number.ts";
import { FirstSeen, SealKind } from "../../src/primitives/structing.ts";
import { Verser } from "../../src/primitives/verser.ts";
import { Vrsn_1_0, Vrsn_2_0 } from "../../src/tables/versions.ts";
import { hexWire, wireHex } from "./current-reference-vectors.ts";
import vectors from "./current-structing-vectors.json" with { type: "json" };

/** Encode TS-created material without deriving qb2 from Python's expected qb64. */
function encoded(value: { qb64: string; qb2: Uint8Array }) {
  return { qb64: value.qb64, qb2: wireHex(value.qb2) };
}

/** Build an explicitly sized ordinal from its semantic value, preserving fixed-width inputs. */
function numberFromInput(code: string, numh: string): NumberPrimitive {
  // M, 0H and 0A carry 2, 4 and 16 bytes; each byte needs two hex digits.
  const size = code === "M" ? 2 : code === "0H" ? 4 : 16;
  return new NumberPrimitive({ code, raw: hexWire(numh.padStart(size * 2, "0")) });
}

/** Independently emit tuples, group counts, and wrong-role material for Python to consume. */
export function currentStructingVectors() {
  const verser = new Verser({ code: "0O", soft: "KERICAACAA", raw: new Uint8Array() });
  const records = vectors.records.map((row) => {
    if (row.clan === "SealKind") {
      const nonce = new Noncer({ code: row.inputs.code, raw: hexWire(row.inputs.raw!) });
      const value = SealKind.fromTuple([verser, nonce]);
      return {
        clan: row.clan,
        inputs: row.inputs,
        sad: SealKind.toSad(value),
        parts: [encoded(verser), encoded(nonce)],
        qb64: SealKind.qb64(value),
        qb2: wireHex(SealKind.qb2(value)),
      };
    }
    const number = numberFromInput(row.inputs.code, row.inputs.numh!);
    const dater = new Dater({ dts: row.inputs.dts! });
    const value = FirstSeen.fromTuple([number, dater]);
    return {
      clan: row.clan,
      inputs: row.inputs,
      sad: FirstSeen.toSad(value),
      parts: [encoded(number), encoded(dater)],
      qb64: FirstSeen.qb64(value),
      qb2: wireHex(FirstSeen.qb2(value)),
    };
  });
  const groups = vectors.groups.map(({ clan, version, code }) => {
    const rows = records.filter((row) => row.clan === clan);
    const payload = rows.map((row) => row.qb64).join("");
    // V1 counts tuples; v2 counts payload quadlets, excluding the group header.
    const count = version === 1 ? rows.length : payload.length / 4;
    const counter = new Counter({ code, count, version: version === 1 ? Vrsn_1_0 : Vrsn_2_0 });
    return {
      clan,
      version,
      code,
      count,
      qb64: counter.qb64 + payload,
      qb2: wireHex(concatBytes(counter.qb2, ...rows.map((row) => hexWire(row.qb2)))),
    };
  });
  const wrong = new Matter({ code: "D", raw: new Uint8Array(32) });
  const empty = new Noncer({ code: "1AAP", raw: new Uint8Array() });
  const dater = new Dater({ dts: "2026-10-13T01:02:03.000004+00:00" });
  const number = numberFromInput("M", "0");
  const rejections = [
    { clan: "SealKind", parts: [encoded(verser), encoded(wrong)] },
    { clan: "SealKind", parts: [encoded(wrong), encoded(empty)] },
    { clan: "FirstSeen", parts: [encoded(wrong), encoded(dater)] },
    { clan: "FirstSeen", parts: [encoded(number), encoded(wrong)] },
  ];
  return { reference: vectors.reference, records, groups, rejections };
}

if (import.meta.main) {
  await Deno.stdout.write(b(JSON.stringify(currentStructingVectors(), null, 2) + "\n"));
}
