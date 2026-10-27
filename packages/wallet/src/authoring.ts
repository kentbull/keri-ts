/** Finite native registry authoring; existing engines own acceptance and receipt authentication. */
import { bytesEqual, makeBlindState, type SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import {
  acdcmap,
  type AcdcMapOptions,
  blindate,
  isLocalGroupHab,
  matchesRegistrySeal,
  type NativeRegery,
  type NativeRegistry,
  type Receiptor,
  type RegistryDisclosure,
  validateAcdcSchema,
  ValidationError,
} from "keri-ts/runtime";
import type { RegistryCustody } from "./custody.ts";
import type { Wallet } from "./wallet.ts";

/** Public means deliberate opening publication; private derivation requires supplied custody. */
export interface NativeUpdateOptions {
  public?: boolean;
  stamp?: string;
  boundEvent?: string;
}

/** Borrow the actual wallet, registry environment and receipt collector; acquire no handles or workers. */
export class WalletAuthor {
  constructor(
    readonly wallet: Wallet,
    readonly rgy: NativeRegery,
    readonly receiptor: Receiptor,
    readonly custody?: RegistryCustody,
  ) {
    if (rgy.hby !== wallet.hby || rgy.baser !== wallet.registry.baser || receiptor.hby !== wallet.hby) {
      throw new ValidationError("Authoring requires the wallet's actual registry and receipt owners.");
    }
  }

  /** Resolve only this local single-controller registry; groups retain their separate approval workflow. */
  registry(name: string, controller: string): NativeRegistry {
    const registry = this.rgy.registryByName(name);
    if (!registry || registry.hab.pre !== controller) {
      throw new ValidationError("Unknown registry or different controller.");
    }
    if (isLocalGroupHab(this.wallet.hby, registry.hab)) {
      throw new ValidationError("Native group authoring requires member approval.");
    }
    return registry;
  }

  /** Idempotently stage an alias, then return only its exact accepted inception. */
  *incept(name: string, controller: string): Operation<SerderACDC> {
    const hab = this.wallet.hby.habs.get(controller);
    if (!hab || isLocalGroupHab(this.wallet.hby, hab)) {
      throw new ValidationError("Native inception requires a local individual controller.");
    }
    const reg = this.rgy.registryByName(name) ?? this.rgy.makeRegistry(name, controller);
    this.registry(name, controller);
    const event = reg.store.event(reg.regk!)!;
    yield* this.anchor(reg, event);
    return event;
  }

  /** Construct the issuer's credential using the existing native finite builder. */
  create(reg: NativeRegistry, options: Omit<AcdcMapOptions, "regid">): SerderACDC {
    this.registry(reg.name, reg.hab.pre);
    return acdcmap(reg.hab.pre, { ...options, regid: reg.regk });
  }

  /** Stage one BUP state advance, preserving an exact pending retry and its opening. Never author historical upd. */
  stage(
    reg: NativeRegistry,
    acdc: SerderACDC,
    state: string,
    options: NativeUpdateOptions = {},
  ): { event: SerderACDC; opening: RegistryDisclosure } {
    this.registry(reg.name, acdc.issuer!);
    if (!acdc.verify() || acdc.regid !== reg.regk) {
      throw new ValidationError("Credential does not match this registry.");
    }
    const schema = validateAcdcSchema(acdc, this.wallet.hby.db);
    if (schema.kind !== "valid") {
      throw new ValidationError(schema.kind === "missing" ? `Missing ACDC schema: ${schema.said}` : schema.reason);
    }
    const head = reg.store.headEvent(reg.regk!);
    if (!head || head.ilk === "upd") throw new ValidationError("An accepted native registry head is required.");
    if (options.public && options.boundEvent) {
      throw new ValidationError("Public opening cannot use private bound coordinates.");
    }
    if (!options.public && !this.custody) {
      throw new ValidationError("Derived authoring requires provisioned registry custody.");
    }
    const sn = Number(BigInt(`0x${head.sad!.n}`));
    if (!Number.isSafeInteger(sn + 1)) throw new ValidationError("Registry ordinal is not representable.");
    let bound: { bsn: number; bd: string } | undefined;
    if (options.boundEvent) {
      const issuee = acdc.issuee, db = this.wallet.hby.db;
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
    if (sn && head.ilk === "bup") {
      const published = reg.store.publicOpening(head.said!);
      const opening = options.public ? published : derive(sn);
      if (opening && matches(head, opening) && (!options.public || published)) {
        if (!options.public) this.custody!.retainDerivedUpdate(head, opening);
        return { event: head, opening };
      }
    }
    if (bound && this.wallet.hby.db.getKever(acdc.issuee!)?.serder.said !== bound.bd) {
      throw new ValidationError("New bound update must reference the known current Issuee event.");
    }
    const opening = derive(sn + 1),
      event = blindate(reg.regk!, head.said!, opening.d.nonce, { sn: sn + 1, stamp: options.stamp });
    if (!options.public) this.custody!.retainDerivedUpdate(event, opening);
    reg.store.baser.env!.transactionSync(() => {
      reg.store.putEvent(event);
      if (options.public) reg.store.retainOpening(event, opening);
      const decision = reg.processEvent(event);
      if (decision.kind === "reject") throw new ValidationError(`Registry update rejected: ${decision.reason}`);
    });
    return { event, opening };
  }

  /** Advance one explicit state through real anchoring; staging is never reported as accepted. */
  *update(
    reg: NativeRegistry,
    acdc: SerderACDC,
    state: string,
    options: NativeUpdateOptions = {},
  ): Operation<SerderACDC> {
    const { event } = this.stage(reg, acdc, state, options);
    yield* this.anchor(reg, event);
    return event;
  }

  /** Preserve original issued history on retry; inventory follows exact witnessed TEL acceptance. */
  *issue(reg: NativeRegistry, acdc: SerderACDC, options: NativeUpdateOptions = {}) {
    this.registry(reg.name, acdc.issuer!);
    if (acdc.regid !== reg.regk) throw new ValidationError("Credential does not match this registry.");
    const old = this.wallet.db.issued.get([acdc.said!]);
    if (old) return this.wallet.recordIssued(acdc, old.update);
    const { event, opening } = this.stage(reg, acdc, "issued", options);
    yield* this.anchor(reg, event);
    return this.wallet.recordIssued(acdc, event.said!, { blinder: opening });
  }

  /** Revoke only locally retained issuance, not an unrelated arbitrary target digest. */
  *revoke(reg: NativeRegistry, said: string, options: NativeUpdateOptions = {}): Operation<SerderACDC> {
    const record = this.wallet.db.issued.get([said]);
    if (!record || record.registry !== reg.regk) {
      throw new ValidationError("Credential is not in this registry's issued inventory.");
    }
    return yield* this.update(reg, this.wallet.issuedCredential(said), "revoked", options);
  }

  /** Reuse the current branch's already signed seal even before receipts; no extra anchor merely to poll. */
  *anchor(reg: NativeRegistry, event: SerderACDC): Operation<void> {
    this.registry(reg.name, reg.hab.pre);
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
      const data = [{ s: event.sad!.n, d: event.said }];
      if (hab.kever!.estOnly) hab.rotate({ data });
      else hab.interact({ data });
      anchor = hab.kever!.serder;
    }
    yield* this.receiptor.receipt(hab.pre, { sn: anchor.sn!, allowTcp: true });
    this.wallet.hby.kevery.processEscrows();
    reg.processEscrows();
    const exact = reg.store.seqEvent(reg.regk!, ordinal);
    if (!exact || !bytesEqual(exact.raw, event.raw)) {
      throw new ValidationError("Native registry event remains pending authenticated anchor receipts.");
    }
  }
}
