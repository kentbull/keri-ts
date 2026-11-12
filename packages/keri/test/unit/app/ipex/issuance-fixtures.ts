/**
 * Two-party fixtures for issuance operations: independent Haberys and registries joined by an in-process
 * delivery that hands bytes to the destination's reactor. No network, mailbox or witness is involved.
 */
import type { SerderACDC } from "cesr-ts";
import { ensure } from "effection";
import { type Operation } from "npm:effection@^3.6.0";
import { RegistryAuthor } from "../../../../src/acdc/authoring.ts";
import { MemoryDerivedUpdateStore } from "../../../../src/acdc/custody.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  type IssuanceDelivery,
  type IssuanceDeps,
  IssuanceOperations,
  type IssuanceOperationStore,
  MemoryIssuanceOperationStore,
} from "../../../../src/app/ipex/issuance.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import type { RuntimeClock } from "../../../../src/app/runtime/runtime-clock.ts";
import type { ChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import type { Receiptor } from "../../../../src/app/witness/receipting.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";

export const KRAM = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } as const;

/**
 * Wall clock that tests can push forward; KRAM and the exchange deadline read it too. Habitats stamp messages
 * with real time, and a KRAM receiver clock may only run ahead of a stamp, so it starts ahead.
 */
export class TestClock implements RuntimeClock {
  skew = 0;
  now(): number {
    return Date.now() + this.skew;
  }
  setTimeout(callback: () => void, ms: number) {
    return setTimeout(callback, ms);
  }
  clearTimeout(timer: unknown) {
    clearTimeout(timer as number);
  }
}

export interface Party {
  hby: Habery;
  rgy: Regery;
  runtime: AgentRuntime;
  receiptor: Receiptor;
  habs: Hab[];
}

/** An unwitnessed habitat has no receipts to collect; `onReceipt` lets a test look at the moment of anchoring. */
export function* party(
  clock: RuntimeClock,
  label: string,
  names: string[],
  onReceipt = () => {},
  register = true,
): Operation<Party> {
  const hby = yield* createHabery({
    name: crypto.randomUUID(),
    temp: true,
    skipConfig: true,
    bran: `${label}PasscodeSecretAB`,
  });
  yield* ensure(() => hby.close(true));
  const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
  yield* ensure(() => baser.close(true));
  const rgy = new Regery(hby, baser);
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), clock, {
    acdc: rgy,
    kram: KRAM,
    ipexOwners: "per-identifier",
  });
  yield* ensure(() => runtime.close());
  const receiptor = {
    hby,
    *receipt(): Operation<void> {
      onReceipt();
    },
  } as unknown as Receiptor;
  const habs = names.map((name) => hby.makeHab(name));
  // A wallet registers its identifiers' DH owners when it opens; a query reaches only an existing owner.
  if (register) for (const hab of habs) runtime.ipex!.dhke(hab);
  return { hby, rgy, runtime, receiptor, habs };
}

export interface Sent {
  src: string;
  dest: string;
  msg: Uint8Array;
}

/** Deliver bytes to whichever party owns `dest`; `fail` makes the transport report failure. */
export function route(parties: Party[], log: Sent[], fail: () => boolean = () => false) {
  return function*(sent: Sent): Operation<string[]> {
    log.push(sent);
    if (fail()) throw new Error("transport failed");
    const to = parties.find((p) => p.habs.some((hab) => hab.pre === sent.dest));
    if (!to) throw new Error(`no route to ${sent.dest}`);
    yield* to.runtime.reactor.processBytes(sent.msg);
    yield* to.runtime.protocol.processEscrowsOnce();
    return [sent.dest];
  };
}

/** Everything a party's DH owners queued, delivered as its holder side would. */
export function* pump(from: Party, deliver: (sent: Sent) => Operation<string[]>): Operation<void> {
  for (const hab of from.habs) {
    const dh = from.runtime.ipex!.dhke(hab);
    while (dh.outgoing.length) {
      const queued = dh.outgoing.pull()!;
      yield* deliver({ src: hab.pre!, dest: queued.dest, msg: queued.msg });
    }
  }
}

