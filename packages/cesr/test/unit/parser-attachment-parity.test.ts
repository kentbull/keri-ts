import { assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { decodeB64 } from "../../src/core/bytes.ts";
import { GroupSizeError, ShortageError, UnknownCodeError, VersionError } from "../../src/core/errors.ts";
import { parseBytes } from "../../src/core/parser-engine.ts";
import { parseAttachmentGroup } from "../../src/parser/attachment-parser.ts";
import { Texter } from "../../src/primitives/texter.ts";
import { counterV1, groupV2, sigerToken, token } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

const V1 = { major: 1, minor: 0 } as const;
const V2 = { major: 2, minor: 0 } as const;
const domains = ["txt", "bny"] as const;
const bytes = (text: string, domain: typeof domains[number]) =>
  domain === "txt" ? new TextEncoder().encode(text) : decodeB64(text);

Deno.test("ESSR rehydrates Texters with v1 item counts and v2 payload lengths", () => {
  const payload = "4BABYWJj" + "4BACZGVmZ2hp";
  for (const version of [V1, V2]) {
    for (const code of ["-Z", "--Z"]) {
      const wire = version.major === 1 ? counterV1(code, 2) + payload : groupV2(code, payload);
      for (const domain of domains) {
        const parsed = parseAttachmentGroup(bytes(wire + wire, domain), version, domain);
        assertEquals(parsed.consumed, bytes(wire, domain).length);
        assertEquals(parsed.group.items.length, 2);
        for (const item of parsed.group.items) assertInstanceOf(item, Texter);
        assertEquals(parsed.group.items.map((item) => (item as Texter).text), ["abc", "defghi"]);
      }
    }
  }
});

Deno.test("ESSR distinguishes transport shortage from an incomplete bounded Texter", () => {
  for (const domain of domains) {
    assertThrows(() => parseAttachmentGroup(bytes("-ZAB4BAB", domain), V1, domain), ShortageError);
    assertThrows(() => parseAttachmentGroup(bytes("-ZAC4BAB", domain), V2, domain), ShortageError);
    assertThrows(() => parseAttachmentGroup(bytes("-ZAB4BABYWJj", domain), V2, domain), GroupSizeError);
    assertThrows(() => parseAttachmentGroup(bytes("-ZABMAAA", domain), V2, domain), UnknownCodeError);
  }
});

Deno.test("genus selectors reject unsupported majors and both minor sextets at every dispatch boundary", () => {
  for (const domain of domains) {
    for (const suffix of ["AAA", "DAA", "CAB", "CBA"]) {
      const selector = "-_AAA" + suffix;
      const events = parseBytes(bytes(selector + KERIPY_NATIVE_V2_ICP_FIX_BODY, domain));
      assertEquals(events.length, 1);
      assertEquals(events[0].type, "error");
      if (events[0].type === "error") assertInstanceOf(events[0].error, VersionError);
      for (const stream of [selector, groupV2("-C", selector)]) {
        assertThrows(() => parseAttachmentGroup(bytes(stream, domain), V2, domain), VersionError);
      }
    }
    const events = parseBytes(bytes("-_AAACAA" + KERIPY_NATIVE_V2_ICP_FIX_BODY, domain));
    assertEquals(events.map((event) => event.type), ["frame"]);
  }
});

Deno.test("nested transferable signature groups require the pinned controller counter", () => {
  for (const version of [V1, V2]) {
    const cases = version.major === 1
      ? [["-F", token("B") + token("M") + token("E")], ["-H", token("B")]]
      : [["-X", token("B") + token("M") + token("E")], ["-Y", token("B")]];
    for (const [code, prefix] of cases) {
      for (const innerCode of version.major === 1 ? ["-A", "-B"] : ["-K", "-L", "--K", "--L"]) {
        const inner = version.major === 1 ? counterV1(innerCode, 1) + sigerToken() : groupV2(innerCode, sigerToken());
        const wire = version.major === 1 ? counterV1(code, 1) + prefix + inner : groupV2(code, prefix + inner);
        for (const domain of domains) {
          const parse = () => parseAttachmentGroup(bytes(wire, domain), version, domain);
          if (innerCode === (version.major === 1 ? "-A" : "-K")) assertEquals(parse().group.items.length, 1);
          else assertThrows(parse, UnknownCodeError);
        }
      }
    }
  }
});
