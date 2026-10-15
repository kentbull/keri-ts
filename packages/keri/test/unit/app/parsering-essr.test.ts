import { collectPayload } from "cesr-ts";
import { assertEquals, assertStrictEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../../../cesr/src/core/bytes.ts";
import { parseBytes } from "../../../../cesr/src/parser/complete.ts";
import { counterV1, groupV2 } from "../../../../cesr/test/fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../../../cesr/test/fixtures/external-vectors.ts";
import { v1ify } from "../../../../cesr/test/fixtures/versioned-body-fixtures.ts";
import { envelopesFromFrames } from "../../../src/app/parsering.ts";

Deno.test("ESSR payload ownership transfers unchanged into the KERI envelope", async () => {
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
      const frames = await parseBytes(bytes);
      assertEquals(frames.length, 1);
      const envelopes = envelopesFromFrames(frames);
      assertEquals(envelopes.length, 1);
      const essr = envelopes[0].essr!;
      assertStrictEquals(essr, frames[0].essr);
      assertEquals(essr.count, 2);
      assertEquals(new TextDecoder().decode(await collectPayload(essr.raw)), "abcdefghi");
      assertEquals(new TextDecoder().decode(await collectPayload(essr.wire)), payload);
      assertStrictEquals(envelopes[0].serder, frames[0].body);
      await essr.discard();
    }
  }
});
