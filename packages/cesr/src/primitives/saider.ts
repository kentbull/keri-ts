import { SerializeError, UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { dumps, sizeify } from "../serder/serder.ts";
import { smell } from "../serder/smell.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import type { Kind } from "../tables/versions.ts";
import { DIGEST_CODES } from "./codex.ts";
import { Diger } from "./diger.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

export type SaidDigestFn = (ser: Uint8Array, code: string) => Uint8Array;

export interface SaidifyOptions {
  code?: string;
  kind?: Kind;
  label?: string;
  ignore?: string[];
  digest?: SaidDigestFn;
}

export interface SaidifyFieldsOptions {
  kind?: Kind;
  saids: Record<string, string>;
  digest?: SaidDigestFn;
}

/**
 * Self-addressing identifier digest primitive.
 *
 * KERIpy substance: `Saider` is digest-qualified material used as SAD SAID
 * values; this class validates digest-family code semantics.
 */
export class Saider extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!DIGEST_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected said digest code, got ${this.code}`,
      );
    }
  }

  get said(): string {
    return this.qb64;
  }

  get digest(): Uint8Array {
    return this.raw;
  }

  /**
   * Derive one SAID from a SAD, inject it at `label`, and return the updated SAD.
   *
   * KERIpy places `saidify` on `Saider`, not `Serder`: the responsibility here
   * is digest derivation for one saidive field, while event-specific policies
   * such as mirrored `i == d` handling belong in higher layers.
   */
  static saidify(
    sad: Record<string, unknown>,
    {
      code = "E",
      kind,
      label = "d",
      ignore,
      digest = Diger.digest,
    }: SaidifyOptions,
  ): {
    saider: Saider;
    sad: Record<string, unknown>;
  } {
    const working = { ...sad };
    if (ignore) {
      for (const field of ignore) {
        delete working[field];
      }
    }
    const { sad: saidified, saiders } = Saider.saidifyFields(working, {
      kind,
      saids: { [label]: code },
      digest,
    });
    const saider = saiders[label];
    if (!saider) {
      throw new SerializeError(`Expected digestive SAID result for ${label}`);
    }
    return { saider, sad: saidified };
  }

  /**
   * Compute all digestive saidive fields from the same sized-dummied SAD bytes.
   *
   * This mirrors the KERIpy `makify/_compute` model for top-level saidive
   * fields: resolve effective field codes first, dummy only digestive fields,
   * size the version string once, hash once, then fill all digestive fields
   * from that same raw serialization.
   */
  static saidifyFields(
    sad: Record<string, unknown>,
    {
      kind,
      saids,
      digest = Diger.digest,
    }: SaidifyFieldsOptions,
  ): {
    sad: Record<string, unknown>;
    raw: Uint8Array;
    saiders: Record<string, Saider>;
  } {
    const working = { ...sad };
    const actualKind = kind ?? inferKind(working);

    for (const [label, code] of Object.entries(saids)) {
      if (!(label in working)) {
        throw new SerializeError(`Missing SAID field labeled ${label}`);
      }
      if (!DIGEST_CODES.has(code)) {
        continue;
      }

      const sizage = MATTER_SIZES.get(code);
      if (!sizage || sizage.fs === null) {
        throw new SerializeError(`Unsupported fixed-size SAID code ${code}`);
      }
      working[label] = "#".repeat(sizage.fs);
    }

    if ("v" in working) {
      sizeify(working, actualKind);
    }

    const digestRaw = dumps(working, actualKind);
    const saiders: Record<string, Saider> = {};
    for (const [label, code] of Object.entries(saids)) {
      if (!DIGEST_CODES.has(code)) {
        continue;
      }

      const saider = new Saider({
        code,
        raw: digest(digestRaw, code),
      });
      working[label] = saider.qb64;
      saiders[label] = saider;
    }

    const raw = dumps(working, actualKind);
    return { sad: working, raw, saiders };
  }
}

function inferKind(sad: Record<string, unknown>): Kind {
  if (typeof sad.v !== "string") {
    return "JSON";
  }
  return smell(new TextEncoder().encode(sad.v)).smellage.kind;
}

/** Parse and hydrate `Saider` from txt/qb2 bytes. */
export function parseSaider(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Saider {
  return new Saider(parseMatter(input, cold));
}
