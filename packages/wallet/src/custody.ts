/** Optional encrypted derivation capability; ordinary wallet inventory never constructs or reads it. */
import { bytesEqual, makeBlindState, makeBoundState, MtrDex, Salter, type SerderACDC } from "cesr-ts";
import { Komer, type RegistryStore } from "keri-ts/db";
import { type Hab, type Habery, RawRecord, type RegistryDisclosure, ValidationError, vetBlind } from "keri-ts/runtime";
import type { WalletBaser } from "./storing.ts";

interface DerivedUpdate {
  credential: string;
  state: string;
  bound: { bn: string; bd: string } | null;
}

/** Public event-specific inputs; neither a salt nor a derived opening is retained here. */
class DerivedRecord extends RawRecord<DerivedUpdate> implements DerivedUpdate {
  declare credential: string;
  declare state: string;
  declare bound: DerivedUpdate["bound"];
}

/** Explicit capability over an existing wallet environment and accepted public registry evidence. */
export class RegistryCustody {
  private env: WalletBaser["env"] = null;
  private derivations?: Komer<DerivedRecord>;

  /** Borrow owners only; construction opens no table and loads no encrypted row. */
  constructor(readonly options: { hby: Habery; hab: Hab; registry: RegistryStore; db: WalletBaser }) {
    this.owner();
  }

  /** Bind the actual local habitat and its key owners, never an AID label alone. */
  private owner(): void {
    const { hby, hab } = this.options;
    if (hby.habs.get(hab.pre) !== hab || hab.ks !== hby.ks || hab.mgr !== hby.mgr || hab.db !== hby.db) {
      throw new ValidationError("Custody requires the actual local habitat and Keeper owners");
    }
  }

  /** Rebind optional tables after the caller reopens the same wallet owner. */
  private tables() {
    const { db } = this.options;
    if (!db.opened || !db.env) throw new ValidationError("Wallet inventory is closed");
    if (this.env !== db.env) {
      this.derivations = new Komer(db, { subkey: "derived-updates.", recordClass: DerivedRecord });
      this.env = db.env;
    }
    return { derivations: this.derivations! };
  }

  /** Load only this habitat's native Keeper root; possession confers no protocol authority. */
  private load(registry: string): Salter {
    this.owner();
    const root = this.options.hby.mgr.getRegistryRoot(this.options.hab.pre, registry);
    if (!root) throw new ValidationError("Registry custody is not provisioned");
    return root;
  }

  /** Provision an issuer-selected root once, refusing replacement behind opaque accepted history. */
  createCustody(registry: string): { registry: string } {
    this.owner();
    const { hby, hab } = this.options;
    if (!hby.mgr.aeid || !hby.mgr.seed) {
      throw new ValidationError("Private credential custody requires an authenticated encrypted Keeper");
    }
    if (hby.mgr.getRegistryRoot(hab.pre, registry)) return { registry };
    const rip = this.options.registry.seqEvent(registry, 0);
    if (!rip || rip.issuer !== hab.pre) {
      throw new ValidationError("New custody requires the accepted registry issuer's actual local habitat");
    }
    // Existing clone validation authenticates public openings without another parser or proof algorithm.
    for (const _ of this.options.registry.cloneTelIter(registry)) { /* consume the accepted public prefix */ }
    const head = this.options.registry.headEvent(registry);
    const last = head ? Number(BigInt(`0x${head.sad!.n}`)) : 0;
    if (!Number.isSafeInteger(last)) throw new ValidationError("Accepted registry ordinal is not representable");
    for (let ordinal = 1; ordinal <= last; ordinal++) {
      const event = this.options.registry.seqEvent(registry, ordinal);
      if (!event) throw new ValidationError("Accepted registry history is incomplete");
      if (event.ilk === "bup" && !this.options.registry.opening(event.said!)) {
        throw new ValidationError(
          "Local custody is missing for blinded registry history; salt cannot be recreated",
        );
      }
    }
    hby.mgr.putRegistryRoot(
      hab.pre,
      registry,
      new Salter({ code: MtrDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }),
    );
    return { registry };
  }

  /** Derive a candidate only; consumers still authenticate its exact accepted event and bound KEL reference. */
  derive(
    registry: string,
    ordinal: number | bigint,
    credential: string,
    state: string,
    options: { bound?: boolean; bsn?: number | bigint; bd?: string } = {},
  ): RegistryDisclosure {
    if (
      (typeof ordinal !== "bigint" && (typeof ordinal !== "number" || !Number.isSafeInteger(ordinal))) || ordinal < 1
    ) {
      throw new ValidationError("Update ordinal must be a positive integer");
    }
    const root = this.load(registry);
    const values = { salt: root.qb64, sn: ordinal, tier: "low" as const, acdc: credential, state };
    return options.bound
      ? makeBoundState({ ...values, bsn: options.bsn ?? 0, bd: options.bd ?? "" })
      : makeBlindState(values);
  }

  /** Persist exact nonsecret coordinates before processing/anchoring a newly derived BUP. */
  retainDerivedUpdate(event: SerderACDC, opening: RegistryDisclosure): DerivedUpdate {
    if (event.ilk !== "bup" || !event.verify() || !vetBlind(opening, event.sad!.b as string)) {
      throw new ValidationError("Derived update requires its exact authenticated BUP opening");
    }
    const value: DerivedUpdate = {
      credential: opening.td.nonce,
      state: opening.ts.label,
      bound: "bn" in opening ? { bn: opening.bn.num.toString(16), bd: opening.bd.nonce } : null,
    };
    const rows = this.tables().derivations, old = rows.get(event.said!);
    if (old && JSON.stringify(old.asDict()) !== JSON.stringify(value)) {
      throw new ValidationError("Different derivation coordinates are already retained for this event");
    }
    rows.pin(event.said!, value);
    return value;
  }

  /** Reproduce only the exact accepted event, never today's head or a later credential's coordinates. */
  derivedOpening(event: SerderACDC): RegistryDisclosure {
    if (event.ilk !== "bup" || !event.verify()) throw new ValidationError("Exact accepted blinded update is required");
    const ordinal = BigInt(`0x${event.sad!.n}`);
    if (!Number.isSafeInteger(Number(ordinal))) {
      throw new ValidationError("Accepted registry ordinal is not representable");
    }
    const stored = event.regid ? this.options.registry.seqEvent(event.regid, Number(ordinal)) : null;
    if (!stored || !bytesEqual(stored.raw, event.raw)) {
      throw new ValidationError("Exact accepted registry event is required");
    }
    const value = this.tables().derivations.get(event.said!);
    if (!value) throw new ValidationError("Exact derived update coordinates are unavailable");
    const opening = this.derive(
      event.regid!,
      ordinal,
      value.credential,
      value.state,
      value.bound ? { bound: true, bsn: BigInt(`0x${value.bound.bn}`), bd: value.bound.bd } : {},
    );
    if (!vetBlind(opening, event.sad!.b as string)) {
      throw new ValidationError("Derived opening does not match the exact accepted event");
    }
    return opening;
  }
}
