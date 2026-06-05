import { assertEquals } from "jsr:@std/assert";
import { codeB64ToB2 } from "../../../src/core/bytes.ts";
import { UnknownPrimitive } from "../../../src/primitives/unknown.ts";
import {
  KERIPY_COUNTER_VECTORS,
  KERIPY_MAIN_BASELINE,
} from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("unknown primitive: keeps KERIpy-baseline metadata", () => {
  assertEquals(KERIPY_MAIN_BASELINE.commit, "5a5597e8b7f7");
});

Deno.test("unknown primitive: preserves text payload losslessly", () => {
  const payload = txt(KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1);
  const unknown = UnknownPrimitive.fromPayload(payload, "txt");
  assertEquals(unknown.qb64, KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1);
  assertEquals(unknown.sourceDomain, "txt");
  assertEquals(
    unknown.fullSize,
    KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1.length,
  );
});

Deno.test("unknown primitive: preserves binary payload losslessly", () => {
  const qb64 = KERIPY_COUNTER_VECTORS.v2BigGenericGroupCount1024;
  const payload = codeB64ToB2(qb64);
  const unknown = UnknownPrimitive.fromPayload(payload, "bny");
  assertEquals(unknown.qb64, qb64);
  assertEquals([...unknown.qb2], [...payload]);
  assertEquals(unknown.sourceDomain, "bny");
});
