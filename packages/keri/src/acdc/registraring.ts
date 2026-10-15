/** Named local v2 registry services; legacy VDR services retain their separate module and owner. */
import {
  Diger,
  makeBlindState,
  makeBoundState,
  type MakeBoundStateOptions,
  type NumberPrimitive,
  type Saider,
  SerderACDC,
} from "cesr-ts";
import type { Operation } from "effection";
import type { Hab, Habery } from "../app/habbing.ts";
import { DatabaseNotOpenError, ValidationError } from "../core/errors.ts";
import { blindate, type BlindateOptions, regcept, type RegceptOptions } from "./messaging.ts";
import type { RegBaser } from "./regbasing.ts";
import { type RegistryEventDecision, RegistryEventer } from "./regengine.ts";
import { type RegistryDisclosure, type RegistryEvent, validateRip, validateUpdate } from "./regeventing.ts";
import { openRegistry, type OpenRegistryOptions, RegistryStore } from "./registering.ts";
import { FailedSchemaValidationError, MissingSchemaError, validateSchema } from "./scheming.ts";

/** Disclosure derivation and wire options; the local facade selects the next ordinal and blinder. */
export type RegistryBlindOptions =
  & Omit<BlindateOptions, "sn">
  & Pick<MakeBoundStateOptions, "raw" | "salt" | "tier" | "bsn" | "bd">
  & { bound?: boolean };
/** Grant serders and bare SAIDs share syntax checks; presentation construction does not authenticate grants. */
export type RegistryPresentationTarget = string | { readonly said: string | null };
/** A disclosure and its staged commitment, neither of which establishes anchored acceptance. */
export type RegistryBlindResult = readonly [RegistryDisclosure, SerderACDC];

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
  /** Validate credential membership and issuer before deriving its next blinded registry update. */
  blind(acdc: SerderACDC, state: string, options: RegistryBlindOptions = {}): RegistryBlindResult {
    if (!(acdc instanceof SerderACDC) || !acdc.verify()) {
      throw new ValidationError("Registry blinding requires a self-verifying ACDC.");
    }
    if (acdc.regid !== this.regk) throw new ValidationError("Credential belongs to another registry.");
    if (acdc.issuer !== this.hab.pre) throw new ValidationError("Credential belongs to another issuer.");
    const schema = validateSchema(acdc, this.hab.db);
    if (schema.kind === "missing") throw new MissingSchemaError(schema.said);
    if (schema.kind === "invalid") throw new FailedSchemaValidationError(schema.reason);
    return this.blindTarget(acdc.said!, state, options);
  }

  /** Process parsed TEL evidence through the shared typed engine. */
  processEvent(serder: SerderACDC): RegistryEventDecision {
    return this.eventer.processEvent(serder);
  }
  /** Validate a stored event's explicit or discoverable KEL anchor. */
  anchorMsg(said: string, number?: NumberPrimitive, diger?: Diger): RegistryEventDecision {
    return this.eventer.anchorMsg(said, number, diger);
  }
  /** Commit a grant SAID without requiring the grant's issuer to control this presentation registry. */
  present(
    grant: RegistryPresentationTarget,
    state = "presented",
    options: RegistryBlindOptions = {},
  ): RegistryBlindResult {
    const target = typeof grant === "string" ? grant : grant.said;
    try {
      new Diger({ qb64: target ?? "" });
    } catch (cause) {
      throw new ValidationError("Presentation target must be a valid grant SAID.", { cause });
    }
    return this.blindTarget(target!, state, options);
  }

  /** Empty target/state disclose a vacuous step; downstream verification retains the preceding binding. */
  vacate(options: RegistryBlindOptions = {}): RegistryBlindResult {
    return this.blindTarget("", "", options);
  }

  /** Derive and stage a validated target; presentation/vacuous callers own their target checks. */
  private blindTarget(target: string, state: string, options: RegistryBlindOptions): RegistryBlindResult {
    const tip = this.effectiveFrontier();
    if (!tip) throw new ValidationError("Registry must be anchored before updates.");
    if ("blinder" in options) throw new ValidationError("Caller-supplied blinder overrides are unsupported.");
    const sn = tip.sn + 1n;
    if (sn > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Unsafe registry update ordinal.");
    const { raw, salt, tier, bound, bsn, bd, ...wire } = options;
    const inputs = { raw, salt, tier, sn, acdc: target, state };
    const blinder = bound ? makeBoundState({ ...inputs, bsn, bd }) : makeBlindState(inputs);
    const serder = blindate(tip.regid, tip.said, blinder.d.nonce, { ...wire, sn });
    const decision = this.processEvent(serder);
    if (decision.kind === "reject") throw new ValidationError(`Registry update rejected: ${decision.reason}`);
    return [blinder, serder];
  }

  /** Extend an accepted head through exactly one staged successor at each ordinal, without mutation. */
  private effectiveFrontier(): RegistryEvent | null {
    let tip = this.eventer.acceptedHeadEvent;
    while (tip) {
      const sn = tip.sn + 1n;
      if (sn > BigInt(Number.MAX_SAFE_INTEGER)) return tip;
      const saids = new Set<string>();
      for (const escrow of [this.store.baser.maes, this.store.baser.ooes]) {
        for (const [said] of escrow?.get(tip.regid, Number(sn)) ?? []) saids.add(said);
      }
      let successor: RegistryEvent | null = null;
      for (const said of saids) {
        const body = this.store.event(said);
        if (!body) continue;
        if (body.said !== said) throw new Error("Corrupt staged registry event.");
        const result = validateUpdate(body, tip.regid);
        if (result.kind !== "valid" || result.event.sn !== sn || result.event.prior !== tip.said) continue;
        if (successor) throw new ValidationError("Registry has conflicting staged successors.");
        successor = result.event;
      }
      if (!successor) return tip;
      tip = successor;
    }
    return null;
  }

  /** Retry both missing-anchor and ordering prerequisites. */
  processEscrows(): void {
    this.eventer.processEscrows();
  }
}

/** Caller-facing v2 operations over a borrowed Regery; this facade acquires no keys, stores or runtime service. */
export class Registrar {
  constructor(readonly rgy: Regery) {}

  /** Accept instances directly; registry keys take precedence over local aliases, as in frozen KERIpy. */
  private registry(reference: Registry | string): Registry {
    if (reference instanceof Registry) return reference;
    const registry = this.rgy.regs.get(reference) ?? this.rgy.registryByName(reference);
    if (!registry) throw new ValidationError(`Unknown registry: ${reference}`);
    return registry;
  }
  /** Create one named registry through the manager's existing atomic inception/alias workflow. */
  makeRegistry(name: string, prefix: string, options: RegceptOptions = {}): Registry {
    return this.rgy.makeRegistry(name, prefix, options);
  }
  /** Stage a credential binding, requiring its issuer and registry to match the resolved Registry. */
  issue(
    reference: Registry | string,
    acdc: SerderACDC,
    state = "issued",
    options: RegistryBlindOptions = {},
  ): RegistryBlindResult {
    return this.registry(reference).blind(acdc, state, options);
  }
  /** Bind a grant SAID through a registry instance, key or alias. */
  present(
    reference: Registry | string,
    grant: RegistryPresentationTarget,
    state = "presented",
    options: RegistryBlindOptions = {},
  ): RegistryBlindResult {
    return this.registry(reference).present(grant, state, options);
  }
  /** Append a vacuous state disclosure through the resolved registry. */
  vacate(reference: Registry | string, options: RegistryBlindOptions = {}): RegistryBlindResult {
    return this.registry(reference).vacate(options);
  }
}
