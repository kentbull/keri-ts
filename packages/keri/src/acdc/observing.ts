/** Explicit public registry intake; this TypeScript integration is beyond frozen KERIpy 927. */
import { Diger, Ilks, ParserError, type SerderACDC } from "cesr-ts";
import { DatabaseNotOpenError, DatabaseOperationError } from "../core/errors.ts";
import type { Baser } from "../db/basing.ts";
import { type RegistryEventDecision, RegistryEventer } from "./regengine.ts";
import { type RegistryEvent, validateRip, validateUpdate } from "./regeventing.ts";
import type { RegistryStore } from "./registering.ts";

/** An update may arrive before its issuer can be recovered from the inception body. */
export type RegistryObserverDecision =
  | RegistryEventDecision
  | { kind: "escrow"; reason: "inception"; event: RegistryEvent };

/**
 * Borrow accepted public KEL state and one registry store without habitats, aliases or handles.
 * Reconstruct the engine's issuer from stored inception after reopen. Intake uses the engine's
 * full tuple/witness anchor policy, distinct from digest-only observer vetting. Each accepted
 * event commits independently; a later failure preserves the already accepted prefix.
 * Parsed evidence stays borrowed. This installs no automatic parser or runtime route.
 */
export class RegistryObserver {
  constructor(readonly db: Baser, readonly store: RegistryStore) {}

  /** Stage parsed events before inception, otherwise delegate ordinary validation and acceptance. */
  processEvent(serder: SerderACDC): RegistryObserverDecision {
    const result = serder.ilk === Ilks.rip ? validateRip(serder) : validateUpdate(serder, serder.regid ?? "");
    if (result.kind === "reject") return result;
    const event = result.event;
    // Unknown registry routing cannot rely on a stored RIP to validate its qualified SAID.
    try {
      if (new Diger({ qb64: event.regid }).qb64 !== event.regid) return { kind: "reject", reason: "registry" };
    } catch (error) {
      if (!(error instanceof ParserError)) throw error;
      return { kind: "reject", reason: "registry" };
    }
    if (event.sn > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: "reject", reason: "ordinalRange" };
    let engine = this.engine(event.regid);
    if (engine && !(engine instanceof RegistryEventer)) return engine;
    if (event.ilk === Ilks.rip) {
      if (!event.issuer) return { kind: "reject", reason: "issuer" };
      engine ??= new RegistryEventer(this.db, event.issuer, this.store, event.regid);
    }
    if (engine) {
      return engine.processEvent(serder);
    }
    // Issuer/anchor discovery is impossible until RIP arrives; the existing anchor escrow owns this body.
    const baser = this.store.baser;
    if (baser.readonly) throw new DatabaseOperationError("Cannot write readonly registry storage.");
    return baser.env!.transactionSync(() => {
      this.store.putEvent(serder);
      this.store.escrowMissingAnchor(event.regid, Number(event.sn), event.said);
      return { kind: "escrow", reason: "inception", event } as const;
    });
  }

  /** Retry one registry after inception/KEL dependencies arrive; never scan every registry implicitly. */
  processEscrows(regid: string): void {
    const engine = this.engine(regid);
    if (!(engine instanceof RegistryEventer)) return;
    engine.processEscrows();
  }

  /** Stored inception is durable issuer identity, including while its anchor is still absent. */
  private engine(regid: string): RegistryEventer | { kind: "reject"; reason: "registry" } | null {
    if (!this.store.baser.env) throw new DatabaseNotOpenError("Registry observer store is closed.");
    const rip = this.store.event(regid);
    if (!rip) {
      if (this.store.head(regid) || this.store.seqSaider(regid, 0)) {
        throw new Error("Corrupt observer registry inception.");
      }
      return null;
    }
    if (rip.said !== regid) throw new Error("Corrupt observer registry inception.");
    // evts also owns valid BUP bodies; naming one as a registry is remote misuse, not store corruption.
    if (rip.ilk !== Ilks.rip && rip.verify()) return { kind: "reject", reason: "registry" };
    const result = validateRip(rip);
    if (result.kind !== "valid" || result.event.regid !== regid || !result.event.issuer) {
      throw new Error("Corrupt observer registry inception.");
    }
    return new RegistryEventer(this.db, result.event.issuer, this.store, regid);
  }
}
