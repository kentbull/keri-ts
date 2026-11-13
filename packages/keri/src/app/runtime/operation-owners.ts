/**
 * Composition and loop of the runtime's operations owners.
 *
 * The runtime owns one `IssuanceOperations`, one
 * `PresentationOperations` and one `UnblindingOperations`, each an in-memory live table
 * with status derived from the protocol stores, and,
 * when it has a registry root owner, one `RootReplicator`. `runAgentRuntime` runs each
 * owner's `processOnce` on one fiber with an adaptive cadence ({@link operationOwnersDo}). The owners
 * act only for operations a user began or copies already owed.
 *
 * The root replicator is a runtime reaction. It derives what is owed from state and records
 * sent copies in the Baser (`rrsn.`), so a CLI command that sends copies through its own
 * replicator shares that record with the loop and a later pass does not repeat its sends.
 */
import { action, type Operation } from "npm:effection@^3.6.0";
import { BaserDerivedUpdateStore, type DerivedUpdateStore } from "../../acdc/custody.ts";
import type { Regery } from "../../acdc/registraring.ts";
import type { RegistryRoot } from "../../acdc/salting.ts";
import { RootReplicator } from "../credentials/root-replicator.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import { type IssuanceDeps, IssuanceOperations, posterDelivery } from "../ipex/issuance.ts";
import { PresentationOperations } from "../ipex/presenting.ts";
import { UnblindingOperations } from "../ipex/unblinding-workflow.ts";
import type { Counselor } from "../multisig/counseling.ts";
import type { Multiplexor } from "../multisig/grouping.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import type { Receiptor } from "../witness/receipting.ts";
import type { IpexAuxiliaries } from "./ipex-auxiliaries.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import type { ChangeSink } from "./workflow-contract.ts";

/** Milliseconds between passes while an owner has live work or the replicator has copies owed, the cadence of the CLI drivers these replace. */
export const OWNER_BUSY_MS = 50;
/** Milliseconds between passes when nothing is live or owed; a user beginning work wakes the loop at once. */
export const OWNER_IDLE_MS = 1000;

/**
 * What an embedder may supply; every field is optional. The operation tables are in memory and their status is
 * derived from the protocol stores, so there is no store port for them.
 */
export interface OperationStores {
  /**
   * Non-secret blind-derivation coordinates for issuance and derived presentation. Defaults to
   * {@link BaserDerivedUpdateStore} over the registry environment's database, which is durable wherever the
   * registry store is; a wallet with its own table supplies that instead.
   */
  derived?: DerivedUpdateStore;
  /** Receives identity-only changes after commit; defaults to the runtime's Signaler when it has one. */
  changes?: ChangeSink;
}

/** The operations owners of one runtime, additive on `AgentRuntime.operations`. */
export interface RuntimeOperations {
  readonly issuance: IssuanceOperations;
  readonly presentation: PresentationOperations;
  readonly unblinding: UnblindingOperations;
  /** Wakes the owner loop ({@link operationOwnersDo}) from its idle sleep; the owners call it themselves. */
  readonly wake: OwnerWake;
  /** What the owner loop could not do; read by a host that reports runtime health. */
  readonly health: OwnerHealth;
}

/** The last failure of an owner pass that no single operation owned, and how many there have been. */
export interface OwnerFault {
  owner: "issuance" | "presentation" | "unblinding" | "replicator";
  error: string;
  /** ISO 8601 time of the failure on the host clock. */
  at: string;
}

/**
 * Failures of the owner loop itself. A failure of one operation (a delivery that throws, an unreadable stored
 * Grant) ends that operation as `failed` and is never recorded here; this records only what escaped an owner
 * pass, which the loop survives so that the other owners keep running. `faults` counts them and `last` keeps
 * the latest. Nothing clears it: a host reads it and decides.
 */
export class OwnerHealth {
  faults = 0;
  last: OwnerFault | null = null;
}

/** What the runtime composes for its operations owners. */
export interface ComposedOwners {
  operations: RuntimeOperations;
  rootReplicator: RootReplicator | null;
}

/** The runtime pieces the owners borrow; no AgentRuntime bundle. */
export interface OwnerParts {
  hby: Habery;
  acdc: Regery;
  exc: Exchanger;
  protocol: ProtocolProcessor;
  reactor: Reactor;
  postman: Poster;
  receiptor: Receiptor;
  ipex: IpexAuxiliaries;
  clock: RuntimeClock;
  registryRoot: RegistryRoot | null;
  /** Delegates the DH wrappers of group issuance; one owner per runtime registers. */
  mux: Multiplexor;
  /** Counsels the group anchor of a custodian's registry update. */
  counselor: Counselor;
  changes?: ChangeSink;
}

