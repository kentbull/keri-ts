import type { Versionage } from "cesr-ts";
import { RawRecord } from "../core/records.ts";

/** Constant-size provenance and reconstruction metadata for one exchange. */
export interface ExchangeRecordShape {
  /** Hosted endpoint that received this message, retained across signature escrow. */
  mailboxAid: string | null;
  /** First qualified receiver receipt, distinct from the signed message timestamp. */
  receiverTime?: string;
  /** Owned qualified ESSR archive and its original replay genus. */
  essr?: { gvrsn: Versionage };
}

/** Private metadata; the ordinary KERIpy exchange tables retain their wire schema. */
export class ExchangeRecord extends RawRecord<ExchangeRecordShape> implements ExchangeRecordShape {
  /** Local mailbox context explicitly retained for delayed verification and dispatch. */
  declare mailboxAid: string | null;
  /** Retained through proof escrow/reopen and subsequent accepted duplicates. */
  declare receiverTime?: string;
  /** Owned ciphertext archive provenance. */
  declare essr?: ExchangeRecordShape["essr"];
}

/** Durable boundary between an authenticated SCS header and its inner stream. */
export interface PlaintextRecordShape {
  /** Byte length of the authenticated SCS header and padding. */
  offset: number;
}

/** Offset of the inner CESR stream within an authenticated plaintext object. */
export class PlaintextRecord extends RawRecord<PlaintextRecordShape> implements PlaintextRecordShape {
  /** Reopening the body skips this many bytes without collecting plaintext. */
  declare offset: number;
}
