import { assertEquals } from "jsr:@std/assert";
import { ATTACHMENT_DISPATCH_SPEC } from "../../src/parser/group-dispatch.ts";
import {
  CtrDexByVersion,
  LEGACY_COMPAT_COUNTER_CODES_BY_VERSION,
  MUDexByVersion,
  SUDexByVersion,
  UniDexByVersion,
} from "../../src/tables/counter-version-registry.ts";
import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_CODE_NAMES_V2,
} from "../../src/tables/counter.tables.generated.ts";

type DispatchMajor = 1 | 2;

function keyFor(major: DispatchMajor, code: string): string {
  return `${major}:${code}`;
}

function keyForMinor(
  major: DispatchMajor,
  minor: number,
  code: string,
): string {
  return `${major}.${minor}:${code}`;
}

function collectDispatchCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const family of ATTACHMENT_DISPATCH_SPEC) {
    for (const major of [1, 2] as const) {
      for (const code of family.codesByVersion[major] ?? []) {
        const key = keyFor(major, code);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function expectedCodeSetFromTables(): Set<string> {
  const expected = new Set<string>();
  for (const code of Object.keys(COUNTER_CODE_NAMES_V1)) {
    expected.add(keyFor(1, code));
  }
  for (const code of Object.keys(COUNTER_CODE_NAMES_V2)) {
    expected.add(keyFor(2, code));
  }
  return expected;
}

function collectCodexCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const major of [1, 2] as const) {
    for (const [minorText, codex] of Object.entries(CtrDexByVersion[major])) {
      const minor = Number(minorText);
      for (const code of Object.values(codex)) {
        const key = keyForMinor(major, minor, code);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function expectedCodeSetFromTablesByMinorZero(): Set<string> {
  const expected = new Set<string>();
  for (const code of Object.keys(COUNTER_CODE_NAMES_V1)) {
    expected.add(keyForMinor(1, 0, code));
  }
  for (const code of Object.keys(COUNTER_CODE_NAMES_V2)) {
    expected.add(keyForMinor(2, 0, code));
  }
  return expected;
}

function collectLegacyCompatKeysByMinor(): Set<string> {
  const keys = new Set<string>();
  for (const major of [1, 2] as const) {
    for (
      const [minorText, compatCodes] of Object.entries(
        LEGACY_COMPAT_COUNTER_CODES_BY_VERSION[major],
      )
    ) {
      const minor = Number(minorText);
      for (const code of compatCodes) {
        keys.add(keyForMinor(major, minor, code));
      }
    }
  }
  return keys;
}

function collectLegacyCompatKeysByMajor(): Set<string> {
  const keys = new Set<string>();
  for (const major of [1, 2] as const) {
    for (
      const compatCodes of Object.values(
        LEGACY_COMPAT_COUNTER_CODES_BY_VERSION[major],
      )
    ) {
      for (const code of compatCodes) {
        keys.add(keyFor(major, code));
      }
    }
  }
  return keys;
}

type DispatchFamily = (typeof ATTACHMENT_DISPATCH_SPEC)[number];

function tupleKey(tupleKinds: readonly string[] | undefined): string {
  return (tupleKinds ?? []).join("|");
}

Deno.test(
  "dispatch spec invariant: generated table entries appear exactly once (with explicit legacy compat allowance)",
  () => {
    const counts = collectDispatchCounts();

    const duplicates = [...counts.entries()]
      .filter(([_key, count]) => count > 1)
      .map(([key]) => key)
      .sort();
    assertEquals(
      duplicates,
      [],
      "Each (major, code) dispatch entry must be declared at most once",
    );

    const expected = expectedCodeSetFromTables();
    const actual = new Set(counts.keys());

    const missing = [...expected].filter((key) => !actual.has(key)).sort();
    assertEquals(
      missing,
      [],
      "Every generated (major, code) must be represented in ATTACHMENT_DISPATCH_SPEC",
    );

    const legacyCompatExtras = collectLegacyCompatKeysByMajor();

    const unexpected = [...actual]
      .filter((key) => !expected.has(key))
      .sort();
    const disallowedUnexpected = unexpected
      .filter((key) => !legacyCompatExtras.has(key))
      .sort();
    assertEquals(
      disallowedUnexpected,
      [],
      "Dispatch spec includes unexpected (major, code) entries not in generated tables or legacy-compat allowances",
    );

    for (const legacyKey of legacyCompatExtras) {
      assertEquals(
        counts.get(legacyKey),
        1,
        `Legacy compatibility entry ${legacyKey} must appear exactly once`,
      );
    }
  },
);

Deno.test(
  "dispatch spec invariant: semanticShape drives parser-kind/flag contracts",
  () => {
    const seenShapes = new Set<string>();

    for (const family of ATTACHMENT_DISPATCH_SPEC) {
      const f = family as DispatchFamily;
      const shape = f.semanticShape;
      seenShapes.add(shape);

      switch (shape) {
        case "genusVersionMarker":
          assertEquals(f.parserKind, "genusVersion");
          assertEquals(f.wrapperGroup ?? false, false);
          assertEquals(f.allowsSigerList ?? false, false);
          assertEquals(tupleKey(f.tupleKinds), "");
          break;

        case "countedGroupPayload":
          assertEquals(f.parserKind, "quadlet");
          assertEquals(f.wrapperGroup ?? false, false);
          assertEquals(f.allowsSigerList ?? false, false);
          assertEquals(tupleKey(f.tupleKinds), "");
          break;

        case "wrapperGroupPayload":
          assertEquals(f.parserKind, "quadlet");
          assertEquals(f.wrapperGroup ?? false, true);
          assertEquals(f.allowsSigerList ?? false, false);
          assertEquals(tupleKey(f.tupleKinds), "");
          break;

        case "primitiveTuples":
          assertEquals(f.parserKind, "repeatTuple");
          assertEquals((f.tupleKinds?.length ?? 0) > 0, true);
          assertEquals(f.wrapperGroup ?? false, false);
          if (f.allowsSigerList === true) {
            // Only controller/witness indexer tuple families should advertise
            // siger-list compatibility for nested signature-group parsing.
            assertEquals(tupleKey(f.tupleKinds), "indexer");
          }
          break;

        case "signatureGroupTuples":
          assertEquals(f.parserKind, "transIdxSigGroups");
          assertEquals(f.wrapperGroup ?? false, false);
          assertEquals(f.allowsSigerList ?? false, false);
          assertEquals(tupleKey(f.tupleKinds), "");
          break;

        case "lastSignatureGroupTuples":
          assertEquals(f.parserKind, "transLastIdxSigGroups");
          assertEquals(f.wrapperGroup ?? false, false);
          assertEquals(f.allowsSigerList ?? false, false);
          assertEquals(tupleKey(f.tupleKinds), "");
          break;

        case "sadPathSignatures":
          assertEquals(f.parserKind, "sadPathSig");
          assertEquals(f.wrapperGroup ?? false, false);
          assertEquals(f.allowsSigerList ?? false, false);
          assertEquals(tupleKey(f.tupleKinds), "");
          break;

        case "sadPathSignatureGroup":
          assertEquals(f.parserKind, "sadPathSigGroup");
          assertEquals(f.wrapperGroup ?? false, false);
          assertEquals(f.allowsSigerList ?? false, false);
          assertEquals(tupleKey(f.tupleKinds), "");
          break;

        default: {
          // Exhaustiveness guard for future shape additions.
          const _exhaustive: never = shape;
          throw new Error(`Unhandled semantic shape: ${_exhaustive}`);
        }
      }

      const v1Count = f.codesByVersion[1]?.length ?? 0;
      const v2Count = f.codesByVersion[2]?.length ?? 0;
      assertEquals(
        v1Count + v2Count > 0,
        true,
        `semantic shape ${shape} must declare at least one routed code`,
      );
    }

    assertEquals(
      seenShapes,
      new Set([
        "genusVersionMarker",
        "countedGroupPayload",
        "wrapperGroupPayload",
        "primitiveTuples",
        "signatureGroupTuples",
        "lastSignatureGroupTuples",
        "sadPathSignatures",
        "sadPathSignatureGroup",
      ]),
      "All semanticShape categories must remain represented in ATTACHMENT_DISPATCH_SPEC",
    );
  },
);

Deno.test(
  "codex registry invariant: versioned CtrDex coverage is complete except explicit legacy aliases",
  () => {
    const counts = collectCodexCounts();
    const duplicates = [...counts.entries()]
      .filter(([_key, count]) => count > 1)
      .map(([key]) => key)
      .sort();
    assertEquals(
      duplicates,
      [],
      "Each (major, minor, code) in CtrDexByVersion must be unique",
    );

    const expected = expectedCodeSetFromTablesByMinorZero();
    const actual = new Set(counts.keys());
    const legacyCompat = collectLegacyCompatKeysByMinor();

    const missing = [...expected].filter((key) => !actual.has(key)).sort();
    assertEquals(
      missing,
      [...legacyCompat].sort(),
      "Only explicit legacy compatibility aliases may be omitted from CtrDexByVersion",
    );

    const unexpected = [...actual].filter((key) => !expected.has(key)).sort();
    assertEquals(
      unexpected,
      [],
      "CtrDexByVersion must not define codes absent from generated tables",
    );
  },
);

Deno.test(
  "codex subset invariant: SUDex/MUDex/UniDex relationships remain strict",
  () => {
    for (const major of [1, 2] as const) {
      for (const minorText of Object.keys(CtrDexByVersion[major])) {
        const minor = Number(minorText);
        const ctr = CtrDexByVersion[major][minor];
        const uni = UniDexByVersion[major][minor];
        const su = SUDexByVersion[major][minor];
        const mu = MUDexByVersion[major][minor];

        const ctrCodes = new Set(Object.values(ctr));
        const uniCodes = new Set(Object.values(uni));
        const suCodes = new Set(Object.values(su));
        const muCodes = new Set(Object.values(mu));

        for (const code of uniCodes) {
          assertEquals(
            ctrCodes.has(code),
            true,
            `UniDex code ${code} must exist in CtrDex (${major}.${minor})`,
          );
        }
        for (const code of suCodes) {
          assertEquals(
            uniCodes.has(code),
            true,
            `SUDex code ${code} must exist in UniDex (${major}.${minor})`,
          );
        }
        for (const code of muCodes) {
          assertEquals(
            uniCodes.has(code),
            true,
            `MUDex code ${code} must exist in UniDex (${major}.${minor})`,
          );
        }
      }
    }
  },
);

Deno.test(
  "dispatch/codex invariant: dispatch routes are backed by CtrDex or explicit legacy alias allowances",
  () => {
    const dispatch = new Set(collectDispatchCounts().keys());
    const codexMajorKeys = new Set<string>();
    for (const major of [1, 2] as const) {
      for (const codex of Object.values(CtrDexByVersion[major])) {
        for (const code of Object.values(codex)) {
          codexMajorKeys.add(keyFor(major, code));
        }
      }
    }

    const legacyCompat = collectLegacyCompatKeysByMajor();
    const disallowed = [...dispatch]
      .filter((key) => !codexMajorKeys.has(key))
      .filter((key) => !legacyCompat.has(key))
      .sort();
    assertEquals(
      disallowed,
      [],
      "Dispatch routes must resolve to CtrDexByVersion entries or explicit legacy alias allowances",
    );
  },
);
