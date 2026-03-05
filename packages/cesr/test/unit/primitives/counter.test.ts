import { assertEquals, assertThrows } from "jsr:@std/assert";
import { decodeB64 } from "../../../src/core/bytes.ts";
import {
  DeserializeError,
  ShortageError,
  UnknownCodeError,
} from "../../../src/core/errors.ts";
import {
  Counter,
  parseCounter,
  parseCounterFromBinary,
  parseCounterFromText,
} from "../../../src/primitives/counter.ts";
import type { Versionage } from "../../../src/tables/table-types.ts";
import {
  KERIPY_COUNTER_VECTORS,
  KERIPY_MAIN_BASELINE,
} from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V1 = { major: 1, minor: 0 } as const;
const V2 = { major: 2, minor: 0 } as const;

Deno.test("counter: baseline uses KERIpy main vectors", () => {
  assertEquals(KERIPY_MAIN_BASELINE.commit, "5a5597e8b7f7");
});

Deno.test("counter: parses canonical v1/v2 KERIpy vectors", () => {
  const vectors: Array<{ qb64: string; version: Versionage }> = [
    { qb64: KERIPY_COUNTER_VECTORS.v1ControllerIdxSigsCount1, version: V1 },
    { qb64: KERIPY_COUNTER_VECTORS.v1ControllerIdxSigsCount5, version: V1 },
    { qb64: KERIPY_COUNTER_VECTORS.v1BigAttachmentGroupCount100024000, version: V1 },
    { qb64: KERIPY_COUNTER_VECTORS.v1BigPathedMaterialCouplesCount100024000, version: V1 },
    { qb64: KERIPY_COUNTER_VECTORS.v1BigAttachmentGroupCount1024, version: V1 },
    { qb64: KERIPY_COUNTER_VECTORS.v1GenusVersion000, version: V1 },
    { qb64: KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1, version: V2 },
    { qb64: KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount5, version: V2 },
    { qb64: KERIPY_COUNTER_VECTORS.v2BigGenericGroupCount1024, version: V2 },
    { qb64: KERIPY_COUNTER_VECTORS.v2BigGenericGroupCount8193, version: V2 },
    { qb64: KERIPY_COUNTER_VECTORS.v2GenusVersion000, version: V2 },
  ];

  for (const { qb64, version } of vectors) {
    const txtCounter = parseCounterFromText(txt(qb64), version);
    const bnyCounter = parseCounterFromBinary(decodeB64(qb64), version);
    assertEquals(txtCounter.qb64, qb64);
    assertEquals(bnyCounter.qb64, qb64);
    assertEquals(txtCounter.code, bnyCounter.code);
    assertEquals(txtCounter.count, bnyCounter.count);
  }
});

Deno.test("counter: constructor from code/count roundtrips", () => {
  const c1 = new Counter({ code: "-K", count: 1, version: V2 });
  assertEquals(c1.qb64, KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1);

  const c2 = new Counter({ code: "--A", count: 1024, version: V2 });
  assertEquals(c2.qb64, KERIPY_COUNTER_VECTORS.v2BigGenericGroupCount1024);

  const parsed = parseCounter(c2.qb2, V2, "bny");
  assertEquals(parsed.qb64, c2.qb64);
});

Deno.test("counter: trims trailing input and rejects shortages", () => {
  const qb64 = KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1;
  const parsedTxt = parseCounterFromText(txt(`${qb64}ABCD`), V2);
  assertEquals(parsedTxt.qb64, qb64);

  const qb2 = decodeB64(qb64);
  const longQb2 = new Uint8Array(qb2.length + 5);
  longQb2.set(qb2, 0);
  const parsedBny = parseCounterFromBinary(longQb2, V2);
  assertEquals(parsedBny.qb64, qb64);

  assertThrows(
    () => parseCounterFromText(txt("-"), V2),
    ShortageError,
  );

  assertThrows(
    () => parseCounterFromBinary(new Uint8Array([0xf8]), V2),
    ShortageError,
  );
});

Deno.test("counter: rejects unknown codes and invalid counts", () => {
  assertThrows(
    () => parseCounterFromText(txt("-!AA"), V2),
    UnknownCodeError,
  );

  assertThrows(
    () => new Counter({ code: "-K", count: -1, version: V2 }),
    DeserializeError,
  );

  assertThrows(
    () => new Counter({ code: "-~", count: 1, version: V2 }),
    UnknownCodeError,
  );
});