/** Construct the owners over their in-memory tables; the derivation store defaults to the registry database. */
export function composeOwners(parts: OwnerParts, stores: OperationStores = {}): ComposedOwners {
  const { hby, acdc, exc, protocol, reactor, postman, receiptor, ipex, clock, registryRoot, mux, counselor } = parts;
  const changes = stores.changes ?? parts.changes, delivery = posterDelivery(postman);
  const wake = new OwnerWake();
  const issuance: IssuanceDeps = {
    hby,
    rgy: acdc,
    exc,
    receiptor,
    dhkes: ipex,
    reactor,
    protocol,
    delivery,
    derived: stores.derived ?? new BaserDerivedUpdateStore(acdc.store.baser),
    clock,
    changes,
    wake: wake.notify,
    group: { mux, registry: { hby, protocol, postman, counselor, registryStore: acdc.store } },
  };
  const operations: RuntimeOperations = {
    issuance: new IssuanceOperations(issuance),
    presentation: new PresentationOperations({
      hby,
      rgy: acdc,
      exc,
      receiptor,
      reactor,
      protocol,
      delivery,
      clock,
      derived: issuance.derived,
      changes,
      wake: wake.notify,
    }),
    wake,
    health: new OwnerHealth(),
    unblinding: new UnblindingOperations({
      hby,
      exc,
      unblinds: ipex,
      delivery,
      clock,
      changes,
      wake: wake.notify,
    }),
  };
  const rootReplicator = registryRoot ? new RootReplicator({ root: registryRoot, postman, clock, changes }) : null;
  return { operations, rootReplicator };
}

/**
 * Lets the owner loop sleep long while idle and still react at once when a user begins work: the owners call
 * {@link OwnerWake.notify} as an operation becomes live, which ends the current sleep. A notification that
 * arrives while a pass is running makes the next sleep return immediately, so none is lost.
 */
export class OwnerWake {
  #resolve: (() => void) | null = null;
  #pending = false;

  /** End the current sleep, or the next one if none is running. */
  readonly notify = (): void => {
    if (this.#resolve) this.#resolve();
    else this.#pending = true;
  };

  /** Sleep on the host clock for at most `ms`; cancellation releases the timer. */
  *sleep(clock: RuntimeClock, ms: number): Operation<void> {
    if (this.#pending) {
      this.#pending = false;
      return;
    }
    try {
      yield* action<void>((resolve) => {
        this.#resolve = resolve;
        const timer = clock.setTimeout(resolve, ms);
        return () => clock.clearTimeout(timer);
      });
    } finally {
      this.#resolve = null;
    }
  }
}

/** Whether any owner has live work or the replicator has copies still owed. */
function working({ operations, rootReplicator }: Pick<ComposedOwners, "operations" | "rootReplicator">): boolean {
  return operations.issuance.active() || operations.presentation.active() || operations.unblinding.active()
    || !!rootReplicator?.pending();
}

/**
 * Run every owner on one fiber until halted. A pass runs an owner only if it has live work, then the
 * replicator (after prompting it with the live DH owners' `replicated` cues), and the loop sleeps
 * {@link OWNER_BUSY_MS} while anything is working and {@link OWNER_IDLE_MS} otherwise, or less when an owner
 * wakes it.
 *
 * Idle cost, per {@link OWNER_IDLE_MS}: three constant-time table checks, one in-memory walk of the Unblind
 * owners for an owed reply, one drain of each DH owner's cue deck, and the replicator's rotation check
 * (the establishment SAID of each local group, one keyed read per local identifier to tell groups apart).
 * No owner reads a protocol store. Only the first pass, once, scans the pending exchange escrow for
 * resumable Grants.
 *
 * A failure that escapes an owner pass is recorded in `operations.health` and the loop keeps running, so
 * one owner's fault never stops the others. The owners run one after another, so a delivery that does not return holds the others up until it fails or
 * its Grant deadline passes; operations already bound each delivery by that deadline.
 */
export function* operationOwnersDo(
  owners: ComposedOwners & { ipex: IpexAuxiliaries; clock: RuntimeClock },
  { busyMs = OWNER_BUSY_MS, idleMs = OWNER_IDLE_MS }: { busyMs?: number; idleMs?: number } = {},
): Operation<void> {
  const { operations, rootReplicator, ipex, clock } = owners, { wake, health } = operations;
  const guarded = function*(owner: OwnerFault["owner"], pass: () => Operation<unknown>): Operation<void> {
    try {
      yield* pass();
    } catch (error) {
      health.faults++;
      health.last = {
        owner,
        error: error instanceof Error ? error.message : String(error),
        at: new Date(clock.now()).toISOString(),
      };
    }
  };
  while (true) {
    if (operations.issuance.active()) yield* guarded("issuance", () => operations.issuance.processOnce());
    if (operations.presentation.active()) yield* guarded("presentation", () => operations.presentation.processOnce());
    if (operations.unblinding.active()) yield* guarded("unblinding", () => operations.unblinding.processOnce());
    if (rootReplicator) {
      yield* guarded("replicator", function*() {
        for (const dh of ipex.dhkeOwners()) {
          while (dh.replicated.length) rootReplicator.replicate(dh.replicated.pull()!);
        }
        yield* rootReplicator.processOnce();
      });
    }
    yield* wake.sleep(clock, working(owners) ? busyMs : idleMs);
  }
}
