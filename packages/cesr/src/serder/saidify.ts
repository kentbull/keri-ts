import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import { SerializeError } from "../core/errors.ts";
import { Matter } from "../primitives/matter.ts";
import { versify } from "./smell.ts";
import { serializeBody } from "./serder.ts";
import type { Kind, Protocol } from "../tables/versions.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Vrsn_1_0 } from "../tables/versions.ts";

/** Caller-provided hash function (e.g. blake3). */
export type HashFn = (data: Uint8Array) => Uint8Array;

export interface SaidifyResult {
  ked: Record<string, unknown>;
  raw: Uint8Array;
  said: string;
}

/**
 * Computes the Self-Addressing Identifier (SAID) for a key event dictionary.
 *
 * cesr-ts stays crypto-free: the hash function is supplied by the caller.
 */
export function saidify(
  ked: Record<string, unknown>,
  hashFn: HashFn,
  opts?: {
    field?: string;
    code?: string;
    kind?: Kind;
    proto?: Protocol;
    pvrsn?: Versionage;
  },
): SaidifyResult {
  const field = opts?.field ?? "d";
  const code = opts?.code ?? "E";
  const kind = opts?.kind ?? "JSON";
  const proto = opts?.proto ?? "KERI";
  const pvrsn = opts?.pvrsn ?? Vrsn_1_0;

  const sizage = MATTER_SIZES.get(code);
  if (!sizage) {
    throw new SerializeError(`Unknown matter code: ${code}`);
  }
  if (sizage.fs === null) {
    throw new SerializeError(
      `Variable-size code ${code} not supported for saidify`,
    );
  }

  const clone = { ...ked };
  const placeholder = "#".repeat(sizage.fs);
  clone[field] = placeholder;

  // If the ked also uses the SAID as the identifier, placeholder that too
  if (field === "d" && ked.i === ked.d) {
    clone.i = placeholder;
  }

  // Update version string with measured size if `v` field exists
  if (typeof clone.v === "string") {
    const measured = serializeBody(clone, kind);
    clone.v = versify({ proto, pvrsn, kind, size: measured.length });
  }

  const raw = serializeBody(clone, kind);
  const digest = hashFn(raw);
  const said = new Matter({ code, raw: digest }).qb64;

  clone[field] = said;
  if (field === "d" && ked.i === ked.d) {
    clone.i = said;
  }

  // Re-serialize with final SAID and correct version size
  if (typeof clone.v === "string") {
    const finalRaw = serializeBody(clone, kind);
    clone.v = versify({ proto, pvrsn, kind, size: finalRaw.length });
  }
  const finalRaw = serializeBody(clone, kind);

  return { ked: clone, raw: finalRaw, said };
}
