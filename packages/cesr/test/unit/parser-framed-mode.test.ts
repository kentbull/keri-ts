import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

Deno.test("V-P0-007: framed=true emits one frame per drain cycle when feed contains two complete frames", () => {
  const parser = createParser({ framed: true });
  const stream =
    `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

  // First drain cycle (single feed) emits only one frame in framed mode.
  const first = parser.feed(encode(stream));
  assertEquals(first.length, 1);
  assertEquals(first[0].type, "frame");
  if (first[0].type === "frame") {
    assertEquals(first[0].frame.body.kind, "CESR");
    assertEquals(first[0].frame.body.ilk, "icp");
  }

  // Next drain cycle emits the buffered second frame.
  const second = parser.feed(new Uint8Array(0));
  assertEquals(second.length, 1);
  assertEquals(second[0].type, "frame");
  if (second[0].type === "frame") {
    assertEquals(second[0].frame.body.kind, "CESR");
    assertEquals(second[0].frame.body.ilk, "icp");
  }

  // No residual pending/queued state remains.
  const tail = parser.flush();
  assertEquals(tail.length, 0);
});

