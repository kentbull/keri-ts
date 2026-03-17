import { assertEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../src/core/bytes.ts";
import { createParser } from "../../src/core/parser-engine.ts";
import type { CesrFrame } from "../../src/core/types.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  CtrDexByVersion,
  MUDexByVersion,
  SUDexByVersion,
  UniDexByVersion,
} from "../../src/tables/counter-version-registry.ts";
import { counterV1, counterV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY,
  KERIPY_V1_JSON_ICP_BODY,
} from "../fixtures/external-vectors.ts";
import { chunkByBoundaries, encode } from "../fixtures/stream-byte-fixtures.ts";

interface FrameSummary {
  kind: string;
  pvrsn: string;
  ilk: string;
  said: string;
  attachments: string[];
}

/** Parse a stream through chunk boundaries and require error-free extraction. */
function parseFrames(
  input: Uint8Array,
  boundaries: number[] = [],
): CesrFrame[] {
  const parser = createParser();
  const events: CesrFrame[] = [];
  for (const chunk of chunkByBoundaries(input, boundaries)) {
    events.push(...parser.feed(chunk));
  }
  events.push(...parser.flush());

  const errors = events.filter((event) => event.type === "error");
  assertEquals(errors.length, 0);
  return events.filter((event) => event.type === "frame");
}

function summarizeFrames(
  input: Uint8Array,
  boundaries: number[] = [],
): FrameSummary[] {
  const frames = parseFrames(input, boundaries);
  return frames
    .filter((event) => event.type === "frame")
    .map((event) => ({
      kind: event.frame.body.kind,
      pvrsn: `${event.frame.body.pvrsn.major}.${event.frame.body.pvrsn.minor}`,
      ilk: event.frame.body.ilk ?? "",
      said: event.frame.body.said ?? "",
      attachments: event.frame.attachments.map((group) => `${group.code}:${group.count}`),
    }));
}

function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

function splitIntoThirds(input: Uint8Array): number[] {
  // Deterministic split points used for both txt and qb2 domains so
  // split-determinism checks are stable across runs and fixture updates.
  const a = Math.max(1, Math.floor(input.length / 3));
  const b = Math.max(a + 1, Math.floor((2 * input.length) / 3));
  return [a, b];
}

Deno.test(
  "V-P2-017: KERIpy-derived golden corpus preserves txt/qb2 parity and split determinism",
  () => {
    const expectedSaid = "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN";
    const nestedAttachment = `${
      counterV2(CtrDexV2.ControllerIdxSigs, 2)
    }${sigerToken()}${sigerToken()}`;
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
            attachments: [`${CtrDexV2.ControllerIdxSigs}:2`],
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
            attachments: [`${CtrDexV2.ControllerIdxSigs}:2`],
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
        summarizeFrames(txt),
        fixture.expected,
        `txt baseline mismatch for ${fixture.name}`,
      );
      assertEquals(
        summarizeFrames(txt, splitIntoThirds(txt)), // split into thirds should not affect calculated result
        fixture.expected,
        `txt split mismatch for ${fixture.name}`,
      );

      // qb2 path decodes the exact same CESR material into binary framing.
      // Summary parity here guards against domain-specific interpretation drift.
      const bny = decodeB64(fixture.txt);
      assertEquals(
        summarizeFrames(bny),
        fixture.expected,
        `qb2 baseline mismatch for ${fixture.name}`,
      );
      assertEquals(
        summarizeFrames(bny, splitIntoThirds(bny)),
        fixture.expected,
        `qb2 split mismatch for ${fixture.name}`,
      );
    }
  },
);

