import { collectPayload } from "cesr-ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { decodeB64 } from "../../../../cesr/src/core/bytes.ts";
import { parseBytes } from "../../../../cesr/src/parser/stream.ts";
import { CounterGroup } from "../../../../cesr/src/primitives/counter.ts";
import { counterV1, groupV2 } from "../../../../cesr/test/fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../../../cesr/test/fixtures/external-vectors.ts";
import { v1ify } from "../../../../cesr/test/fixtures/versioned-body-fixtures.ts";
import { envelopesFromFrames } from "../../../src/app/parsering.ts";

Deno.test("ESSR Texters survive CESR parsing into the KERI envelope", async () => {
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
      const events = parseBytes(bytes);
      const event = events[0];
      assert(event.type === "frame");
      const envelopes = envelopesFromFrames(events);
      assertEquals(envelopes.length, 1);
      const essr = envelopes[0].essr!;
      assertEquals(essr.count, 2);
      assertEquals(new TextDecoder().decode(await collectPayload(essr.raw, 9)), "abcdefghi");
      assertEquals(new TextDecoder().decode(await collectPayload(essr.wire, payload.length)), payload);
      assertStrictEquals(envelopes[0].serder, event.frame.body);
      await essr.discard();
      // Public caller-supplied graphs must still satisfy the known primitive role.
      const group = event.frame.attachments[0];
      event.frame.attachments[0] = new CounterGroup(group, group.raw, [group]);
      assertThrows(() => envelopesFromFrames(events), TypeError, "Expected parsed Texter");
    }
  }
});
