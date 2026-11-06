/** Service-owned witness allocations; protocol facts remain in each witness's own Habery. */
import type { Operation } from "effection";
import { Komer, LMDBer, type LMDBerOptions } from "keri-ts/db";
import { RawRecord } from "keri-ts/runtime";

/** One allocated witness and its plaintext base32 registration TOTP secret. */
export interface WitnessAllocation {
  name: string;
  eid: string;
  cid: string;
  code: string | null;
}

/** Persist only resource identity and the registration secret (encrypted only in transit). */
export class WitnessAllocationRecord extends RawRecord<WitnessAllocation> implements WitnessAllocation {
  declare name: string;
  declare eid: string;
  declare cid: string;
  declare code: string | null;
}

/** Index allocated witnesses without sharing their KELs, keys or mailboxes. */
export class HostedWitnessBaser extends LMDBer {
  witnesses!: Komer<WitnessAllocationRecord>;

  constructor(options: LMDBerOptions = {}) {
    super(options, {
      tailDirPath: "keri/hosted-witnesses",
      cleanTailDirPath: "keri/clean/hosted-witnesses",
      altTailDirPath: ".tufa/hosted-witnesses",
      altCleanTailDirPath: ".tufa/clean/hosted-witnesses",
      tempPrefix: "keri_hosted_witnesses_",
    });
  }

  /** Rebind the resource index after opening its environment. */
  override *reopen(options: Partial<LMDBerOptions> = {}): Operation<boolean> {
    if (!(yield* super.reopen(options))) return false;
    this.witnesses = new Komer(this, { subkey: "witnesses.", recordClass: WitnessAllocationRecord });
    return true;
  }
}
