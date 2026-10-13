/** Public ACDC registry database layout and joined LMDB lifecycle. */
import { b, Diger, NumberPrimitive, Saider, SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import { DatabaseNotOpenError, DatabaseOperationError } from "../core/errors.ts";
import { LMDBer, type LMDBerOptions } from "../db/core/lmdber.ts";
import { B64OnIoSetSuber, CatCesrSuber, CesrOnSuber, CesrSuber, SerderSuber } from "../db/subing.ts";

/** Registry paths retain the existing .tufa default and explicit .keri compatibility mode. */
export interface RegBaserOptions extends LMDBerOptions {
  compat?: boolean;
}

/**
 * Own one environment for public registry TEL bodies, accepted ordinals and heads.
 * Mirrors frozen KERIpy RegBaser's typed tables; opening neither verifies
 * evidence nor migrates rows. Absent anchor/escrow tables stay null until an
 * explicit storage write initializes them, preserving readonly old layouts.
 * Construction stays closed; callers own reopen and joined close.
 */
export class RegBaser extends LMDBer {
  /** Event-SAID -> parsed rip/bup body; body presence alone is not acceptance. */
  evts!: SerderSuber<SerderACDC>;
  /** Registry-SAID + ordinal -> accepted event SAID; this is the acceptance marker. */
  tels!: CesrOnSuber<Saider>;
  /** Registry-SAID -> current accepted head SAID; physical heds. is rebuildable from tels. */
  heads!: CesrSuber<Saider>;

  /** Event-SAID -> earliest verified KEL source couple, when this table exists. */
  ancs: CatCesrSuber<[NumberPrimitive, Diger]> | null = null;
  /** Insertion-ordered missing-anchor event-SAID tuples by registry and ordinal. */
  maes: B64OnIoSetSuber<[string]> | null = null;
  /** Insertion-ordered out-of-order event-SAID tuples by registry and ordinal. */
  ooes: B64OnIoSetSuber<[string]> | null = null;

  /** Named databases are root entries; testing presence opens no additional handles. */
  hasTable(name: string): boolean {
    if (!this.env) throw new DatabaseNotOpenError("Registry environment is closed.");
    return this.env.getBinary(b(name)) !== undefined;
  }

  /** Explicit writable initialization; never called by opening or reading a store. */
  initializeStorage(): void {
    if (this.readonly) throw new DatabaseOperationError("Cannot initialize readonly registry storage.");
    this.ancs ??= new CatCesrSuber(this, { subkey: "ancs.", ctor: [NumberPrimitive, Diger] });
    this.maes ??= new B64OnIoSetSuber(this, { subkey: "maes." });
    this.ooes ??= new B64OnIoSetSuber(this, { subkey: "ooes." });
  }

  constructor(options: RegBaserOptions = {}) {
    super(options, {
      tailDirPath: "keri/acdc/reg",
      cleanTailDirPath: "keri/clean/acdc/reg",
      altTailDirPath: options.compat ? ".keri/acdc/reg" : ".tufa/acdc/reg",
      altCleanTailDirPath: options.compat ? ".keri/clean/acdc/reg" : ".tufa/clean/acdc/reg",
      tempPrefix: "keri_acdc_reg_",
    });
  }

  /** Rebind the same environment's typed tables after every joined reopen. */
  override *reopen(options: Partial<RegBaserOptions> = {}): Operation<boolean> {
    const opened = yield* super.reopen(options);
    if (!opened) return false;
    try {
      this.evts = new SerderSuber(this, { subkey: "evts.", ctor: SerderACDC });
      this.tels = new CesrOnSuber(this, { subkey: "tels.", ctor: Saider });
      this.heads = new CesrSuber(this, { subkey: "heds.", ctor: Saider });
      this.ancs = this.hasTable("ancs.")
        ? new CatCesrSuber(this, { subkey: "ancs.", ctor: [NumberPrimitive, Diger] })
        : null;
      this.maes = this.hasTable("maes.") ? new B64OnIoSetSuber(this, { subkey: "maes." }) : null;
      this.ooes = this.hasTable("ooes.") ? new B64OnIoSetSuber(this, { subkey: "ooes." }) : null;
      return true;
    } catch (error) {
      yield* this.close();
      throw error;
    }
  }
}
