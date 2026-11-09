/** Allocated watcher identities and their latest verified observation attempts. */
import type { Operation } from "effection";
import { Komer } from "keri-ts/db";
import { LMDBer, type LMDBerOptions } from "keri-ts/db/lmdb";
import { RawRecord } from "keri-ts/runtime";

/** Public resource coordinates; private keys remain in the allocation's Habery. */
export interface WatcherAllocation {
  name: string;
  eid: string;
  cid: string;
}
/** Retained resource identity for exact reopen. */
export class WatcherAllocationRecord extends RawRecord<WatcherAllocation> implements WatcherAllocation {
  declare name: string;
  declare eid: string;
  declare cid: string;
}
export type ObservedState = "even" | "ahead" | "behind" | "duplicitous" | "unresponsive";
/** One actual poll result, never a substitute for accepted KEL or reply evidence. */
export interface WitnessObservation {
  query_timestamp: string;
  response_received: boolean;
  state: ObservedState;
  keystate: Record<string, unknown> | null;
  sn: number | null;
  dig: string | null;
  error: string | null;
}
/** Persist the last attempt separately from the underlying verified KERI records. */
export class WitnessObservationRecord extends RawRecord<WitnessObservation> implements WitnessObservation {
  declare query_timestamp: string;
  declare response_received: boolean;
  declare state: ObservedState;
  declare keystate: Record<string, unknown> | null;
  declare sn: number | null;
  declare dig: string | null;
  declare error: string | null;
}
/** Provider resource index and per-witness observation results. */
export class HostedWatcherBaser extends LMDBer {
  watchers!: Komer<WatcherAllocationRecord>;
  observations!: Komer<WitnessObservationRecord>;
  constructor(options: LMDBerOptions = {}) {
    super(options, {
      tailDirPath: "keri/hosted-watchers",
      cleanTailDirPath: "keri/clean/hosted-watchers",
      altTailDirPath: ".tufa/hosted-watchers",
      altCleanTailDirPath: ".tufa/clean/hosted-watchers",
      tempPrefix: "keri_hosted_watchers_",
    });
  }
  /** Bind the same resource and observation tables on every reopen. */
  override *reopen(options: Partial<LMDBerOptions> = {}): Operation<boolean> {
    if (!(yield* super.reopen(options))) return false;
    this.watchers = new Komer(this, { subkey: "watchers.", recordClass: WatcherAllocationRecord });
    this.observations = new Komer(this, { subkey: "observations.", recordClass: WitnessObservationRecord });
    return true;
  }
}
