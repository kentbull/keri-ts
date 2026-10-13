import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Diger, parseDiger } from "../../../src/primitives/diger.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("diger: parses KERIpy digest vector", () => {
  const diger = parseDiger(txt(KERIPY_MATTER_VECTORS.digerBlake3), "txt");
  assertEquals(diger.qb64, KERIPY_MATTER_VECTORS.digerBlake3);
  assertEquals(diger.digest.length > 0, true);
  assertEquals(diger.algorithm.includes("Blake"), true);
});

Deno.test("diger: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.digerBlake3,
    parseDiger,
  );
  assertEquals(txtValue.algorithm, bnyValue.algorithm);
});

Deno.test("diger: rejects non-digest code families", () => {
  assertThrows(
    () => parseDiger(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});

Deno.test("diger: every digest family verifies ordered sync and async fragments", async () => {
  const data = Uint8Array.from({ length: 10003 }, (_, i) => i % 251);
  const fragments = [data.slice(0, 1), new Uint8Array(), data.slice(1, 4099), data.slice(4099)];
  for (const code of Diger.Digests.keys()) {
    // One-shot bytes exercise the same algorithm with a different update schedule.
    const expected = new Diger({ raw: Diger.digest(data, code), code });
    assertEquals(expected.verifyChunks(fragments), true);
    assertEquals(await expected.verifyStream(chunks(fragments)), true);
    assertEquals(expected.verifyChunks([...fragments].reverse()), false);
    assertEquals(await expected.verifyStream(chunks(fragments.slice(0, -1))), false);
  }
});

/** Supply fragment boundaries, including empty chunks, without collecting during verification. */
async function* chunks(parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* parts;
}

Deno.test("diger: asynchronous source failure cannot become successful verification", async () => {
  const expected = new Diger({ raw: Diger.digest(new Uint8Array(), "E"), code: "E" });
  async function* failing(): AsyncGenerator<Uint8Array> {
    yield new Uint8Array();
    throw new Error("source failed");
  }
  // Digest state must finalize only after clean EOF, even for an empty expected payload.
  await assertRejects(() => expected.verifyStream(failing()), Error, "source failed");
});
