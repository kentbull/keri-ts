import { assertEquals, assertRejects } from "jsr:@std/assert";
import { ShortageError } from "../../../src/core/errors.ts";
import { parse } from "../../../src/parser/parser.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { assertWireError } from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

/** Yield one complete transport record; source completion is the parser's EOF boundary. */
async function* record(wire: string): AsyncGenerator<Uint8Array> {
  yield encode(wire);
}

Deno.test("EOF emits the open frame once and leaves the iterator finished", async () => {
  const frames = parse(record(KERIPY_NATIVE_V2_ICP_FIX_BODY));
  const first = await frames.next();
  assertEquals(first.done, false);
  assertEquals(first.value!.body.kind, "CESR");
  assertEquals(first.value!.body.ilk, "icp");
  assertEquals((await frames.next()).done, true);
  assertEquals((await frames.next()).done, true);
});

Deno.test("EOF rejects a truncated enclosure once and leaves the iterator finished", async () => {
  // One declared attachment quadlet is absent; only source completion resolves the shortage.
  const frames = parse(record(`${KERIPY_NATIVE_V2_ICP_FIX_BODY}-CAB`));
  await assertWireError(() => frames.next(), ShortageError);
  assertEquals((await frames.next()).done, true);
});

Deno.test("EOF rejects twenty-signature truncation without emitting the pending frame", async () => {
  const count = 20;
  // V2 counts payload quadlets; removing one byte leaves the twentieth signature incomplete.
  const signatures = sigerToken().repeat(count);
  const header = counterV2(CtrDexV2.ControllerIdxSigs, signatures.length / 4);
  const frames = parse(record(`${KERIPY_NATIVE_V2_ICP_FIX_BODY}${header}${signatures.slice(0, -1)}`));
  await assertWireError(() => frames.next(), ShortageError);
  assertEquals((await frames.next()).done, true);
});
