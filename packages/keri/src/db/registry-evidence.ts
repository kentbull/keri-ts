/** Durable verifier-side v2 registry evidence; distinct from legacy Reger state. */
import { ResourceLimitError, Saider, SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import { type RegistryEvidence, type RegistryVerification, vetRegistry } from "../acdc/regeventing.ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { CesrOnSuber, CesrSuber, SerderSuber } from "./subing.ts";

/** Parsed, contiguous evidence borrowed by an IPEX verifier. */
export interface RegistryChain {
  rip: SerderACDC;
  updates: readonly SerderACDC[];
}
/** A caller-owned source of previously verified registry chains. */
export interface RegistryEvidenceReader {
  read(regid: string): RegistryChain | null;
}
/** Existing finite item policy applies to a single registry evidence load. */
export interface RegistryEvidenceStoreOptions extends LMDBerOptions {
  compat?: boolean;
  maxEvents?: number;
}

/**
 * Store accepted observer evidence in the frozen RegBaser evts/tels/heds layout.
 * importEvidence verifies the complete merged chain before any durable write.
 * This is not the issuer's local registry engine or an automatic parser route.
 */
export class RegistryEvidenceStore extends LMDBer implements RegistryEvidenceReader {
  private events!: SerderSuber<SerderACDC>;
  private sequence!: CesrOnSuber<Saider>;
  private heads!: CesrSuber<Saider>;
  private readonly maxEvents: number;

  constructor(options: RegistryEvidenceStoreOptions = {}) {
    super(options, {
      tailDirPath: "keri/acdc/reg",
      cleanTailDirPath: "keri/clean/acdc/reg",
      altTailDirPath: options.compat ? ".keri/acdc/reg" : ".tufa/acdc/reg",
      altCleanTailDirPath: options.compat ? ".keri/clean/acdc/reg" : ".tufa/clean/acdc/reg",
      tempPrefix: "keri_acdc_reg_",
    });
    this.maxEvents = options.maxEvents ?? 16384;
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents < 1) {
      throw new RangeError("Registry maxEvents must be a positive safe integer.");
    }
  }

  /** Rebind typed readers after the environment's joined lifecycle opens it. */
  override *reopen(options: Partial<RegistryEvidenceStoreOptions> = {}): Operation<boolean> {
    const opened = yield* super.reopen(options);
    if (!opened) return false;
    try {
      this.events = new SerderSuber(this, { subkey: "evts.", ctor: SerderACDC });
      this.sequence = new CesrOnSuber(this, { subkey: "tels.", ctor: Saider });
      this.heads = new CesrSuber(this, { subkey: "heds.", ctor: Saider });
      return true;
    } catch (error) {
      yield* this.close();
      throw error;
    }
  }

  /** Read a complete accepted chain; corrupt acceptance markers are infrastructure errors. */
  read(regid: string): RegistryChain | null {
    const head = this.heads.get(regid);
    if (!head) return null;
    const event = this.events.get(head.qb64);
    if (!event) throw new DatabaseOperationError("Registry head body is missing.");
    const last = BigInt(`0x${event.sad!.n}`);
    if (last >= BigInt(this.maxEvents)) {
      throw new ResourceLimitError("Registry evidence exceeds configured event limit.");
    }
    const events: SerderACDC[] = [];
    for (let sn = 0; sn <= Number(last); sn++) {
      const said = this.sequence.getOn(regid, sn);
      const item = said ? this.events.get(said.qb64) : null;
      if (!item) throw new DatabaseOperationError("Accepted registry evidence has a missing sequence entry.");
      events.push(item);
    }
    if (events.at(-1)!.said !== head.qb64) throw new DatabaseOperationError("Registry head and sequence disagree.");
    return { rip: events[0], updates: events.slice(1) };
  }

  /** Verify and atomically import supplied observer evidence without downgrading a newer head. */
  importEvidence(
    { rip, updates = [], db, sources }: Pick<RegistryEvidence, "rip" | "updates" | "db" | "sources">,
  ): RegistryVerification {
    if (updates.length >= this.maxEvents) {
      throw new ResourceLimitError("Registry evidence exceeds configured event limit.");
    }
    if (!this.env) throw new DatabaseOperationError("Registry evidence environment is closed.");
    return this.env.transactionSync(() => {
      const existing = rip.said ? this.read(rip.said) : null;
      const merged = [
        ...new Map([...(existing?.updates ?? []), ...updates].map((event) => [event.said, event])).values(),
      ];
      if (merged.length >= this.maxEvents) {
        throw new ResourceLimitError("Registry evidence exceeds configured event limit.");
      }
      const result = vetRegistry({ rip, updates: merged, db, sources });
      if (result.kind !== "verified") return result;
      for (const event of [rip, ...merged]) {
        const said = new Saider({ qb64: event.said! });
        this.events.pin(event.said!, event);
        this.sequence.putOn(result.state.regid, Number(BigInt(`0x${event.sad!.n}`)), said);
      }
      this.heads.pin(result.state.regid, new Saider({ qb64: result.state.said }));
      return result;
    });
  }
}

/** Open an explicitly owned registry evidence store; the runtime must join its close. */
export function* createRegistryEvidenceStore(
  options: RegistryEvidenceStoreOptions = {},
): Operation<RegistryEvidenceStore> {
  const store = new RegistryEvidenceStore(options);
  yield* store.reopen();
  return store;
}
