import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Dater {
  code: string;
  qb64: string;
  dts: string;
  iso8601: string;
  fullSize: number;
  fullSizeB2: number;
}

function toIso8601(dts: string): string {
  return dts.replaceAll("c", ":").replaceAll("d", ".").replaceAll("p", "+");
}

export function parseDater(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Dater {
  const matter = parseMatter(input, cold);
  const name = MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES];
  if (name !== "DateTime") {
    throw new UnknownCodeError(
      `Expected dater DateTime code, got ${matter.code}`,
    );
  }

  const dts = new TextDecoder().decode(matter.raw);
  return {
    code: matter.code,
    qb64: matter.qb64,
    dts,
    iso8601: toIso8601(dts),
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
