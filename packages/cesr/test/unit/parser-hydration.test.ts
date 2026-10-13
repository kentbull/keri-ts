import { assertEquals, assertThrows } from "jsr:@std/assert";
import { decodeB64 } from "../../src/core/bytes.ts";
import { UnknownCodeError } from "../../src/core/errors.ts";
import { parseAttachmentGroup } from "../../src/parser/attachments.ts";
import { Cigar } from "../../src/primitives/cigar.ts";
import { Dater } from "../../src/primitives/dater.ts";
import { Diger } from "../../src/primitives/diger.ts";
import { Prefixer } from "../../src/primitives/prefixer.ts";
import { isGroupTuple } from "../../src/primitives/primitive.ts";
import { Seqner } from "../../src/primitives/seqner.ts";
import { Siger } from "../../src/primitives/siger.ts";
import { Verfer } from "../../src/primitives/verfer.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV1, groupV2, sigerToken, token } from "../fixtures/counter-token-fixtures.ts";

Deno.test("attachment roles hydrate narrow primitives in both genera and domains", () => {
  // KERIpy 450ae1c uses Seqner for these ordinals in both versions.
  for (const major of [1, 2] as const) {
    const codex = major === 1 ? CtrDexV1 : CtrDexV2;
    for (
      const [code, payload, classes] of [
        [codex.ControllerIdxSigs, sigerToken(), [Siger]],
        [codex.NonTransReceiptCouples, token("B") + token("0B"), [Verfer, Cigar]],
        [codex.FirstSeenReplayCouples, token("0A") + token("1AAG"), [Seqner, Dater]],
        [codex.SealSourceCouples, token("0A") + token("E"), [Seqner, Diger]],
        [codex.TransReceiptQuadruples, token("B") + token("0A") + token("E") + sigerToken(), [
          Prefixer,
          Seqner,
          Diger,
          Siger,
        ]],
      ] as const
    ) {
      const wire = major === 1 ? counterV1(code, 1) + payload : groupV2(code, payload);
      for (const domain of ["txt", "bny"] as const) {
        const bytes = domain === "txt" ? new TextEncoder().encode(wire) : decodeB64(wire);
        const { group, consumed } = parseAttachmentGroup(bytes, { major, minor: 0 }, domain);
        const tuple = group.items[0];
        assertEquals(isGroupTuple(tuple), true);
        if (!isGroupTuple(tuple)) throw new Error("Expected tuple");
        assertEquals(tuple.map((part) => part.constructor), [...classes]);
        assertEquals(consumed, bytes.length);
      }
    }
  }
});

Deno.test("known attachment roles reject wrong primitive codes at the CESR boundary", () => {
  for (const major of [1, 2] as const) {
    const codex = major === 1 ? CtrDexV1 : CtrDexV2;
    for (
      const [code, payload] of [
        [codex.NonTransReceiptCouples, token("E") + token("0B")],
        [codex.NonTransReceiptCouples, token("B") + token("E")],
        [codex.SealSourceCouples, token("M") + token("E")],
        [codex.SealSourceCouples, token("0A") + token("B")],
      ]
    ) {
      const wire = major === 1 ? counterV1(code, 1) + payload : groupV2(code, payload);
      for (const domain of ["txt", "bny"] as const) {
        const bytes = domain === "txt" ? new TextEncoder().encode(wire) : decodeB64(wire);
        assertThrows(() => parseAttachmentGroup(bytes, { major, minor: 0 }, domain), UnknownCodeError);
      }
    }
  }
});
