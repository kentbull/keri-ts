import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { concatBytes, decodeB64 } from "../../../src/core/bytes.ts";
import { GroupSizeError, ShortageError } from "../../../src/core/errors.ts";
import { createParser, parseBytes } from "../../../src/parser/stream.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV1, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY as body } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";
import { v1ify } from "../../fixtures/versioned-body-fixtures.ts";

Deno.test("attachment completion is independent of text/binary chunk partitions in both versions and emission modes", () => {
  for (const version of [1, 2]) {
    for (const binary of [false, true]) {
      const encodeAttachment = binary ? decodeB64 : encode;
      const bodyBytes = version === 1
        ? encode(v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}"))
        : encodeAttachment(body);
      const first = encodeAttachment(version === 1 ? counterV1("-A", 1) + sigerToken() : groupV2("-K", sigerToken()));
      const second = encodeAttachment(version === 1 ? counterV1("-B", 1) + sigerToken() : groupV2("-L", sigerToken()));
      const wire = concatBytes(bodyBytes, first, second);
      for (const framed of [false, true]) {
        const expected = parseBytes(wire, { framed });
        assertEquals(expected.map((event) => event.type), ["frame"]);
        if (expected[0].type === "frame") assertEquals(expected[0].frame.attachments.length, 2);
        for (let split = 0; split <= wire.length; split++) {
          const parser = createParser({ framed });
          assertEquals(parser.feed(wire.slice(0, split)), []);
          assertEquals(parser.feed(new Uint8Array()), []);
          assertEquals(parser.feed(wire.slice(split)), []);
          assertEquals(parser.flush(), expected, `v${version} binary=${binary} framed=${framed} split=${split}`);
          assertEquals(parser.flush(), []);
        }
        const parser = createParser({ framed });
        for (const byte of wire) assertEquals(parser.feed(Uint8Array.of(byte)), []);
        assertEquals(parser.flush(), expected);
        const splitAtGroups = createParser({ framed });
        assertEquals(splitAtGroups.feed(concatBytes(bodyBytes, first)), []);
        assertEquals(splitAtGroups.feed(second), []);
        // A following body closes the attachment set without an EOF signal.
        const emitted = splitAtGroups.feed(bodyBytes);
        assertEquals(emitted, expected);
        assertEquals(splitAtGroups.flush().map((event) => event.type), ["frame"]);
      }
    }
  }
});

Deno.test("complete enclosures emit promptly and never absorb bytes outside their boundary", () => {
  const signed = body + groupV2("-K", sigerToken());
  for (const binary of [false, true]) {
    const bytes = binary ? decodeB64 : encode;
    for (
      const wire of [body + groupV2("-C", ""), body + groupV2("-C", groupV2("-K", sigerToken())), groupV2("-B", signed)]
    ) {
      for (const framed of [false, true]) {
        const expected = parseBytes(bytes(wire), { framed });
        assertEquals(expected.map((event) => event.type), ["frame"]);
        const input = bytes(wire);
        for (let split = 0; split < input.length; split++) {
          const parser = createParser({ framed });
          assertEquals(parser.feed(input.slice(0, split)), []);
          assertEquals(parser.feed(input.slice(split)), expected);
          assertEquals(parser.flush(), []);
        }
        const parser = createParser({ framed });
        assertEquals(parser.feed(input), expected);
        assertEquals(parser.feed(bytes(groupV2("-L", sigerToken()))).map((event) => event.type), ["error"]);
      }
    }
    const nested = groupV2("-A", groupV2("-A", signed + body) + groupV2("-B", signed));
    for (const framed of [false, true]) {
      const expected = parseBytes(bytes(nested), { framed });
      assertEquals(expected.map((event) => event.type), ["frame", "frame", "frame"]);
      const parser = createParser({ framed });
      assertEquals([...parser.feed(bytes(nested)), ...parser.feed(new Uint8Array()), ...parser.flush()], expected);
    }
  }
});

Deno.test("terminal partial attachments never expose their pending message as complete", () => {
  const wire = encode(body + groupV2("-K", sigerToken()) + "-LAWAAAA");
  for (let split = 0; split <= wire.length; split++) {
    const parser = createParser();
    assertEquals(parser.feed(wire.slice(0, split)), []);
    assertEquals(parser.feed(wire.slice(split)), []);
    const events = parser.flush();
    assertEquals(events.map((event) => event.type), ["error"]);
    if (events[0].type === "error") assertInstanceOf(events[0].error, ShortageError);
    assertEquals(parser.flush(), []);
  }
});

Deno.test("v1 attachment enclosures close at their declared boundary in both domains", () => {
  const bodyBytes = encode(v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}"));
  const signatures = counterV1("-A", 1) + sigerToken();
  for (const code of ["-V", "--V"]) {
    for (const bytes of [encode, decodeB64]) {
      const wrapper = bytes(counterV1(code, signatures.length / 4) + signatures);
      for (const framed of [false, true]) {
        const parser = createParser({ framed });
        assertEquals(parser.feed(concatBytes(bodyBytes, wrapper.slice(0, -1))), []);
        const events = parser.feed(wrapper.slice(-1));
        assertEquals(events.map((event) => event.type), ["frame"]);
        if (events[0].type === "frame") assertEquals(events[0].frame.attachments.length, 1);
        assertEquals(parser.flush(), []);
      }
    }
  }
});

Deno.test("complete frame enclosures reject incomplete inner attachments without waiting", () => {
  for (const code of ["-A", "-B"]) {
    const input = encode(groupV2(code, body + "-LAWAAAA"));
    const parser = createParser();
    const events = parser.feed(input);
    assertEquals(events.map((event) => event.type), ["error"]);
    if (events[0].type === "error") assertInstanceOf(events[0].error, GroupSizeError);
    assertEquals(parser.flush(), []);
  }
});

Deno.test("complete v1 attachment enclosures reject truncated items without waiting for peers", () => {
  const bodyBytes = encode(v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}"));
  const truncated = counterV1("-A", 1) + "AAAA";
  for (const code of ["-V", "--V"]) {
    for (const bytes of [encode, decodeB64]) {
      const wrapper = bytes(counterV1(code, truncated.length / 4) + truncated);
      const parser = createParser();
      const events = parser.feed(concatBytes(bodyBytes, wrapper));
      assertEquals(events.map((event) => event.type), ["error"]);
      if (events[0].type === "error") assertInstanceOf(events[0].error, GroupSizeError);
      assertEquals(parser.flush(), []);
    }
  }
});

Deno.test("complete non-native body enclosures reject truncated matter without waiting for peers", () => {
  // The Texter header requires another quadlet outside the declared enclosure.
  for (
    const wire of [
      counterV1(CtrDexV1.NonNativeBodyGroup, 1) + "4BAB",
      groupV2(CtrDexV2.NonNativeBodyGroup, "4BAB"),
    ]
  ) {
    for (const bytes of [encode, decodeB64]) {
      for (const peer of ["", body]) {
        const parser = createParser();
        const events = parser.feed(bytes(wire + peer));
        assertEquals(events.map((event) => event.type), ["error"]);
        if (events[0].type === "error") assertInstanceOf(events[0].error, GroupSizeError);
        assertEquals(parser.flush(), []);
      }
    }
  }
});