Deno.test(
  "V-P2-018: selected KERIpy codex entries and subset families remain aligned",
  () => {
    // Keep this intentionally selective: these sentinel entries cover major
    // family pivots and catch accidental codex remaps without snapshotting
    // every generated table cell.
    const expectedCtrDexV1 = {
      ControllerIdxSigs: "-A",
      WitnessIdxSigs: "-B",
      NonTransReceiptCouples: "-C",
      GenericGroup: "-T",
      BodyWithAttachmentGroup: "-U",
      AttachmentGroup: "-V",
      NonNativeBodyGroup: "-W",
      KERIACDCGenusVersion: "-_AAA",
    } as const;
    const expectedCtrDexV2 = {
      GenericGroup: "-A",
      BodyWithAttachmentGroup: "-B",
      AttachmentGroup: "-C",
      DatagramSegmentGroup: "-D",
      ESSRWrapperGroup: "-E",
      FixBodyGroup: "-F",
      MapBodyGroup: "-G",
      NonNativeBodyGroup: "-H",
      GenericMapGroup: "-I",
      GenericListGroup: "-J",
      ControllerIdxSigs: "-K",
      WitnessIdxSigs: "-L",
      NonTransReceiptCouples: "-M",
      KERIACDCGenusVersion: "-_AAA",
    } as const;

    const ctrV1 = CtrDexByVersion[1][0];
    const ctrV2 = CtrDexByVersion[2][0];
    for (const [name, code] of Object.entries(expectedCtrDexV1)) {
      assertEquals(ctrV1[name], code, `CtrDex v1 mismatch at ${name}`);
    }
    for (const [name, code] of Object.entries(expectedCtrDexV2)) {
      assertEquals(ctrV2[name], code, `CtrDex v2 mismatch at ${name}`);
    }

    const expectedUniNamesV1 = [
      "GenericGroup",
      "BigGenericGroup",
      "BodyWithAttachmentGroup",
      "BigBodyWithAttachmentGroup",
      "AttachmentGroup",
      "BigAttachmentGroup",
      "NonNativeBodyGroup",
      "BigNonNativeBodyGroup",
      "KERIACDCGenusVersion",
    ];
    const expectedUniNamesV2 = [
      "GenericGroup",
      "BigGenericGroup",
      "BodyWithAttachmentGroup",
      "BigBodyWithAttachmentGroup",
      "AttachmentGroup",
      "BigAttachmentGroup",
      "DatagramSegmentGroup",
      "BigDatagramSegmentGroup",
      "ESSRWrapperGroup",
      "BigESSRWrapperGroup",
      "FixBodyGroup",
      "BigFixBodyGroup",
      "MapBodyGroup",
      "BigMapBodyGroup",
      "NonNativeBodyGroup",
      "BigNonNativeBodyGroup",
      "GenericMapGroup",
      "BigGenericMapGroup",
      "GenericListGroup",
      "BigGenericListGroup",
      "KERIACDCGenusVersion",
    ];
    const expectedSUNames = [
      "GenericGroup",
      "BigGenericGroup",
      "BodyWithAttachmentGroup",
      "BigBodyWithAttachmentGroup",
      "AttachmentGroup",
      "BigAttachmentGroup",
    ];
    const expectedMUNamesV1 = ["NonNativeBodyGroup", "BigNonNativeBodyGroup"];
    const expectedMUNamesV2 = [
      "DatagramSegmentGroup",
      "BigDatagramSegmentGroup",
      "ESSRWrapperGroup",
      "BigESSRWrapperGroup",
      "FixBodyGroup",
      "BigFixBodyGroup",
      "MapBodyGroup",
      "BigMapBodyGroup",
      "NonNativeBodyGroup",
      "BigNonNativeBodyGroup",
    ];

    // Subset shape assertions lock the conceptual contracts mapped from KERIpy:
    // UniDex = universal, SUDex = special universal, MUDex = message universal.
    assertEquals(
      Object.keys(UniDexByVersion[1][0]).sort(),
      expectedUniNamesV1.sort(),
    );
    assertEquals(
      Object.keys(UniDexByVersion[2][0]).sort(),
      expectedUniNamesV2.sort(),
    );
    assertEquals(
      Object.keys(SUDexByVersion[1][0]).sort(),
      expectedSUNames.sort(),
    );
    assertEquals(
      Object.keys(SUDexByVersion[2][0]).sort(),
      expectedSUNames.sort(),
    );
    assertEquals(
      Object.keys(MUDexByVersion[1][0]).sort(),
      expectedMUNamesV1.sort(),
    );
    assertEquals(
      Object.keys(MUDexByVersion[2][0]).sort(),
      expectedMUNamesV2.sort(),
    );
  },
);

Deno.test(
  "V-P2-019: historical implicit-v1 KERIpy-style stream parses in compat mode without selectors",
  () => {
    const stream = `${KERIPY_V1_JSON_ICP_BODY}${
      counterV1(CtrDexV1.ControllerIdxSigs, 1)
    }${sigerToken()}`;
    const bodyEnd = KERIPY_V1_JSON_ICP_BODY.length;
    const counterEnd = bodyEnd
      + counterV1(CtrDexV1.ControllerIdxSigs, 1).length;
    // Stress parser continuation right around legacy body->attachment boundary.
    const boundaries = [bodyEnd - 1, bodyEnd + 1, counterEnd + 1];
    const summary = summarizeFrames(encode(stream), boundaries);

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
