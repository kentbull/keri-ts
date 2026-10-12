import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

Deno.test("V-P1-011: parser resets automatically after an error, then parses subsequent clean frame", () => {
  const parser = createParser();
  // Declares one quadlet body but provides a longer token, forcing a parser error.
  const malformed = `-HAB${`A${"A".repeat(87)}`}`;
  const first = parser.feed(encode(malformed));
  assertEquals(first.length, 1);
  assertEquals(first[0].type, "error");

  const next = [
    ...parser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY)),
    ...parser.flush(),
  ];
  const errors = next.filter((event) => event.type === "error");
  const frames = next.filter((event) => event.type === "frame");

  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
  if (frames[0].type === "frame") {
    assertEquals(frames[0].frame.body.kind, "CESR");
    assertEquals(frames[0].frame.body.ilk, "icp");
  }
});
