/**
 * Sally-like verifier communication cue database.
 *
 * These application records remain outside protocol Baser/Reger evidence.
 * ack/rack mark local HTTP success, not business receipts or KERI acknowledgements.
 * This is Sally-inspired workflow state, not a claim of exact Sally storage parity.
 */
import { Dater, Prefixer, SerderACDC } from "cesr-ts";
import { CesrSuber, openOwner, SerderSuber, type StoreFamily, type StoreIdentity, StoreOwner } from "keri-ts/db";
import { lmdbDefaultsFor, LMDBer, type LMDBerOptions } from "keri-ts/db/lmdb";
import { type Operation } from "npm:effection@^3.6.0";

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

/** Durable local workflow records for pending, ready and delivered webhook work. */
export class VerifierCueBaser extends StoreOwner {
  /** Placement of this store kind. */
  static readonly Family: StoreFamily = { tail: "verifier" };

  snd!: CesrSuber<Prefixer>;
  iss!: CesrSuber<Dater>;
  rev!: CesrSuber<Dater>;
  recv!: SerderSuber<SerderACDC>;
  revk!: SerderSuber<SerderACDC>;
  ack!: SerderSuber<SerderACDC>;
  rack!: SerderSuber<SerderACDC>;

  /** Open ordinary LMDB storage and bind this application's typed tables. */
  *reopen(options: StoreIdentity = {}): Operation<boolean> {
    const opened = yield* this.store.reopen(options);
    if (!opened) {
      return false;
    }

    this.snd = new CesrSuber<Prefixer>(this.store, { subkey: "snd.", ctor: Prefixer });
    this.iss = new CesrSuber<Dater>(this.store, { subkey: "iss.", ctor: Dater });
    this.rev = new CesrSuber<Dater>(this.store, { subkey: "rev.", ctor: Dater });
    this.recv = new SerderSuber<SerderACDC>(this.store, { subkey: "recv", ctor: SerderACDC });
    this.revk = new SerderSuber<SerderACDC>(this.store, { subkey: "revk", ctor: SerderACDC });
    this.ack = new SerderSuber<SerderACDC>(this.store, { subkey: "ack", ctor: SerderACDC });
    this.rack = new SerderSuber<SerderACDC>(this.store, { subkey: "rack", ctor: SerderACDC });
    return true;
  }

  /** Clear workflow records, including the existing local delivered markers. */
  clearEscrows(): void {
    this.iss.trim();
    this.rev.trim();
    this.recv.trim();
    this.revk.trim();
    this.ack.trim();
    this.rack.trim();
  }

  /** Snapshot application row counts for command output, never protocol acceptance. */
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
  { compat, ...options }: VerifierCueBaserOptions = {},
): Operation<VerifierCueBaser> {
  const store = new LMDBer(options, lmdbDefaultsFor(VerifierCueBaser.Family, compat));
  return yield* openOwner(new VerifierCueBaser(store), "VerifierCueBaser", options);
}
