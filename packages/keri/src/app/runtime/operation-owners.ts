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
import { GroupIpexOperations } from "../ipex/group-ipex.ts";
import type { CredentialViews } from "../ipex/ipex-discloser.ts";
import { type IssuanceDeps, IssuanceOperations, posterDelivery } from "../ipex/issuance.ts";
import { PresentationOperations } from "../ipex/presenting.ts";
import { UnblindingOperations } from "../ipex/unblinding-workflow.ts";
import type { Counselor } from "../multisig/counseling.ts";
import type { Multiplexor } from "../multisig/grouping.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import type { Receiptor } from "../witness/receipting.ts";
import { type DoerPacing, doEvery } from "./doing.ts";
import type { IpexAuxiliaries } from "./ipex-auxiliaries.ts";
import type { RetryPolicy } from "./retry-backoff.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import type { ChangeSink } from "./workflow-contract.ts";

/** Milliseconds between owner passes; the cadence of the CLI drivers the loop replaced. */
export const OWNER_TOCK_MS = 50;
/** Tocks between the replicator's full rotation checks: 1200 tocks of 50 ms is a minute. */
export const OWNER_SWEEP_TOCKS = 1200;
/** The production pacing of the owner loop. */
export const OWNER_PACING: Readonly<DoerPacing> = Object.freeze({
  tockMs: OWNER_TOCK_MS,
  sweepTocks: OWNER_SWEEP_TOCKS,
});

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
  /** The embedder's credential inventory, from which presentation selects issued and held credentials. Without it only replies and `apply` can be presented. */
  views?: CredentialViews;
  /** Receives identity-only changes after commit; defaults to the runtime's Signaler when it has one. */
  changes?: ChangeSink;
}

/** The operations owners of one runtime, additive on `AgentRuntime.operations`. */
export interface RuntimeOperations {
  readonly issuance: IssuanceOperations;
  /** A local group's v2 IPEX messages (its Admit): propose, approve, status, wait. */
  readonly groupIpex: GroupIpexOperations;
  readonly presentation: PresentationOperations;
  readonly unblinding: UnblindingOperations;
  /** What the owner loop could not do; read by a host that reports runtime health. */
  readonly health: OwnerHealth;
}

/** The last failure of an owner pass that no single operation owned, and how many there have been. */
export interface OwnerFault {
  owner: "issuance" | "groupIpex" | "presentation" | "unblinding" | "replicator";
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
  /** Delivery retry delays of the owners; the production policy when absent. */
  retry?: Readonly<RetryPolicy>;
  /** Milliseconds between issuer query resends; one second when absent. */
  queryResendMs?: number;
  changes?: ChangeSink;
}

/** Construct the owners over their in-memory tables; the derivation store defaults to the registry database. */
export function composeOwners(parts: OwnerParts, stores: OperationStores = {}): ComposedOwners {
  const { hby, acdc, exc, protocol, reactor, postman, receiptor, ipex, clock, registryRoot, mux, counselor } = parts;
  const changes = stores.changes ?? parts.changes, delivery = posterDelivery(postman);
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
    retry: parts.retry,
    queryResendMs: parts.queryResendMs,
    group: { mux, registry: { hby, protocol, postman, counselor, registryStore: acdc.store } },
  };
  const operations: RuntimeOperations = {
    issuance: new IssuanceOperations(issuance),
    groupIpex: new GroupIpexOperations({
      hby,
      rgy: acdc,
      exc,
      protocol,
      postman,
      clock,
      registry: { hby, protocol, postman, counselor, registryStore: acdc.store },
      changes,
    }),
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
      views: stores.views,
      retry: parts.retry,
      changes,
    }),
    health: new OwnerHealth(),
    unblinding: new UnblindingOperations({
      hby,
      exc,
      unblinds: ipex,
      group: { mux, protocol },
      delivery,
      reactor,
      clock,
      retry: parts.retry,
      changes,
    }),
  };
  const rootReplicator = registryRoot ? new RootReplicator({ root: registryRoot, postman, clock, changes }) : null;
  return { operations, rootReplicator };
}

/** What the owner loop runs: the owners, the replicator, the DH owners whose completion cues prompt it, the clock. */
export interface OwnerLoopParts extends ComposedOwners {
  ipex: IpexAuxiliaries;
  clock: RuntimeClock;
}

/**
 * Run every owner on one fiber until halted, as a fixed-tock doer (`./doing.ts`): each tock runs an owner that
 * has live work, then the replicator (after prompting it with the live DH owners' `replicated` cues), and then
 * the loop waits one tock. Work begun between tocks is seen on the next one; nothing wakes the loop early.
 *
 * Idle cost, per tock: four constant-time table checks, one in-memory walk of the Unblind owners for an owed
 * reply, one drain of each DH owner's cue deck, and the replicator's emptiness checks. The replicator's
 * rotation check (the establishment SAID of each local group, one keyed read per local identifier) runs on
 * tock 0 and every `pacing.sweepTocks`. No owner reads a protocol store. Only the first pass, once, scans the
 * pending exchange escrow for resumable Grants.
 *
 * A failure that escapes an owner pass is recorded in `operations.health` and the loop keeps running, so
 * one owner's fault never stops the others. The owners run one after another, so a delivery that does not return holds the others up until it fails or
 * its Grant deadline passes; operations already bound each delivery by that deadline.
 */
export function* operationOwnersDo(
  owners: OwnerLoopParts,
  pacing: Readonly<DoerPacing> = OWNER_PACING,
): Operation<never> {
  const { operations, rootReplicator, ipex, clock } = owners, { health } = operations;
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
  return yield* doEvery(clock, pacing.tockMs, function*(tock) {
    if (operations.issuance.active()) yield* guarded("issuance", () => operations.issuance.processOnce());
    if (operations.groupIpex.active()) yield* guarded("groupIpex", () => operations.groupIpex.processOnce());
    if (operations.presentation.active()) yield* guarded("presentation", () => operations.presentation.processOnce());
    if (operations.unblinding.active()) yield* guarded("unblinding", () => operations.unblinding.processOnce());
    if (rootReplicator) {
      yield* guarded("replicator", function*() {
        for (const dh of ipex.dhkeOwners()) {
          while (dh.replicated.length) rootReplicator.replicate(dh.replicated.pull()!);
        }
        if (tock % pacing.sweepTocks === 0) rootReplicator.sweep();
        yield* rootReplicator.processDue();
      });
    }
  });
}
