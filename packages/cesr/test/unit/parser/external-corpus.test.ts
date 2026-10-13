import { assertEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../../src/core/bytes.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV1, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY, KERIPY_V1_JSON_ICP_BODY } from "../../fixtures/external-vectors.ts";
import { parseFrames, splitIntoThirds, wrapQuadletGroupV2 } from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

/** Independent expected body and attachment facts from the pinned golden corpus. */
interface FrameSummary {
  /** Body serialization kind. */
  kind: string;
  /** Protocol major and minor, independent of selected genus. */
  pvrsn: string;
  /** Event type, empty for opaque bodies. */
  ilk: string;
  /** Event identity, empty when absent. */
  said: string;
  /** Ordered counter code and count pairs. */
  attachments: string[];
}

/** Compare only protocol facts, excluding presentation-domain bytes and parser machinery. */
async function summarizeFrames(input: Uint8Array, boundaries: number[] = []): Promise<FrameSummary[]> {
  return (await parseFrames(input, boundaries)).map(({ body, attachments }) => ({
    kind: body.kind,
    pvrsn: `${body.pvrsn.major}.${body.pvrsn.minor}`,
    ilk: body.ilk ?? "",
    said: body.said ?? "",
    attachments: attachments.map((group) => `${group.code}:${group.count}`),
  }));
}

Deno.test(
  "KERIpy-derived golden corpus preserves txt/qb2 parity and split determinism",
  async () => {
    const expectedSaid = "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN";
    const nestedAttachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken().repeat(2));
    // Build nested wrapper shapes from the canonical KERIpy v2 native fixture so
    // parity assertions lock wrapper semantics, not synthetic body differences.
    const wrappedPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
    const wrappedBodyWithAttachment = wrapQuadletGroupV2(
      CtrDexV2.BodyWithAttachmentGroup,
      wrappedPayload,
    );
    const genericPayload = `${wrappedBodyWithAttachment}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const nestedGeneric = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      genericPayload,
    );

    const corpus: Array<
      { name: string; txt: string; expected: FrameSummary[] }
    > = [
      {
        name: "keripy-native-v2-icp-fix-body",
        txt: KERIPY_NATIVE_V2_ICP_FIX_BODY,
        expected: [
          {
            kind: "CESR",
            pvrsn: "2.0",
            ilk: "icp",
            said: expectedSaid,
            attachments: [],
          },
        ],
      },
      {
        name: "keripy-v2-body-with-attachment-group",
        txt: wrappedBodyWithAttachment,
        expected: [
          {
            kind: "CESR",
            pvrsn: "2.0",
            ilk: "icp",
            said: expectedSaid,
            attachments: [`${CtrDexV2.ControllerIdxSigs}:44`],
          },
        ],
      },
      {
        name: "keripy-v2-generic-group-nested-message-sequence",
        txt: nestedGeneric,
        expected: [
          {
            kind: "CESR",
            pvrsn: "2.0",
            ilk: "icp",
            said: expectedSaid,
            attachments: [`${CtrDexV2.ControllerIdxSigs}:44`],
          },
          {
            kind: "CESR",
            pvrsn: "2.0",
            ilk: "icp",
            said: expectedSaid,
            attachments: [],
          },
        ],
      },
    ];

    for (const fixture of corpus) {
      const txt = encode(fixture.txt);
      // testing split determinism (same semantic result whether data arrives whole or chunked)
      assertEquals(
        await summarizeFrames(txt),
        fixture.expected,
        `txt baseline mismatch for ${fixture.name}`,
      );
      assertEquals(
        await summarizeFrames(txt, splitIntoThirds(txt)), // split into thirds should not affect calculated result
        fixture.expected,
        `txt split mismatch for ${fixture.name}`,
      );

      // qb2 path decodes the exact same CESR material into binary framing.
      // Summary parity here guards against domain-specific interpretation drift.
      const bny = decodeB64(fixture.txt);
      assertEquals(
        await summarizeFrames(bny),
        fixture.expected,
        `qb2 baseline mismatch for ${fixture.name}`,
      );
      assertEquals(
        await summarizeFrames(bny, splitIntoThirds(bny)),
        fixture.expected,
        `qb2 split mismatch for ${fixture.name}`,
      );
    }
  },
);

Deno.test(
  "KERIpy v1 stream parses without an explicit genus selector",
  async () => {
    const stream = `${KERIPY_V1_JSON_ICP_BODY}${counterV1(CtrDexV1.ControllerIdxSigs, 1)}${sigerToken()}`;
    const bodyEnd = KERIPY_V1_JSON_ICP_BODY.length;
    const counterEnd = bodyEnd
      + counterV1(CtrDexV1.ControllerIdxSigs, 1).length;
    // Stress parser continuation right around legacy body->attachment boundary.
    const boundaries = [bodyEnd - 1, bodyEnd + 1, counterEnd + 1];
    const summary = await summarizeFrames(encode(stream), boundaries);

    assertEquals(summary.length, 1);
    assertEquals(summary[0], {
      kind: "JSON",
      pvrsn: "1.0",
      ilk: "icp",
      said: "EIcca2-uqsicYK7-q5gxlZXuzOkqrNSL3JIaLflSOOgF",
      attachments: [`${CtrDexV1.ControllerIdxSigs}:1`],
    });
  },
);
