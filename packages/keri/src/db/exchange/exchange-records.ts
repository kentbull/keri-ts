import type { Versionage } from "cesr-ts";
import { RawRecord } from "../../core/records.ts";

/** Constant-size provenance and reconstruction metadata for one exchange. */
export interface ExchangeRecordShape {
  /** Hosted endpoint that received this message, retained across signature escrow. */
  mailboxAid: string | null;
  /** First qualified receiver receipt, distinct from the signed message timestamp. */
  receiverTime?: string;
  /** Attachment genus needed to reconstruct the received exchange wire. */
  gvrsn?: Versionage;
  /** Imported as retained history from a finite local stream, without KRAM; absent for live intake. */
  retained?: true;
}

/** Private metadata; the ordinary KERIpy exchange tables retain their wire schema. */
export class ExchangeRecord extends RawRecord<ExchangeRecordShape> implements ExchangeRecordShape {
  /** Local mailbox context explicitly retained for delayed verification and dispatch. */
  declare mailboxAid: string | null;
  /** Retained through proof escrow/reopen and subsequent accepted duplicates. */
  declare receiverTime?: string;
  /** Original attachment genus, independent of a non-native body version. */
  declare gvrsn?: Versionage;
  /** Retained history: no KRAM window was opened for it here, and its handlers raise nothing to act on. */
  declare retained?: true;
}

/** Latest registry observation authenticated by a successful accepted Grant verification. */
export interface ExchangeRegistryStateShape {
  regid: string;
  said: string;
  /** Exact safe storage ordinal, matching Python's integer record field. */
  sn: number;
  state: string | null;
  stamp: string | null;
}

/** Python exrs.; keys are (Grant SAID, node SAID), never a credential-validity index. */
export class ExchangeRegistryStateRecord extends RawRecord<ExchangeRegistryStateShape>
  implements ExchangeRegistryStateShape
{
  declare regid: string;
  declare said: string;
  declare sn: number;
  declare state: string | null;
  declare stamp: string | null;
}
