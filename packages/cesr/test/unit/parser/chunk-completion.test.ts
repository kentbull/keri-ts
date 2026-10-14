import { assertEquals, assertRejects } from "jsr:@std/assert";
import { concatBytes, decodeB64 } from "../../../src/core/bytes.ts";
import { ColdStartError, GroupSizeError, ShortageError } from "../../../src/core/errors.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/progressive.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV1, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY as body } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";
import { v1ify } from "../../fixtures/versioned-body-fixtures.ts";

/** Supply finite chunks, preserving deliberately empty producer reads. */
async function* chunks(...parts: Uint8Array[]) {
  yield* parts;
}

/** Fail if a bounded result asks its producer for bytes outside the declared enclosure. */
async function* bounded(...parts: Uint8Array[]) {
  yield* parts;
  throw new Error("Parser read beyond a complete enclosure");
}

Deno.test("attachment completion is independent of text/binary chunk partitions in both versions", async () => {
  for (const version of [1, 2]) {
    for (const binary of [false, true]) {
      const encodeAttachment = binary ? decodeB64 : encode;
      const bodyBytes = version === 1
        ? encode(v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}"))
        : encodeAttachment(body);
      const first = encodeAttachment(version === 1 ? counterV1("-A", 1) + sigerToken() : groupV2("-K", sigerToken()));
      const second = encodeAttachment(version === 1 ? counterV1("-B", 1) + sigerToken() : groupV2("-L", sigerToken()));
      const wire = concatBytes(bodyBytes, first, second);
      const expected = await parseBytes(wire);
      assertEquals(expected.length, 1);
      assertEquals(expected[0].attachments.length, 2);
      const edge = bodyBytes.length + first.length;
      for (
        const parts of [
          Array.from(wire, (byte) => Uint8Array.of(byte)),
          [wire.slice(0, edge), new Uint8Array(), wire.slice(edge)],
        ]
      ) {
        let delivered = false;
        /** Chunk exhaustion, including empty reads, cannot close an open attachment set. */
        const record = async function*() {
          for (const part of parts) {
            yield part;
            assertEquals(delivered, false);
          }
        };
        const actual = [];
        for await (const frame of parse(record())) {
          delivered = true;
          actual.push(frame);
        }
        assertEquals(actual, expected, `v${version} binary=${binary}`);
      }
      // A following body closes the attachment set without requiring source EOF.
      const parser = parse(bounded(concatBytes(bodyBytes, first), second, bodyBytes));
      try {
        assertEquals((await parser.next()).value, expected[0]);
      } finally {
        await parser.return(undefined);
      }
    }
  }
});

Deno.test("complete enclosures emit promptly and never absorb bytes outside their boundary", async () => {
  const signed = body + groupV2("-K", sigerToken());
  for (const bytes of [encode, decodeB64]) {
    for (
      const wire of [body + groupV2("-C", ""), body + groupV2("-C", groupV2("-K", sigerToken())), groupV2("-B", signed)]
    ) {
      const expected = await parseBytes(bytes(wire));
      assertEquals(expected.length, 1);
      const input = bytes(wire);
      for (const parts of [Array.from(input, (byte) => Uint8Array.of(byte)), [input]]) {
        // The orphan attachment is outside the closed frame and must fail on the next pull.
        const parser = parse(chunks(...parts, bytes(groupV2("-L", sigerToken()))));
        assertEquals((await parser.next()).value, expected[0]);
        await assertRejects(() => parser.next(), ColdStartError);
      }
      const parser = parse(bounded(input));
      try {
        assertEquals((await parser.next()).value, expected[0]);
      } finally {
        await parser.return(undefined);
      }
    }
    const nested = groupV2("-A", groupV2("-A", signed + body) + groupV2("-B", signed));
    assertEquals((await parseBytes(bytes(nested))).length, 3);
  }
});

Deno.test("terminal partial attachments never expose their pending message as complete", async () => {
  const wire = encode(body + groupV2("-K", sigerToken()) + "-LAWAAAA");
  for (const parts of [Array.from(wire, (byte) => Uint8Array.of(byte)), [wire]]) {
    const parser = parse(chunks(...parts));
    await assertRejects(() => parser.next(), ShortageError);
    assertEquals((await parser.next()).done, true);
  }
});

Deno.test("v1 attachment enclosures close at their declared boundary in both domains", async () => {
  const bodyBytes = encode(v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}"));
  const signatures = counterV1("-A", 1) + sigerToken();
  for (const code of ["-V", "--V"]) {
    for (const bytes of [encode, decodeB64]) {
      const wrapper = bytes(counterV1(code, signatures.length / 4) + signatures);
      const parser = parse(bounded(concatBytes(bodyBytes, wrapper.slice(0, -1)), wrapper.slice(-1)));
      try {
        const frame = await parser.next();
        assertEquals(frame.done, false);
        assertEquals(frame.value?.attachments.length, 1);
      } finally {
        await parser.return(undefined);
      }
    }
  }
});

Deno.test("complete frame enclosures reject incomplete inner attachments without waiting", async () => {
  for (const code of ["-A", "-B"]) {
    const parser = parse(bounded(encode(groupV2(code, body + "-LAWAAAA"))));
    await assertRejects(() => parser.next(), GroupSizeError);
    assertEquals((await parser.next()).done, true);
  }
});

Deno.test("complete v1 attachment enclosures reject truncated items without waiting for peers", async () => {
  const bodyBytes = encode(v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}"));
  const truncated = counterV1("-A", 1) + "AAAA";
  for (const code of ["-V", "--V"]) {
    for (const bytes of [encode, decodeB64]) {
      const wrapper = bytes(counterV1(code, truncated.length / 4) + truncated);
      const parser = parse(bounded(concatBytes(bodyBytes, wrapper)));
      await assertRejects(() => parser.next(), GroupSizeError);
      assertEquals((await parser.next()).done, true);
    }
  }
});

Deno.test("complete non-native body enclosures reject truncated matter without waiting for peers", async () => {
  // The Texter header requires another quadlet outside the declared enclosure.
  for (
    const wire of [counterV1(CtrDexV1.NonNativeBodyGroup, 1) + "4BAB", groupV2(CtrDexV2.NonNativeBodyGroup, "4BAB")]
  ) {
    for (const bytes of [encode, decodeB64]) {
      for (const peer of ["", body]) {
        const parser = parse(bounded(bytes(wire + peer)));
        await assertRejects(() => parser.next(), GroupSizeError);
        assertEquals((await parser.next()).done, true);
      }
    }
  }
});
