/** Durable legacy TEL publication progress, separate from observer acceptance. */
import { Diger, NumberPrimitive, NumDex, Prefixer, Saider, Seqner, type SerderKERI, Verfer } from "cesr-ts";
import { DatabaseOperationError, ValidationError } from "../core/errors.ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";
import { telAnchorMatches } from "./tel-anchor.ts";

/** Exact immutable event/anchor coordinates for one finite receipt or publication attempt. */
export interface TelPublicationTarget {
  pre: string;
  sn: number;
  said: string;
  issuer: string;
  anchorSn: number;
  anchorSaid: string;
  witnesses: readonly string[];
}

/** Encode Python's fixed-width Seqner key, independent of the event body's number encoding. */
function ordinal(sn: number): Seqner {
  if (!Number.isSafeInteger(sn) || sn < 0) throw new RangeError("Invalid TEL publication ordinal");
  const raw = new Uint8Array(16);
  let value = BigInt(sn);
  for (let index = raw.length - 1; index >= 0; index--) {
    raw[index] = Number(value & 255n);
    value >>= 8n;
  }
  return new Seqner({ code: NumDex.Huge, raw });
}

type Anchor = [Prefixer, NumberPrimitive, Diger];

/**
 * Own tmse -> tpwe -> tede -> ctel using KERIpy's existing Reger tables.
 * Accepted issuer anchors, full witness collection and completed local transport
 * are distinct gates. ctel stores the issuer anchor SAID, as in KERIpy, and never
 * claims remote TEL acceptance. No network work occurs inside a writer.
 */
export class TelPublication {
  /** Borrow accepted KEL authority and the issuer's existing TEL environment. */
  constructor(readonly db: Baser, readonly reger: Reger) {}

  /** Retain the original anchor even while group signatures or TEL dependencies are missing. */
  track(event: SerderKERI, anchor: SerderKERI): void {
    if (
      !event.pre || event.sn === null || !event.said || !anchor.pre || anchor.sn === null || !anchor.said
      || !telAnchorMatches(anchor.pre, event, anchor)
    ) {
      throw new ValidationError("TEL publication requires the exact issuer anchor and TEL seal.");
    }
    const keys = [event.pre, ordinal(event.sn).qb64, event.said];
    const seal: Anchor = [
      new Prefixer({ qb64: anchor.pre }),
      new NumberPrimitive({ code: NumDex.Huge, raw: ordinal(anchor.sn).raw }),
      new Diger({ qb64: anchor.said }),
    ];
    const coordinates = keys.slice(0, 2);
    const sameAnchor = (stored: readonly { qb64: string }[]) =>
      stored.every((value, index) => value.qb64 === seal[index].qb64);
    if (
      !this.complete(event.pre, event.sn)
      && !this.reger.tpwe.get(coordinates).some(sameAnchor)
      && !this.reger.tede.get(coordinates).some(sameAnchor)
    ) {
      this.reger.tmse.add(keys, seal);
    }
    this.advance();
  }

  /** Move accepted anchors forward; empty witness/publication cohorts need no I/O. */
  advance(): void {
    this.reger.env!.transactionSync(() => {
      for (const [keys, seal] of [...this.reger.tmse.getTopItemIter()]) {
        const target = this.target(keys, seal);
        if (!target || target.said !== keys[2]) continue;
        this.reger.tpwe.add(keys.slice(0, 2), seal);
        this.reger.tmse.rem(keys, seal);
      }
      for (const target of this.pendingReceipts()) {
        if (target.witnesses.length === 0) this.receipted(target);
      }
      for (const target of this.pendingPublications()) {
        if (target.witnesses.length === 0) this.published(target);
      }
    });
  }

  /** Snapshot accepted anchors awaiting an actual complete receipt/fanout attempt. */
  pendingReceipts(): TelPublicationTarget[] {
    return [...this.reger.tpwe.getTopItemIter()].flatMap(([keys, seal]) => {
      const target = this.target(keys, seal);
      return target ? [target] : [];
    });
  }

  /** Commit receipt completion only after the I/O owner returned and all unique proofs still verify. */
  receipted(target: TelPublicationTarget): void {
    if (!this.allReceipts(target)) throw new ValidationError("TEL anchor is missing required witness receipts.");
    const seal = this.seal(target);
    this.reger.env!.transactionSync(() => {
      this.reger.tede.add(this.keys(target), [seal[0], seal[1], new Saider({ qb64: target.anchorSaid })]);
      this.reger.tpwe.rem(this.keys(target), seal);
    });
  }

