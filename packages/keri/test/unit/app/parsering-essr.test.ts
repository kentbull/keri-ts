// @file-test-lane app-fast-parallel

import { assertEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../../../cesr/src/core/bytes.ts";
import { parseBytes } from "../../../../cesr/src/core/parser-engine.ts";
import { counterV1, groupV2 } from "../../../../cesr/test/fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../../../cesr/test/fixtures/external-vectors.ts";
import { v1ify } from "../../../../cesr/test/fixtures/versioned-body-fixtures.ts";
import { envelopesFromFrames } from "../../../src/app/parsering.ts";

Deno.test("ESSR Texters survive CESR parsing into the KERI envelope", () => {
  const payload = "4BABYWJj4BACZGVmZ2hp";
  const v1Body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}");
  const streams = [
    v1Body + counterV1("-Z", 2) + payload,
    KERIPY_NATIVE_V2_ICP_FIX_BODY + groupV2("-Z", payload),
  ];
  for (const stream of streams) {
    // Non-native JSON remains text; the native stream covers both CESR encodings.
    const inputs: Uint8Array[] = [new TextEncoder().encode(stream)];
    if (stream.startsWith("-")) inputs.push(decodeB64(stream));
    for (const bytes of inputs) {
      const envelopes = envelopesFromFrames(parseBytes(bytes));
      assertEquals(envelopes.length, 1);
      assertEquals(envelopes[0].essrs.map((texter) => texter.text), ["abc", "defghi"]);
    }
  }
});
