import { assertEquals, assertThrows } from "jsr:@std/assert";
import { ShortageError, UnknownCodeError } from "../../../src/core/errors.ts";
import { parseAttachmentGroup } from "../../../src/parser/attachments.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import {
  CtrDexByVersion,
  LEGACY_COMPAT_COUNTER_CODES_BY_VERSION,
  MUDexByVersion,
  resolveCounterSizeTable,
  SUDexByVersion,
  UniDexByVersion,
} from "../../../src/tables/counter-version-registry.ts";
import { COUNTER_CODE_NAMES_V1, COUNTER_CODE_NAMES_V2 } from "../../../src/tables/counter.tables.generated.ts";

/** Both protocol genera whose generated counters must dispatch. */
type DispatchMajor = 1 | 2;

/** Identify a wire code in its major/minor registry for set comparisons. */
function keyForMinor(
  major: DispatchMajor,
  minor: number,
  code: string,
): string {
  return `${major}.${minor}:${code}`;
}

/** Count semantic codex references to each supported wire counter. */
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

/** Build the independent generated-table set for the currently supported minor zero. */
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

/** Collect protocol v1 path-signature aliases excluded from the modern codex. */
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

Deno.test("wire counter dispatch distinguishes attachment routes from structing-only nonce seals", () => {
  for (const major of [1, 2] as const) {
    const gvrsn = { major, minor: 0 };
    const codes: Readonly<Record<string, string>> = major === 1 ? COUNTER_CODE_NAMES_V1 : COUNTER_CODE_NAMES_V2;
    for (const code of resolveCounterSizeTable(gvrsn).keys()) {
      const name = codes[code];
      const counter = name === "KERIACDCGenusVersion"
        ? new Counter({ qb64b: Counter.makeGVC(gvrsn), version: gvrsn })
        : new Counter({ code, count: 0, version: gvrsn });
      for (const domain of ["txt", "bny"] as const) {
        const raw = domain === "txt" ? new TextEncoder().encode(counter.qb64) : counter.qb2;
        const parse = () => parseAttachmentGroup(raw, gvrsn, domain);
        if (name === "NonceSealSingles" || name === "BigNonceSealSingles") {
          assertThrows(parse, UnknownCodeError);
        } else if (name === "SadPathSigGroup") {
          // Even an empty path-signature group requires its root path token.
          assertThrows(parse, ShortageError);
        } else {
          const parsed = parse();
          assertEquals(parsed.group.code, code);
          assertEquals(parsed.consumed, raw.length);
        }
      }
    }
  }
});
