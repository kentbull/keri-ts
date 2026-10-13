/** Public ACDC registry database layout and joined LMDB lifecycle. */
import { Saider, SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import { LMDBer, type LMDBerOptions } from "../db/core/lmdber.ts";
import { CesrOnSuber, CesrSuber, SerderSuber } from "../db/subing.ts";

/** Registry paths retain the existing .tufa default and explicit .keri compatibility mode. */
export interface RegBaserOptions extends LMDBerOptions {
  compat?: boolean;
}

/**
 * Own one environment for public registry TEL bodies, accepted ordinals and heads.
 * Mirrors frozen KERIpy RegBaser's existing evts/tels/heads bindings; opening
 * neither verifies evidence nor migrates rows. Anchor/escrow tables follow
 * separately so old three-table stores remain readable in readonly mode.
 * Construction stays closed; callers own reopen and joined close.
 */
export class RegBaser extends LMDBer {
  /** Event-SAID -> parsed rip/bup body; body presence alone is not acceptance. */
  evts!: SerderSuber<SerderACDC>;
  /** Registry-SAID + ordinal -> accepted event SAID; this is the acceptance marker. */
  tels!: CesrOnSuber<Saider>;
  /** Registry-SAID -> current accepted head SAID; physical heds. is rebuildable from tels. */
  heads!: CesrSuber<Saider>;

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
      return true;
    } catch (error) {
      yield* this.close();
      throw error;
    }
  }
}
