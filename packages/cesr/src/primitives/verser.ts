import { b64ToInt } from "../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { Protocol } from "../tables/versions.ts";

const PROTOCOLS = new Set<Protocol>(["KERI", "ACDC"]);

export interface Verser {
  code: string;
  qb64: string;
  fullSize: number;
  fullSizeB2: number;
  proto: Protocol;
  pvrsn: Versionage;
  gvrsn: Versionage;
}

export function parseVerser(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Verser {
  const matter = parseMatter(input, cold);
  if (matter.code !== "0O" && matter.code !== "1O") {
    throw new UnknownCodeError(
      `Expected verser code (0O/1O), got ${matter.code}`,
    );
  }

  const body = matter.qb64.slice(matter.code.length);
  if (body.length < 6) {
    throw new DeserializeError(`Invalid verser body length=${body.length}`);
  }

  const proto = body.slice(0, 4) as Protocol;
  if (!PROTOCOLS.has(proto)) {
    throw new DeserializeError(`Unsupported verser proto=${proto}`);
  }

  const major = b64ToInt(body[4]) === 1 ? 1 : 2;
  const minor = b64ToInt(body[5]);
  const versage: Versionage = { major, minor };

  return {
    code: matter.code,
    qb64: matter.qb64,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
    proto,
    pvrsn: versage,
    gvrsn: versage,
  };
}
