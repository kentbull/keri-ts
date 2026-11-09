/** Public ACDC registry database layout and joined LMDB lifecycle. */
import { b, Diger, NumberPrimitive, Saider, SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import type { StoreIdentity } from "../db/core/dber.ts";
import type { LMDBerOptions } from "../db/core/lmdber.ts";
import { type StoreFamily, StoreOwner } from "../db/core/store-owner.ts";
import { B64OnIoSetSuber, BytesSuber, CatCesrSuber, CesrOnSuber, CesrSuber, SerderSuber } from "../db/subing.ts";

/** Registry paths retain the existing .tufa default and explicit .keri compatibility mode. */
export interface RegBaserOptions extends LMDBerOptions {
  compat?: boolean;
}

/**
 * Own one environment for public registry TEL bodies, accepted ordinals and heads.
 * Mirrors frozen KERIpy RegBaser's typed tables; opening neither verifies
 * evidence nor migrates rows. Every current store has anchor and escrow tables.
 * Construction stays closed; callers own reopen and joined close.
 */
export class RegBaser extends StoreOwner {
  /** Placement of this store kind. */
  static readonly Family: StoreFamily = { tail: "acdc/reg" };

  /** Event-SAID -> parsed rip/bup body; body presence alone is not acceptance. */
  evts!: SerderSuber<SerderACDC>;
  /** Registry-SAID + ordinal -> accepted event SAID; this is the acceptance marker. */
  tels!: CesrOnSuber<Saider>;
  /** Registry-SAID -> current accepted head SAID; physical heds. is rebuildable from tels. */
  heads!: CesrSuber<Saider>;
  /** Event-SAID -> one deliberately published counted BSQ/BSS opening; never private custody. */
  openings!: BytesSuber;

  /** Event-SAID -> earliest verified KEL source couple, in the current store. */
  ancs!: CatCesrSuber<[NumberPrimitive, Diger]>;
  /** Insertion-ordered missing-anchor event-SAID tuples by registry and ordinal. */
  maes!: B64OnIoSetSuber<[string]>;
  /** Insertion-ordered out-of-order event-SAID tuples by registry and ordinal. */
  ooes!: B64OnIoSetSuber<[string]>;

  /** Rebind the same environment's typed tables after every joined reopen. */
  *reopen(options: StoreIdentity = {}): Operation<boolean> {
    const opened = yield* this.store.reopen(options);
    if (!opened) return false;
    try {
      this.evts = new SerderSuber(this.store, { subkey: "evts.", ctor: SerderACDC });
      this.tels = new CesrOnSuber(this.store, { subkey: "tels.", ctor: Saider });
      this.heads = new CesrSuber(this.store, { subkey: "heds.", ctor: Saider });
      this.openings = new BytesSuber(this.store, { subkey: "openings." });
      this.ancs = new CatCesrSuber(this.store, { subkey: "ancs.", ctor: [NumberPrimitive, Diger] });
      this.maes = new B64OnIoSetSuber(this.store, { subkey: "maes." });
      this.ooes = new B64OnIoSetSuber(this.store, { subkey: "ooes." });
      return true;
    } catch (error) {
      yield* this.close();
      throw error;
    }
  }
}
