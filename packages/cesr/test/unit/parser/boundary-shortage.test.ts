import { assertEquals } from "jsr:@std/assert";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/progressive.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";
import { v2ify } from "../../fixtures/versioned-body-fixtures.ts";

Deno.test("boundary-shortage matrix is deterministic at header/mid/just-before-complete cuts", async () => {
  const body = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const attachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const bytes = encode(`${body}${attachment}`);
  const expected = await parseBytes(bytes);
  assertEquals(expected.length, 1);
  assertEquals(expected[0].attachments.map((group) => [group.code, group.count]), [["-K", 22]]);

  const cuts = [
    body.length + 4, // exactly after attachment counter header
    body.length + 4 + (sigerToken().length / 2), // mid attachment payload
    bytes.length - 1, // one byte before completion
  ];
  for (const cut of cuts) {
    let delivered = false;
    /** Crossing a transport boundary cannot expose the still-open frame. */
    const chunks = async function*() {
      yield bytes.slice(0, cut);
      assertEquals(delivered, false);
      yield bytes.slice(cut);
      assertEquals(delivered, false);
    };
    const actual = [];
    for await (const frame of parse(chunks())) {
      delivered = true;
      actual.push(frame);
    }
    assertEquals(actual, expected);
  }
});
