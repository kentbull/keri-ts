import { argon2id } from "npm:@noble/hashes@1.8.0/argon2";
import { UnknownCodeError } from "../core/errors.ts";
import { type Tier, Tiers } from "../core/vocabulary.ts";
import { MtrDex } from "./codex.ts";
import { SALTER_CODES } from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";
import { signerSeedSizeForCode } from "./signature-suite.ts";
import { Signer } from "./signer.ts";

export interface SalterInit extends MatterInit {
  tier?: Tier;
}

export interface SalterStretchOptions {
  size?: number;
  path?: string;
  tier?: Tier;
  temp?: boolean;
}

export interface SalterSignerOptions {
  code?: string;
  transferable?: boolean;
  path?: string;
  tier?: Tier;
  temp?: boolean;
}

export interface SalterSignersOptions extends SalterSignerOptions {
  count?: number;
  start?: number;
  codes?: string[];
}

/** Encode one KERI salty-derivation path string into bytes for Argon2id input. */
function pathToBytes(path: string): Uint8Array {
  return new TextEncoder().encode(path);
}

/**
 * Map KERI tier/temp policy to Argon2id work factors.
 *
 * `temp=true` keeps the KERIpy testing rule: intentionally cheap stretching
 * for test-only paths, never for normal persisted key derivation.
 */
function tierParams(tier: Tier, temp: boolean): { t: number; m: number } {
  if (temp) {
    return { t: 1, m: 8 };
  }

  if (tier === Tiers.low) return { t: 2, m: 65536 };
  if (tier === Tiers.med) return { t: 3, m: 262144 };
  if (tier === Tiers.high) return { t: 4, m: 1048576 };
  throw new Error(`Unsupported security tier=${tier}`);
}

/**
 * Salt primitive for deterministic secret/signer derivation workflows.
 *
 * KERIpy substance: Salter stores random or fixed salt bytes and is used as
 * input to deterministic signer/seed generation paths.
 *
 * Maintainer model:
 * - `tier` is the default stretch policy carried with the salt instance
 * - individual `stretch()` / `signer()` calls may still override it
 */
export class Salter extends Matter {
  readonly tier: Tier;

  constructor(init: Matter | SalterInit) {
    super(init);
    if (!SALTER_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected salt code, got ${this.code}`);
    }
    this.tier = init instanceof Salter
      ? init.tier
      : (init as SalterInit).tier ?? Tiers.low;
  }

  /** Raw salt bytes used by key-derivation consumers. */
  get salt(): Uint8Array {
    return this.raw;
  }

  /**
   * Derive deterministic secret bytes from this salt and one derivation path.
   *
   * KERIpy correspondence:
   * - mirrors `Salter.stretch(...)` using Argon2id and tier/temp policy
   *
   * Path rule:
   * - callers supply the fully formed KERI salty path string
   * - `Salter` does not impose `pidx/ridx/kidx` structure itself; that remains
   *   a higher-layer manager/creator responsibility
   */
  stretch({
    size = 32,
    path = "",
    tier = this.tier,
    temp = false,
  }: SalterStretchOptions = {}): Uint8Array {
    const params = tierParams(tier, temp);
    return argon2id(pathToBytes(path), this.raw, {
      p: 1,
      t: params.t,
      m: params.m,
      dkLen: size,
      version: 0x13,
    });
  }

  /**
   * Derive one deterministic executable signer from this salt and one path.
   *
   * The signer suite controls seed width; `Salter` only owns the deterministic
   * seed derivation.
   */
  signer({
    code = MtrDex.Ed25519_Seed,
    transferable = true,
    path = "",
    tier,
    temp = false,
  }: SalterSignerOptions = {}): Signer {
    return new Signer({
      code,
      raw: this.stretch({
        size: signerSeedSizeForCode(code),
        path,
        tier,
        temp,
      }),
      transferable,
    });
  }

  /**
   * Derive an ordered signer list from one path prefix plus hex suffix range.
   *
   * KERIpy correspondence:
   * - successive signers append lowercase-hex offsets to the supplied path
   *   prefix
   */
  signers({
    count = 1,
    start = 0,
    path = "",
    code = MtrDex.Ed25519_Seed,
    codes,
    transferable = true,
    tier,
    temp = false,
  }: SalterSignersOptions = {}): Signer[] {
    const effectiveCodes = codes ?? Array.from({ length: count }, () => code);
    return effectiveCodes.map((suite, offset) =>
      this.signer({
        code: suite,
        transferable,
        path: `${path}${(start + offset).toString(16)}`,
        tier,
        temp,
      })
    );
  }
}
