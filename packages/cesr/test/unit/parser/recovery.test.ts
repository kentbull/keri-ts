import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../../src/parser/stream.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

Deno.test("parser resets automatically after an error, then parses subsequent clean frame", () => {
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

Deno.test(
  "repeated flush after error + reset + clean feed is idempotent in multi-frame stream",
  () => {
    const parser = createParser();
    // Malformed declared-count stream forces parser error/reset path.
    const malformed = `-HAB${`A${"A".repeat(87)}`}`;

    const first = parser.feed(encode(malformed));
    assertEquals(first.length, 1);
    assertEquals(first[0].type, "error");

    const flushAfterErrorA = parser.flush();
    const flushAfterErrorB = parser.flush();
    assertEquals(flushAfterErrorA.length, 0);
    assertEquals(flushAfterErrorB.length, 0);

    parser.reset();

    // After reset, lifecycle must return to normal deterministic extraction.
    const cleanStream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const fed = parser.feed(encode(cleanStream));
    const flushed = parser.flush();
    const flushedAgain = parser.flush();

    const frames = [...fed, ...flushed].filter((event) => event.type === "frame");
    const errors = [...fed, ...flushed].filter((event) => event.type === "error");
    assertEquals(errors.length, 0);
    assertEquals(frames.length, 2);
    assertEquals(flushedAgain.length, 0);
  },
);
