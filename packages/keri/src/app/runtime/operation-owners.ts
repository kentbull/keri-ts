/**
 * Composition and loop of the runtime's operations owners.
 *
 * With `ipexOwners: "per-identifier"` the runtime owns one `IssuanceOperations`, one
 * `PresentationOperations` and one `UnblindingOperations` over in-memory stores (an
 * embedder supplies durable stores through `AgentRuntimeOptions.operationStores`), and,
 * when it has a registry root owner, one `RootReplicator`. `runAgentRuntime` runs each
 * owner's `processOnce` in its own fiber, so one stuck delivery cannot stall another
 * owner or any other runtime loop. The owners act only for operations a user began or
 * copies already owed; an idle pass is a few empty map walks every
 * {@link OWNER_LOOP_MS} and creates no per-pass allocation beyond the timer.
 *
 * The root replicator is a runtime reaction and is on unless
 * `operationStores.rootReplication` is `"off"`. CLI commands that send copies build their
 * own replicator (scan off) and never set `ipexOwners`, so they do not double-send.
 */
import { action, type Operation, spawn, suspend } from "npm:effection@^3.6.0";
import { type DerivedUpdateStore, MemoryDerivedUpdateStore } from "../../acdc/custody.ts";
import type { Regery } from "../../acdc/registraring.ts";
import type { RegistryRoot } from "../../acdc/salting.ts";
import { MemoryRootLedger, type RootLedger, RootReplicator } from "../credentials/root-replicator.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import {
  type IssuanceDeps,
  IssuanceOperations,
  type IssuanceOperationStore,
  MemoryIssuanceOperationStore,
  posterDelivery,
} from "../ipex/issuance.ts";
import {
  MemoryPresentationOperationStore,
  PresentationOperations,
  type PresentationOperationStore,
} from "../ipex/presenting.ts";
import {
  MemoryUnblindingOperationStore,
  UnblindingOperations,
  type UnblindingOperationStore,
} from "../ipex/unblinding-workflow.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import type { Receiptor } from "../witness/receipting.ts";
import type { IpexAuxiliaries } from "./ipex-auxiliaries.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import type { ChangeSink } from "./workflow-contract.ts";

/** Milliseconds between idle passes of each owner, the cadence of the CLI drivers these replace. */
export const OWNER_LOOP_MS = 50;

/** Embedder-supplied stores and policy; every field is optional and defaults to a process-local value. */
export interface OperationStores {
  issuance?: IssuanceOperationStore;
  presentation?: PresentationOperationStore;
  unblinding?: UnblindingOperationStore;
  /** Non-secret blind-derivation coordinates for issuance. */
  derived?: DerivedUpdateStore;
  /** Owed root copies and examined rotations. */
  rootLedger?: RootLedger;
  /** Receives identity-only changes after commit; defaults to the runtime's Signaler when it has one. */
  changes?: ChangeSink;
  /** `"off"` leaves root copies to the commands that send them. Default `"runtime"`. */
  rootReplication?: "runtime" | "off";
}

/** The operations owners of one runtime, additive on `AgentRuntime.operations`. */
export interface RuntimeOperations {
  readonly issuance: IssuanceOperations;
  readonly presentation: PresentationOperations;
  readonly unblinding: UnblindingOperations;
}

/** What the runtime composes for `ipexOwners`. */
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
  changes?: ChangeSink;
}

/** Construct the owners over in-memory stores unless the embedder supplied its own. */
export function composeOwners(parts: OwnerParts, stores: OperationStores = {}): ComposedOwners {
  const { hby, acdc, exc, protocol, reactor, postman, receiptor, ipex, clock, registryRoot } = parts;
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
    store: stores.issuance ?? new MemoryIssuanceOperationStore(),
    derived: stores.derived ?? new MemoryDerivedUpdateStore(),
    clock,
    changes,
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
      store: stores.presentation ?? new MemoryPresentationOperationStore(),
      clock,
      derived: issuance.derived,
      changes,
    }),
    unblinding: new UnblindingOperations({
      hby,
      exc,
      unblinds: ipex,
      delivery,
      store: stores.unblinding ?? new MemoryUnblindingOperationStore(),
      clock,
      changes,
    }),
  };
  const rootReplicator = registryRoot && stores.rootReplication !== "off"
    ? new RootReplicator({
      root: registryRoot,
      postman,
      clock,
      ledger: stores.rootLedger ?? new MemoryRootLedger(),
      changes,
    })
    : null;
  return { operations, rootReplicator };
}

/** Sleep on the host clock so cancellation releases the timer. */
function* idle(clock: RuntimeClock): Operation<void> {
  yield* action<void>((resolve) => {
    const timer = clock.setTimeout(resolve, OWNER_LOOP_MS);
    return () => clock.clearTimeout(timer);
  });
}

function* every(clock: RuntimeClock, pass: () => Operation<unknown>): Operation<void> {
  while (true) {
    yield* pass();
    yield* idle(clock);
  }
}

/**
 * Run every owner in its own fiber until halted. The replicator's fiber first makes sure every local
 * identifier has its DH owner, drains their `replicated` cues into the ledger, then runs a pass with
 * its rotation scan on.
 */
export function* operationOwnersDo(
  owners: ComposedOwners & { ipex: IpexAuxiliaries; clock: RuntimeClock },
): Operation<void> {
  const { operations, rootReplicator, ipex, clock } = owners;
  const fibers = [
    yield* spawn(() => every(clock, () => operations.issuance.processOnce())),
    yield* spawn(() => every(clock, () => operations.presentation.processOnce())),
    yield* spawn(() => every(clock, () => operations.unblinding.processOnce())),
  ];
  if (rootReplicator) {
    fibers.push(
      yield* spawn(() =>
        every(clock, function*() {
          ipex.ensureDhkes();
          for (const dh of ipex.dhkeOwners()) {
            while (dh.replicated.length) rootReplicator.replicate(dh.replicated.pull()!);
          }
          yield* rootReplicator.processOnce();
        })
      ),
    );
  }
  try {
    yield* suspend();
  } finally {
    for (const fiber of fibers.reverse()) yield* fiber.halt();
  }
}
