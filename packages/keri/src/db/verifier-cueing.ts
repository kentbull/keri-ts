/**
 * Sally-like verifier communication cue database.
 *
 * This sidecar intentionally stays outside the KERIpy `Reger` namespace. The
 * VDR stores remain byte-compatible with KERIpy, while verifier webhook retry
 * and ack state lives in this operational database.
 */
import { type Operation } from "npm:effection@^3.6.0";
import { Dater, Prefixer, SerderACDC } from "../../../cesr/mod.ts";
import { DatabaseNotOpenError } from "../core/errors.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { CesrSuber, SerderSuber } from "./subing.ts";

/** Options for opening the verifier cue sidecar. */
export interface VerifierCueBaserOptions extends LMDBerOptions {
  compat?: boolean;
}

/** Counts of queued verifier communication work. */
export interface VerifierCueCounts {
  senders: number;
  iss: number;
  rev: number;
  recv: number;
  revk: number;
  ack: number;
  rack: number;
}

/** Durable cue DB matching Sally's `CueBaser` store layout. */
export class VerifierCueBaser extends LMDBer {
  snd!: CesrSuber<Prefixer>;
  iss!: CesrSuber<Dater>;
  rev!: CesrSuber<Dater>;
  recv!: SerderSuber<SerderACDC>;
  revk!: SerderSuber<SerderACDC>;
  ack!: SerderSuber<SerderACDC>;
  rack!: SerderSuber<SerderACDC>;

  static override readonly TailDirPath = "keri/verifier";
  static override readonly AltTailDirPath = ".tufa/verifier";
  static readonly CompatAltTailDirPath = ".keri/verifier";
  static override readonly TempPrefix = "keri_verifier_";

  constructor(options: VerifierCueBaserOptions = {}) {
    const compat = options.compat ?? false;
    super(options, {
      tailDirPath: VerifierCueBaser.TailDirPath,
      cleanTailDirPath: "keri/clean/verifier",
      altTailDirPath: compat ? VerifierCueBaser.CompatAltTailDirPath : VerifierCueBaser.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/verifier" : ".tufa/clean/verifier",
      tempPrefix: VerifierCueBaser.TempPrefix,
    });
  }

  override *reopen(options: VerifierCueBaserOptions = {}): Operation<boolean> {
    const opened = yield* super.reopen(options);
    if (!opened) {
      return false;
    }

    this.snd = new CesrSuber<Prefixer>(this, { subkey: "snd.", ctor: Prefixer });
    this.iss = new CesrSuber<Dater>(this, { subkey: "iss.", ctor: Dater });
    this.rev = new CesrSuber<Dater>(this, { subkey: "rev.", ctor: Dater });
    this.recv = new SerderSuber<SerderACDC>(this, { subkey: "recv", ctor: SerderACDC });
    this.revk = new SerderSuber<SerderACDC>(this, { subkey: "revk", ctor: SerderACDC });
    this.ack = new SerderSuber<SerderACDC>(this, { subkey: "ack", ctor: SerderACDC });
    this.rack = new SerderSuber<SerderACDC>(this, { subkey: "rack", ctor: SerderACDC });
    return true;
  }

  clearEscrows(): void {
    this.iss.trim();
    this.rev.trim();
    this.recv.trim();
    this.revk.trim();
    this.ack.trim();
    this.rack.trim();
  }

  getCounts(): VerifierCueCounts {
    return {
      senders: this.snd.cntAll(),
      iss: this.iss.cntAll(),
      rev: this.rev.cntAll(),
      recv: this.recv.cntAll(),
      revk: this.revk.cntAll(),
      ack: this.ack.cntAll(),
      rack: this.rack.cntAll(),
    };
  }
}

/** Open a verifier cue sidecar and return the ready-to-use databaser. */
export function* createVerifierCueBaser(
  options: VerifierCueBaserOptions = {},
): Operation<VerifierCueBaser> {
  const cdb = new VerifierCueBaser(options);
  const opened = yield* cdb.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open VerifierCueBaser");
  }
  return cdb;
}