  /** Accepted TEL replay becomes eligible only after the anchor's receipt obligation finished. */
  pendingPublications(): TelPublicationTarget[] {
    return [...this.reger.tede.getTopItemIter()].flatMap(([keys, seal]) => {
      const target = this.target(keys, [seal[0], seal[1], new Diger({ qb64: seal[2].qb64 })]);
      return target && this.reger.tels.getOn(target.pre, target.sn)?.qb64 === target.said ? [target] : [];
    });
  }

  /** Record finished local publication; an interrupted attempt leaves its ordinary dissemination escrow. */
  published(target: TelPublicationTarget): void {
    if (!this.allReceipts(target) || this.reger.tels.getOn(target.pre, target.sn)?.qb64 !== target.said) {
      throw new ValidationError("TEL publication dependencies changed before completion.");
    }
    const seal = this.seal(target);
    this.reger.env!.transactionSync(() => {
      this.reger.ctel.pin(this.keys(target), new Saider({ qb64: target.anchorSaid }));
      this.reger.tede.rem(this.keys(target), [seal[0], seal[1], new Saider({ qb64: target.anchorSaid })]);
    });
  }

  /** Completion is durable local dissemination, not merely accepted TEL storage or peer acknowledgement. */
  complete(pre: string, sn = 0): boolean {
    return this.reger.ctel.get([pre, ordinal(sn).qb64]) !== null;
  }

  /** Reverify by unique roster index; multiple signatures from one witness never fill another's slot. */
  private allReceipts(target: TelPublicationTarget): boolean {
    const current = this.target(this.keys(target), this.seal(target));
    if (!current || current.said !== target.said) return false;
    const anchor = this.db.getEvtSerder(target.issuer, target.anchorSaid);
    if (!anchor || this.db.kels.getLast(target.issuer, target.anchorSn) !== target.anchorSaid) return false;
    const witnesses = this.db.acceptedEventWitnesses(anchor);
    if (
      !witnesses || witnesses.length !== target.witnesses.length
      || witnesses.some((witness, index) => witness !== target.witnesses[index])
    ) return false;
    const indices = new Set<number>();
    for (const signature of this.db.wigs.get(dgKey(target.issuer, target.anchorSaid))) {
      const witness = witnesses[signature.index];
      if (witness && new Verfer({ qb64: witness }).verify(signature.raw, anchor.raw)) indices.add(signature.index);
    }
    return indices.size === witnesses.length;
  }

  /** Resolve the signed TEL seal from the exact accepted historical issuer event. */
  private target(keys: string[], seal: Anchor): TelPublicationTarget | null {
    const [prefixer, sner, diger] = seal;
    if (sner.num > BigInt(Number.MAX_SAFE_INTEGER)) throw new DatabaseOperationError("Unsafe TEL anchor ordinal");
    const anchorSn = Number(sner.num);
    if (this.db.kels.getLast(prefixer.qb64, anchorSn) !== diger.qb64) return null;
    const anchor = this.db.getEvtSerder(prefixer.qb64, diger.qb64);
    if (!anchor) throw new DatabaseOperationError("Accepted TEL anchor body is missing");
    const sn = Number(new Seqner({ qb64: keys[1] }).sn);
    if (!Number.isSafeInteger(sn) || sn < 0) throw new DatabaseOperationError("Unsafe TEL publication ordinal");
    const seals = anchor.ked?.a;
    const eventSeal: unknown = Array.isArray(seals) && seals.length === 1 ? seals[0] : null;
    if (
      !eventSeal || typeof eventSeal !== "object" || !("i" in eventSeal) || eventSeal.i !== keys[0]
      || !("s" in eventSeal) || eventSeal.s !== sn.toString(16)
      || !("d" in eventSeal) || typeof eventSeal.d !== "string"
    ) {
      throw new DatabaseOperationError("Stored TEL publication does not match its issuer anchor");
    }
    const witnesses = this.db.acceptedEventWitnesses(anchor);
    if (!witnesses) return null;
    return { pre: keys[0], sn, said: eventSeal.d, issuer: prefixer.qb64, anchorSn, anchorSaid: diger.qb64, witnesses };
  }

  /** Reuse the TEL coordinate key across witness, dissemination and completion tables. */
  private keys(target: TelPublicationTarget): string[] {
    return [target.pre, ordinal(target.sn).qb64];
  }

  /** Serialize the same issuer source coordinate in every escrow stage. */
  private seal(target: TelPublicationTarget): Anchor {
    return [
      new Prefixer({ qb64: target.issuer }),
      new NumberPrimitive({ code: NumDex.Huge, raw: ordinal(target.anchorSn).raw }),
      new Diger({ qb64: target.anchorSaid }),
    ];
  }
}
