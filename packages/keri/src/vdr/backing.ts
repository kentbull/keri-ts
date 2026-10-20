/** Local TEL backer endorsement; transport and observer acceptance remain separate owners. */
import { Diger, Ilks, SerderKERI, Siger, Verfer } from "cesr-ts";
import type { Hab } from "../app/habbing.ts";
import { DatabaseOperationError, ValidationError } from "../core/errors.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";
import { resolveBackerState } from "./backer-state.ts";
import { verifyTelAnchor } from "./tel-anchor.ts";

/** Committed eligible event coordinates; received proofs distinguish input from escrow's durable union. */
export interface BackerRequest {
  pre: string;
  said: string;
  received: readonly Siger[];
}

/** A concrete contribution is ready for transport only after its local endorsement transaction commits. */
export type BackerResult =
  | { kind: "skip" }
  | { kind: "reject"; reason: string }
  | { kind: "contribution"; issuer: string; signature: Siger; message: Uint8Array };

/**
 * Endorse validated TEL evidence as one explicitly selected nontransferable identifier.
 *
 * KERIpy defines the receipt wire but has no autonomous backer service. This owner
 * adds only a durable one-digest choice per local signer/event coordinate. It does
 * not accept the TEL, transmit, promise delivery, or persist a delivery queue.
 */
export class Backer {
  /** Bind the actual signer and existing TEL store; never select a habitat implicitly. */
  constructor(readonly hab: Hab, readonly reger: Reger) {
    if (
      !hab.kever || hab.kever.transferable || hab.kever.verfers.length !== 1 || hab.kever.verfers[0].qb64 !== hab.pre
    ) {
      throw new ValidationError("TEL backers require an explicit nontransferable single-key habitat.");
    }
  }

  /**
   * Recheck committed eligibility and anchor, persist the endorsement, then return ordinary replay bytes.
   * An explicit duplicate lacking our receipt resends it; escrow retries already carrying it do not.
   * A crash after commit and before delivery requires explicit re-delivery, not a durable outbox.
   */
  endorse(request: BackerRequest): BackerResult {
    if (this.reger.inWriteTransaction) throw new Error("Backer must own its endorsement transaction");
    const result = this.reger.env!.transactionSync(() => {
      const key = dgKey(request.pre, request.said), raw = this.reger.tvts.get(key);
      if (!raw) return { kind: "skip" } as const;
      const event = new SerderKERI({ raw });
      if (event.pre !== request.pre || event.said !== request.said || event.sn === null) {
        throw new DatabaseOperationError("Backer request does not match its stored TEL body.");
      }
      if (![Ilks.vcp, Ilks.vrt, Ilks.bis, Ilks.brv].some((ilk) => ilk === event.ilk)) return { kind: "skip" } as const;
      const accepted = this.reger.tels.getOn(request.pre, event.sn);
      if (accepted && accepted.qb64 !== request.said) {
        return { kind: "reject", reason: "TEL coordinate already accepts another event." } as const;
      }
      if (!accepted && !this.reger.twes.getOn(request.pre, event.sn).includes(request.said)) {
        return { kind: "skip" } as const;
      }
      const management = event.ilk === Ilks.vcp || event.ilk === Ilks.vrt;
      const ra = event.ked?.ra;
      let regk: unknown = request.pre;
      if (!management) regk = ra && typeof ra === "object" && "i" in ra ? ra.i : undefined;
      if (typeof regk !== "string") throw new DatabaseOperationError("Eligible backed event has no registry.");
      const issuer = event.ilk === Ilks.vcp ? event.ked?.ii : this.reger.states.get(regk)?.ii;
      if (typeof issuer !== "string") throw new DatabaseOperationError("Eligible backed event has no issuer.");
      const source = this.reger.ancs.get(key);
      if (!source || !verifyTelAnchor(this.hab.db, issuer, event, ...source)) return { kind: "skip" } as const;
      let roster: string[];
      if (management) {
        // Partial-witness rows are written only after validating the proposed management roster and issuer anchor.
        roster = this.reger.baks.get(key);
      } else {
        const state = resolveBackerState(this.reger, regk, event.ked?.ra);
        if (state.kind !== "backers") return { kind: "skip" } as const;
        roster = state.baks;
      }
      const index = roster.indexOf(this.hab.pre);
      if (index < 0) return { kind: "skip" } as const;
      const coordinate = [this.hab.pre, request.pre];
      const choice = this.reger.bens.getOn(coordinate, event.sn);
      if (choice && choice.qb64 !== request.said) {
        return { kind: "reject", reason: "Backer already endorsed another event at this coordinate." } as const;
      }
      const verfer = new Verfer({ qb64: this.hab.pre });
      let signature = this.reger.tibs.get(key).find((sig) => sig.index === index && verfer.verify(sig.raw, event.raw));
      if (choice && !signature) {
        throw new DatabaseOperationError("Durable backer choice has no valid stored contribution.");
      }
      if (!signature) {
        const signed = this.hab.sign(event.raw, true)[0];
        signature = new Siger({ code: signed.code, raw: signed.raw, index });
        this.reger.tibs.put(key, [signature]);
      }
      if (!choice) this.reger.bens.putOn(coordinate, event.sn, new Diger({ qb64: request.said }));
      if (request.received.some((sig) => sig.qb64 === signature.qb64)) return { kind: "skip" } as const;
      return { kind: "ready", issuer, signature } as const;
    });
    if (result.kind !== "ready") return result;
    return {
      kind: "contribution",
      issuer: result.issuer,
      signature: result.signature,
      message: this.reger.cloneTvt(request.pre, request.said),
    };
  }
}
