import { assert } from "jsr:@std/assert";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { VersionError } from "../../../src/core/errors.ts";
import {
  CtrDexByVersion,
  LEGACY_COMPAT_COUNTER_CODES_BY_VERSION,
  MUDexByVersion,
  resolveCounterCodeNameTable,
  resolveCtrDex,
  resolveTable,
  SUDexByVersion,
  UniDexByVersion,
  type VersionedRegistry,
} from "../../../src/tables/counter-version-registry.ts";
import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../../../src/tables/counter.tables.generated.ts";

Deno.test(
  "versioned registry resolver binds to latest compatible minor within major",
  () => {
    const registry: VersionedRegistry<string> = {
      1: { 0: "v1.0", 2: "v1.2" },
      2: { 0: "v2.0" },
    };

    const resolved = resolveTable(
      registry,
      { major: 1, minor: 0 },
      "test registry",
    );
    assertEquals(resolved.value, "v1.2");
    assertEquals(resolved.resolvedMinor, 2);
    assertEquals(resolved.latestMinor, 2);
  },
);

Deno.test(
  "versioned registry resolver rejects unsupported requested minor",
  () => {
    const registry: VersionedRegistry<string> = {
      1: { 0: "v1.0", 2: "v1.2" },
      2: { 0: "v2.0" },
    };

    assertThrows(
      () =>
        resolveTable(
          registry,
          { major: 1, minor: 3 },
          "test registry",
        ),
      VersionError,
    );
  },
);

Deno.test(
  "CtrDexByVersion excludes legacy v1 sad-path aliases but keeps explicit allowlist",
  () => {
    const ctr = resolveCtrDex({ major: 1, minor: 0 });
    assertEquals("SadPathSig" in ctr, false);
    assertEquals("SadPathSigGroup" in ctr, false);

    const aliases = LEGACY_COMPAT_COUNTER_CODES_BY_VERSION[1][0];
    assertEquals(aliases.has("-J"), true);
    assertEquals(aliases.has("-K"), true);
  },
);

Deno.test(
  "counter code-name table resolution enforces supported minor bounds",
  () => {
    const names = resolveCounterCodeNameTable({ major: 2, minor: 0 });
    assertEquals(names["-A"], "GenericGroup");

    assertThrows(
      () => resolveCounterCodeNameTable({ major: 2, minor: 1 }),
      VersionError,
    );
  },
);

Deno.test(
  "selected KERIpy codex entries and subset families remain aligned",
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

Deno.test("legacy v1 sad path aliases persist in generated tables", () => {
  assertEquals(COUNTER_CODE_NAMES_V1["-J"], "SadPathSig");
  assertEquals(COUNTER_CODE_NAMES_V1["-K"], "SadPathSigGroup");
  assert(COUNTER_SIZES_V1.has("-J"));
  assert(COUNTER_SIZES_V1.has("-K"));
  assert(COUNTER_SIZES_V2.has("-J"));
});
