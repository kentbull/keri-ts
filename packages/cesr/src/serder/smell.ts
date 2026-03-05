import { b64ToInt, intToB64 } from "../core/bytes.ts";
import { ShortageError, VersionError } from "../core/errors.ts";
import type { Smellage } from "../core/types.ts";
import type { Kind, Protocol } from "../tables/versions.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Vrsn_1_0 } from "../tables/versions.ts";

// KERIpy parity: allow version token to begin within the first 12 bytes.
const MAXVSOFFSET = 12;
const VER1 =
  /(?<proto1>[A-Z]{4})(?<major1>[0-9a-f])(?<minor1>[0-9a-f])(?<kind1>[A-Z]{4})(?<size1>[0-9a-f]{6})_/;
const VER2 =
  /(?<proto2>[A-Z]{4})(?<pmajor2>[A-Za-z0-9_-])(?<pminor2>[A-Za-z0-9_-]{2})(?<gmajor2>[A-Za-z0-9_-])(?<gminor2>[A-Za-z0-9_-]{2})(?<kind2>[A-Z]{4})(?<size2>[A-Za-z0-9_-]{4})\./;

/**
 * Builds a CESR version string from its constituent parts.
 * Complement of {@link smell}.
 */
export function versify(opts: {
  proto?: Protocol;
  pvrsn?: Versionage;
  gvrsn?: Versionage | null;
  kind?: Kind;
  size: number;
}): string {
  const {
    proto = "KERI",
    pvrsn = Vrsn_1_0,
    gvrsn = null,
    kind = "JSON",
    size,
  } = opts;

  if (pvrsn.major === 1) {
    const hex = size.toString(16).padStart(6, "0");
    return `${proto}${pvrsn.major.toString(16)}${pvrsn.minor.toString(16)}${kind}${hex}_`;
  }

  // V2 format
  const gv = gvrsn ?? { major: 0, minor: 0 };
  return `${proto}${intToB64(pvrsn.major, 1)}${intToB64(pvrsn.minor, 2)}${intToB64(gv.major, 1)}${intToB64(gv.minor, 2)}${kind}${intToB64(size, 4)}.`;
}

function byteWindowToText(raw: Uint8Array): string {
  const out: string[] = [];
  for (const b of raw) {
    out.push(String.fromCharCode(b));
  }
  return out.join("");
}

export function smell(
  raw: Uint8Array,
): { smellage: Smellage; start: number; fullLength: number } {
  const txt = byteWindowToText(raw.slice(0, 256));

  const m2 = VER2.exec(txt);
  if (m2 && m2.index <= MAXVSOFFSET && m2.groups) {
    return {
      smellage: {
        proto: m2.groups.proto2 as "KERI" | "ACDC",
        pvrsn: {
          major: b64ToInt(m2.groups.pmajor2) as 1 | 2,
          minor: b64ToInt(m2.groups.pminor2),
        },
        gvrsn: {
          major: b64ToInt(m2.groups.gmajor2) as 1 | 2,
          minor: b64ToInt(m2.groups.gminor2),
        },
        kind: m2.groups.kind2 as "JSON" | "CBOR" | "MGPK" | "CESR",
        size: b64ToInt(m2.groups.size2),
      },
      start: m2.index,
      fullLength: m2[0].length,
    };
  }

  const m1 = VER1.exec(txt);
  if (m1 && m1.index <= MAXVSOFFSET && m1.groups) {
    return {
      smellage: {
        proto: m1.groups.proto1 as "KERI" | "ACDC",
        pvrsn: {
          major: Number.parseInt(m1.groups.major1, 16) as 1 | 2,
          minor: Number.parseInt(m1.groups.minor1, 16),
        },
        gvrsn: null,
        kind: m1.groups.kind1 as "JSON" | "CBOR" | "MGPK" | "CESR",
        size: Number.parseInt(m1.groups.size1, 16),
      },
      start: m1.index,
      fullLength: m1[0].length,
    };
  }

  if (raw.length < 64) {
    throw new ShortageError(64, raw.length);
  }
  throw new VersionError("Invalid or missing version string in stream window");
}
