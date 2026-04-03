import { argon2id } from "npm:@noble/hashes@1.8.0/argon2";
import { UnknownCodeError } from "../core/errors.ts";
import { MtrDex } from "./codex.ts";
import { SALTER_CODES } from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";
import { signerSeedSizeForCode } from "./signature-suite.ts";
import { Signer } from "./signer.ts";

export interface SalterInit extends MatterInit {
  tier?: string;
}

export interface SalterStretchOptions {
  size?: number;
  path?: string;
  tier?: string;
  temp?: boolean;
}

export interface SalterSignerOptions {
  code?: string;
  transferable?: boolean;
  path?: string;
  tier?: string;
  temp?: boolean;
}

export interface SalterSignersOptions extends SalterSignerOptions {
  count?: number;
  start?: number;
  codes?: string[];
}

function pathToBytes(path: string): Uint8Array {
  return new TextEncoder().encode(path);
}

function tierParams(tier: string, temp: boolean): { t: number; m: number } {
  if (temp) {
    return { t: 1, m: 8 };
  }

  if (tier === "low") return { t: 2, m: 65536 };
  if (tier === "med") return { t: 3, m: 262144 };
  if (tier === "high") return { t: 4, m: 1048576 };
  throw new Error(`Unsupported security tier=${tier}`);
}

/**
 * Salt primitive for deterministic secret/signer derivation workflows.
 *
 * KERIpy substance: Salter stores random or fixed salt bytes and is used as
 * input to deterministic signer/seed generation paths.
 */
export class Salter extends Matter {
  readonly tier: string;

  constructor(init: Matter | SalterInit) {
    super(init);
    if (!SALTER_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected salt code, got ${this.code}`);
    }
    this.tier = init instanceof Salter
      ? init.tier
      : (init as SalterInit).tier ?? "low";
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

  /** Derive one deterministic executable signer from this salt and one path. */
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

  /** Derive an ordered signer list from one path prefix plus hex suffix range. */
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