export interface Scenario {
  clock: TestClock;
  issuer: Party;
  holder: Party;
  log: Sent[];
  store: IssuanceOperationStore;
  derived: MemoryDerivedUpdateStore;
  changes: { id: string }[];
  /** A fresh owner over the same stores, as after a reload. */
  owner(overrides?: Partial<IssuanceDeps>): IssuanceOperations;
  /** The holder party's owner, with its own operation store and change sink. */
  holderOwner(overrides?: Partial<IssuanceDeps>): IssuanceOperations;
  holderStore: IssuanceOperationStore;
  holderChanges: { id: string }[];
  fail: { on: boolean };
  /** The in-process transport shared by both parties. */
  delivery: IssuanceDelivery["deliver"];
  author: RegistryAuthor;
  /** A fresh registry for issuer hab `index`, and a credential for holder hab `index`. */
  registry(index: number): Operation<{ regid: string; credential: () => SerderACDC }>;
}

/** Issuer with `count` identifiers, holder with `count`, KELs exchanged so each side knows the other. */
export function* scenario(count = 1, onReceipt = () => {}, register = true): Operation<Scenario> {
  const clock = new TestClock();
  const names = Array.from({ length: count }, (_, i) => `n${i}`);
  const issuer = yield* party(clock, "Issuer", names.map((n) => `i${n}`), onReceipt);
  const holder = yield* party(clock, "Holder", names.map((n) => `h${n}`), undefined, register);
  for (const [from, to] of [[issuer, holder], [holder, issuer]] as const) {
    for (const hab of from.habs) {
      for (const wire of from.hby.db.clonePreIter(hab.pre!, 0)) yield* to.runtime.reactor.processBytes(wire);
    }
  }
  const log: Sent[] = [], fail = { on: false }, changes: { id: string }[] = [];
  const store = new MemoryIssuanceOperationStore(), derived = new MemoryDerivedUpdateStore();
  const sink: ChangeSink = { push: ({ id }) => void changes.push({ id }) };
  const holderStore = new MemoryIssuanceOperationStore(), holderChanges: { id: string }[] = [];
  const author = new RegistryAuthor(issuer.rgy, issuer.receiptor);
  const deliver = route([issuer, holder], log, () => fail.on);
  const delivery: IssuanceDelivery = { deliver };
  return {
    clock,
    issuer,
    holder,
    log,
    store,
    derived,
    changes,
    fail,
    delivery: deliver,
    author,
    holderStore,
    holderChanges,
    holderOwner: (overrides = {}) =>
      new IssuanceOperations({
        hby: holder.hby,
        rgy: holder.rgy,
        exc: holder.runtime.exc,
        receiptor: holder.receiptor,
        dhkes: holder.runtime.ipex!,
        reactor: holder.runtime.reactor,
        protocol: holder.runtime.protocol,
        delivery,
        store: holderStore,
        derived: new MemoryDerivedUpdateStore(),
        clock,
        changes: { push: ({ id }) => void holderChanges.push({ id }) },
        ...overrides,
      }),
    owner: (overrides = {}) =>
      new IssuanceOperations({
        hby: issuer.hby,
        rgy: issuer.rgy,
        exc: issuer.runtime.exc,
        receiptor: issuer.receiptor,
        dhkes: issuer.runtime.ipex!,
        reactor: issuer.runtime.reactor,
        protocol: issuer.runtime.protocol,
        delivery,
        store,
        derived,
        clock,
        changes: sink,
        ...overrides,
      }),
    *registry(index) {
      const hab = issuer.habs[index], name = `registry-${index}-${crypto.randomUUID()}`;
      yield* author.incept(name, hab.pre!);
      const reg = author.registry(name, hab.pre!);
      return {
        regid: reg.regk!,
        credential: () =>
          author.create(reg, { issuee: holder.habs[index].pre!, attribute: { name: crypto.randomUUID() } }),
      };
    },
  };
}
