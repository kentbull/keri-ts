/** Named local v2 registry services; legacy VDR services retain their separate module and owner. */
import type { Diger, NumberPrimitive, Saider, SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import type { Hab, Habery } from "../app/habbing.ts";
import { DatabaseNotOpenError, ValidationError } from "../core/errors.ts";
import { regcept, type RegceptOptions } from "./messaging.ts";
import type { RegBaser } from "./regbasing.ts";
import {
  type RegistryBlindOptions,
  type RegistryBlindResult,
  type RegistryEventDecision,
  RegistryEventer,
} from "./regengine.ts";
import { validateRip } from "./regeventing.ts";
import { openRegistry, type OpenRegistryOptions, RegistryStore } from "./registering.ts";

/** Explicit service acquisition; an injected backing store remains caller-owned. */
export interface RegeryOptions extends OpenRegistryOptions {
  hby: Habery;
  baser?: RegBaser;
}

/** Acquire a named manager, joining owned-store cleanup if opening or alias loading fails. */
export function* createRegery({ hby, baser, ...options }: RegeryOptions): Operation<Regery> {
  const ownsBaser = baser === undefined;
  let delivered = false;
  try {
    if (!baser) {
      baser = yield* openRegistry({
        name: hby.name,
        base: hby.base,
        temp: hby.temp,
        headDirPath: hby.headDirPath,
        compat: hby.compat,
        readonly: hby.readonly,
        ...options,
      });
    }
    const rgy = new Regery(hby, baser, ownsBaser);
    delivered = true;
    return rgy;
  } finally {
    if (!delivered && ownsBaser && baser) yield* baser.close(baser.temp);
  }
}

/**
 * Manage local aliases over one supplied backend. Registry processing borrows
 * public KEL state; controlling habitats are required only by this local facade.
 * Default acquisition transfers store ownership; injection remains borrowed.
 */
export class Regery {
  readonly store: RegistryStore;
  readonly regs = new Map<string, Registry>();
  readonly names = new Map<string, Registry>();

  constructor(readonly hby: Habery, readonly baser: RegBaser, private readonly ownsBaser = false) {
    this.store = new RegistryStore(baser);
    if (baser.opened) this.loadRegistries();
  }

  /** Stage inception and its local alias atomically, publishing in-memory maps only after commit. */
  makeRegistry(name: string, prefix: string, options: RegceptOptions = {}): Registry {
    if (this.hby.readonly || this.baser.readonly) throw new ValidationError("Cannot create a readonly registry.");
    if (this.names.has(name)) throw new ValidationError(`Registry alias already exists: ${name}`);
    const hab = this.hby.habs.get(prefix);
    if (!hab) throw new ValidationError(`Unknown local registry issuer: ${prefix}`);
    const rip = regcept(hab.pre, options);
    if (this.regs.has(rip.said!)) throw new ValidationError(`Registry already exists: ${rip.said}`);
    const env = this.baser.env;
    if (!env) throw new DatabaseNotOpenError("Registry backing store is closed.");
    this.baser.initializeStorage();
    const records = this.store.initializeRecords();
    const registry = new Registry(hab, this.store, name);
    env.transactionSync(() => {
      if (records.get(name)) throw new ValidationError(`Registry alias already exists: ${name}`);
      const result = registry.processEvent(rip);
      if (result.kind === "reject") throw new ValidationError(`Registry inception rejected: ${result.reason}`);
      records.pin(name, { registryKey: rip.said! });
    });
    this.regs.set(rip.said!, registry);
    this.names.set(name, registry);
    return registry;
  }

  /** Reconstruct aliases from their stored inception issuer without modifying durable records. */
  loadRegistries(): void {
    const regs = new Map<string, Registry>(), names = new Map<string, Registry>();
    for (const [keys, record] of this.store.records?.getTopItemIter() ?? []) {
      const name = keys.join("."), rip = this.store.event(record.registryKey);
      const hab = rip?.issuer ? this.hby.habs.get(rip.issuer) : undefined;
      if (!rip || rip.said !== record.registryKey || validateRip(rip).kind !== "valid") {
        throw new Error(`Corrupt registry inception for alias: ${name}`);
      }
      if (!hab) throw new ValidationError(`Unknown local registry issuer: ${rip.issuer}`);
      let registry = regs.get(record.registryKey);
      if (!registry) {
        registry = new Registry(hab, this.store, name, record.registryKey);
        regs.set(record.registryKey, registry);
      }
      names.set(name, registry);
    }
    this.regs.clear();
    this.names.clear();
    for (const [key, value] of regs) this.regs.set(key, value);
    for (const [key, value] of names) this.names.set(key, value);
  }

  /** Resolve one local alias without creating a registry. */
  registryByName(name: string): Registry | null {
    return this.names.get(name) ?? null;
  }
  /** Run explicit retry passes over unique instances, not duplicate aliases. */
  processEscrows(): void {
    for (const registry of this.regs.values()) registry.processEscrows();
  }
  /** Join closure of a manager-owned store; caller-owned injected stores remain open. */
  *close(): Operation<void> {
    if (this.ownsBaser && this.baser.opened) yield* this.baser.close(this.baser.temp);
  }
}

/** Local named facade; the event engine owns validation, anchoring, acceptance and retry. */
export class Registry {
  private readonly eventer: RegistryEventer;

  constructor(readonly hab: Hab, readonly store: RegistryStore, readonly name: string, regk: string | null = null) {
    this.eventer = new RegistryEventer(hab.db, hab.pre, store, regk);
  }
  /** Registry identifier after inception has been staged or accepted. */
  get regk(): string | null {
    return this.eventer.regk;
  }
  /** Accepted head, distinct from a merely staged inception. */
  get head(): Saider | null {
    return this.eventer.head;
  }
  /** Current head digest, or the staged inception identifier before first acceptance. */
  get regd(): string | null {
    return this.head?.qb64 ?? this.regk;
  }
  /** Accepted TEL ordinal; no accepted event is represented by -1n. */
  get sn(): bigint {
    return this.eventer.sn;
  }
  /** Accepted inception, never merely an event-body row. */
  get regser(): SerderACDC | null {
    return this.eventer.regser;
  }
  /** Create and stage a pure inception for this local issuer. */
  make(options: RegceptOptions = {}): SerderACDC {
    const rip = regcept(this.hab.pre, options), result = this.processEvent(rip);
    if (result.kind === "reject") throw new ValidationError(`Registry inception rejected: ${result.reason}`);
    return rip;
  }
  /** Derive a disclosure and stage its commitment after checking credential membership. */
  blind(acdc: SerderACDC, state: string, options: RegistryBlindOptions = {}): RegistryBlindResult {
    return this.eventer.blind(acdc, state, options);
  }
  /** Process parsed TEL evidence through the shared typed engine. */
  processEvent(serder: SerderACDC): RegistryEventDecision {
    return this.eventer.processEvent(serder);
  }
  /** Validate a stored event's explicit or discoverable KEL anchor. */
  anchorMsg(said: string, number?: NumberPrimitive, diger?: Diger): RegistryEventDecision {
    return this.eventer.anchorMsg(said, number, diger);
  }
  /** Retry both missing-anchor and ordering prerequisites. */
  processEscrows(): void {
    this.eventer.processEscrows();
  }
}
