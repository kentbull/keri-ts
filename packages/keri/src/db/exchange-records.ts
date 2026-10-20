import type { Versionage } from "cesr-ts";
import { RawRecord } from "../core/records.ts";

/** Constant-size provenance and reconstruction metadata for one exchange. */
export interface ExchangeRecordShape {
  /** Hosted endpoint that received this message, retained across signature escrow. */
  mailboxAid: string | null;
  /** First qualified receiver receipt, distinct from the signed message timestamp. */
  receiverTime?: string;
  /** Attachment genus needed to reconstruct the received exchange wire. */
  gvrsn?: Versionage;
}

/** Private metadata; the ordinary KERIpy exchange tables retain their wire schema. */
export class ExchangeRecord extends RawRecord<ExchangeRecordShape> implements ExchangeRecordShape {
  /** Local mailbox context explicitly retained for delayed verification and dispatch. */
  declare mailboxAid: string | null;
  /** Retained through proof escrow/reopen and subsequent accepted duplicates. */
  declare receiverTime?: string;
  /** Original attachment genus, independent of a non-native body version. */
  declare gvrsn?: Versionage;
}
