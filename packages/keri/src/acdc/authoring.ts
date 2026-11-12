/**
 * Finite ACDC v2 registry authoring: stage, anchor and update protocol cores.
 *
 * Existing engines own acceptance and receipt authentication; this class only
 * sequences them for one local individual issuer. It reads and writes no
 * credential inventory: embedders that keep issued or held records wrap it
 * (the wallet's `WalletAuthor` adds `issue` and `revoke`). Private derivation
 * requires a `RegistryCustody`, whose coordinate store the embedder supplies.
 */
import { bytesEqual, makeBlindState, type SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import { isLocalGroupHab } from "../app/multisig/group-members.ts";
import type { Receiptor, WitnessAuthMap } from "../app/witness/receipting.ts";
import { ValidationError } from "../core/errors.ts";
import type { RegistryCustody } from "./custody.ts";
import { acdcmap, type AcdcMapOptions, blindate } from "./messaging.ts";
import { matchesRegistrySeal, type RegistryDisclosure } from "./regeventing.ts";
import type { Regery, Registry } from "./registraring.ts";
import { validateSchema as validateAcdcSchema } from "./scheming.ts";

/** Public means deliberate opening publication; private derivation requires supplied custody. */
export interface AcdcV2UpdateOptions {
  public?: boolean;
  stamp?: string;
  boundEvent?: string;
  /** Transient witness codes for this operation; never retained with registry evidence. */
  auths?: WitnessAuthMap;
}

/** Borrow the actual registry environment and receipt collector; acquire no handles or workers. */
export class RegistryAuthor {
  constructor(
    readonly rgy: Regery,
    readonly receiptor: Receiptor,
    readonly custody?: RegistryCustody,
  ) {
    if (receiptor.hby !== rgy.hby) {
      throw new ValidationError("Authoring requires the registry environment's actual receipt owner.");
    }
    if (custody && (custody.options.hby !== rgy.hby || custody.options.registry.baser !== rgy.baser)) {
      throw new ValidationError("Authoring custody must use this registry environment's actual owners.");
    }
  }

  /** Resolve the actual local registry; staging supports groups while signing methods enforce their owner. */
  registry(name: string, controller: string): Registry {
    const registry = this.rgy.registryByName(name);
    if (!registry || registry.hab.pre !== controller) {
      throw new ValidationError("Unknown registry or different controller.");
    }
    return registry;
  }

  /** Signing belongs either to this individual owner or to explicit group approval, never a staging flag. */
  protected individual(reg: Registry): void {
    if (isLocalGroupHab(this.rgy.hby, reg.hab)) {
      throw new ValidationError("ACDC v2 group authoring requires member approval.");
    }
  }

  /** Idempotently stage an alias, then return only its exact accepted inception. */
  *incept(name: string, controller: string, auths?: WitnessAuthMap): Operation<SerderACDC> {
    const hab = this.rgy.hby.habs.get(controller);
    if (!hab || isLocalGroupHab(this.rgy.hby, hab)) {
      throw new ValidationError("ACDC v2 inception requires a local individual controller.");
    }
    const reg = this.rgy.registryByName(name) ?? this.rgy.makeRegistry(name, controller);
    this.registry(name, controller);
    const event = reg.store.event(reg.regk!)!;
    yield* this.anchor(reg, event, auths);
    return event;
  }

  /** Construct the issuer's credential using the existing ACDC v2 finite builder. */
  create(reg: Registry, options: Omit<AcdcMapOptions, "regid">): SerderACDC {
    this.registry(reg.name, reg.hab.pre);
    return acdcmap(reg.hab.pre, { ...options, regid: reg.regk });
  }

  /** Stage one BUP state advance, preserving an exact pending retry and its opening. Never author historical upd. */
  stage(
    reg: Registry,
    acdc: SerderACDC,
    state: string,
    options: AcdcV2UpdateOptions = {},
  ): { event: SerderACDC; opening: RegistryDisclosure } {
    return this.stageState(reg, acdc, state, options);
  }

  /** Share validation and exact pending-next reuse; only the concrete revocation ensure operation can reuse an accepted head. */
  protected stageState(
    reg: Registry,
    acdc: SerderACDC,
    state: string,
    options: AcdcV2UpdateOptions,
    ensureRevoked = false,
  ): { event: SerderACDC; opening: RegistryDisclosure } {
    this.registry(reg.name, acdc.issuer!);
    if (!acdc.verify() || acdc.regid !== reg.regk) {
      throw new ValidationError("Credential does not match this registry.");
    }
    const schema = validateAcdcSchema(acdc, this.rgy.hby.db);
    if (schema.kind !== "valid") {
      throw new ValidationError(schema.kind === "missing" ? `Missing ACDC schema: ${schema.said}` : schema.reason);
    }
    const head = reg.store.headEvent(reg.regk!);
    if (!head || head.ilk === "upd") throw new ValidationError("An accepted ACDC v2 registry head is required.");
    if (options.public && options.boundEvent) {
      throw new ValidationError("Public opening cannot use private bound coordinates.");
    }
    if (!options.public && !this.custody) {
      throw new ValidationError("Derived authoring requires provisioned registry custody.");
    }
    if (!options.public && this.custody!.options.hab !== reg.hab) {
      throw new ValidationError("Derived authoring requires the registry habitat's custody.");
    }
    const sn = Number(BigInt(`0x${head.sad!.n}`));
    if (!Number.isSafeInteger(sn + 1)) throw new ValidationError("Registry ordinal is not representable.");
    let bound: { bsn: number; bd: string } | undefined;
    if (options.boundEvent) {
      const issuee = acdc.issuee, db = this.rgy.hby.db;
      const event = issuee ? db.getEvtSerder(issuee, options.boundEvent) : null;
      if (
        !event || event.sn === null || !Number.isSafeInteger(event.sn)
        || db.kels.getLast(issuee!, event.sn) !== event.said || !db.fullyWitnessed(event)
      ) {
        throw new ValidationError("Bound update requires an exact accepted witnessed Issuee event.");
      }
      bound = { bsn: event.sn, bd: event.said! };
    }
    const derive = (ordinal: number) =>
      options.public
        ? makeBlindState({ sn: ordinal, acdc: acdc.said!, state })
        : this.custody!.derive(reg.regk!, ordinal, acdc.said!, state, bound ? { bound: true, ...bound } : {});
    const matches = (event: SerderACDC, opening: RegistryDisclosure) =>
      event.ilk === "bup" && event.sad!.b === opening.d.nonce && opening.td.nonce === acdc.said
      && opening.ts.label === state;
    const pending = [...reg.store.baser.evts.getTopItemIter()].map(([, event]) => event).filter((event) =>
      event.regid === reg.regk && event.sad!.n === (sn + 1).toString(16)
    );
    if (pending.length) {
      const event = pending[0], opening = options.public ? reg.store.publicOpening(event.said!) : derive(sn + 1);
      if (pending.length !== 1 || !opening || !matches(event, opening) || event.sad!.p !== head.said) {
        throw new ValidationError("Registry has a different pending update.");
      }
      if (!options.public) this.custody!.retainDerivedUpdate(event, opening);
      return { event, opening };
    }
    if (ensureRevoked && sn && head.ilk === "bup") {
      const published = reg.store.publicOpening(head.said!);
      const opening = options.public ? published : derive(sn);
      if (opening && matches(head, opening) && (!options.public || published)) {
        if (!options.public) this.custody!.retainDerivedUpdate(head, opening);
        return { event: head, opening };
      }
    }
    if (bound && this.rgy.hby.db.getKever(acdc.issuee!)?.serder.said !== bound.bd) {
      throw new ValidationError("New bound update must reference the known current Issuee event.");
    }
    const opening = derive(sn + 1),
      event = blindate(reg.regk!, head.said!, opening.d.nonce, { sn: sn + 1, stamp: options.stamp });
    if (!options.public) this.custody!.retainDerivedUpdate(event, opening);
    reg.store.baser.transaction(() => {
      reg.store.putEvent(event);
      if (options.public) reg.store.retainOpening(event, opening);
      const decision = reg.processEvent(event);
      if (decision.kind === "reject") throw new ValidationError(`Registry update rejected: ${decision.reason}`);
    });
    return { event, opening };
  }

  /** Advance one explicit state through real anchoring; staging is never reported as accepted. */
  *update(
    reg: Registry,
    acdc: SerderACDC,
    state: string,
    options: AcdcV2UpdateOptions = {},
  ): Operation<SerderACDC> {
    this.individual(reg);
    const { event } = this.stage(reg, acdc, state, options);
    yield* this.anchor(reg, event, options.auths);
    return event;
  }

  /** Reuse the current branch's already signed seal even before receipts; no extra anchor merely to poll. */
  *anchor(reg: Registry, event: SerderACDC, auths?: WitnessAuthMap): Operation<void> {
    this.registry(reg.name, reg.hab.pre);
    this.individual(reg);
    const ordinal = Number(BigInt(`0x${event.sad!.n}`));
    const accepted = reg.store.seqEvent(reg.regk!, ordinal);
    if (accepted && bytesEqual(accepted.raw, event.raw)) return;
    const hab = reg.hab;
    let current = hab.kever!.serder, anchor = null;
    while (current) {
      if (current.seals.some((seal) => matchesRegistrySeal(seal, event))) anchor = current;
      const prior = current.prior ? hab.db.getEvtSerder(hab.pre, current.prior) : null;
      if (!prior || prior.sn !== current.sn! - 1) break;
      current = prior;
    }
    if (!anchor) {
      const data = [{ i: reg.regk, s: event.sad!.n, d: event.said }];
      if (hab.kever!.estOnly) hab.rotate({ data });
      else hab.interact({ data });
      anchor = hab.kever!.serder;
    }
    yield* this.receiptor.receipt(hab.pre, { sn: anchor.sn!, allowTcp: true, auths });
    this.rgy.hby.kevery.processEscrows();
    reg.processEscrows();
    const exact = reg.store.seqEvent(reg.regk!, ordinal);
    if (!exact || !bytesEqual(exact.raw, event.raw)) {
      throw new ValidationError("ACDC v2 registry event remains pending authenticated anchor receipts.");
    }
  }
}
