/** Completed configured-source observations; protocol acceptance remains in native stores. */
import type { Operation } from "effection";
import { Komer, LMDBer, type LMDBerOptions } from "keri-ts/db";
import { DatabaseNotOpenError, RawRecord } from "keri-ts/runtime";

/** Local completed-pull time and exact returned accepted heads for one configured URL. */
export interface Observation {
  completed: string;
  heads: Record<string, string>;
}
/** Ordinary application record, with no evidence or validation ledger. */
export class ObservationRecord extends RawRecord<Observation> implements Observation {
  declare completed: string;
  declare heads: Record<string, string>;
}
/** Caller-owned source observations, physically separate from public registry evidence. */
export class ObservationBaser extends LMDBer {
  observations!: Komer<ObservationRecord>;
  constructor(options: LMDBerOptions = {}) {
    super(options, {
      tailDirPath: "keri/observer",
      cleanTailDirPath: "keri/clean/observer",
      altTailDirPath: ".tufa/observer",
      altCleanTailDirPath: ".tufa/clean/observer",
      tempPrefix: "keri_observer_",
    });
  }
  /** Rebind the unchanged URL-keyed observation records after joined reopen. */
  override *reopen(options: Partial<LMDBerOptions> = {}): Operation<boolean> {
    if (!(yield* super.reopen(options))) return false;
    try {
      this.observations = new Komer(this, { subkey: "observations.", recordClass: ObservationRecord });
      return true;
    } catch (error) {
      yield* this.close();
      throw error;
    }
  }
}
/** Open only the application's required observation environment. */
export function* createObservationBaser(options: LMDBerOptions = {}): Operation<ObservationBaser> {
  const db = new ObservationBaser(options);
  if (!(yield* db.reopen())) throw new DatabaseNotOpenError("Observation environment could not open.");
  return db;
}
