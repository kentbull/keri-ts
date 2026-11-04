/** Optional encrypted derivation capability; ordinary wallet inventory never constructs or reads it. */
import {
  b,
  bytesEqual,
  Decrypter,
  Encrypter,
  makeBlindState,
  makeBoundState,
  MtrDex,
  Prefixer,
  Salter,
  type SerderACDC,
  t,
} from "cesr-ts";
import { Komer, type RegistryStore } from "keri-ts/db";
import { type Habery, RawRecord, type RegistryDisclosure, ValidationError, vetBlind } from "keri-ts/runtime";
import type { WalletBaser } from "./storing.ts";

/** Public bindings for locally encrypted registry derivation material. */
export interface CustodyInfo {
  registry: string;
  controller: string;
  discloser: string;
}

interface Secret {
  info: CustodyInfo;
  salt: string;
}
interface EncryptedCustody {
  aeid: string;
  cipher: string;
}
interface DerivedUpdate {
  credential: string;
  state: string;
  bound: { bn: string; bd: string } | null;
}

/** Only the Keeper AEID and authenticated ciphertext are stored at rest. */
class CustodyRecord extends RawRecord<EncryptedCustody> implements EncryptedCustody {
  declare aeid: string;
  declare cipher: string;
}
/** Public event-specific inputs; neither a salt nor a derived opening is retained here. */
class DerivedRecord extends RawRecord<DerivedUpdate> implements DerivedUpdate {
  declare credential: string;
  declare state: string;
  declare bound: DerivedUpdate["bound"];
}

/** Narrow the decrypted local record before reading its bindings. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Validate the decrypted local record without including secret material in failures. */
function parseSecret(raw: Uint8Array, registry: string): Secret {
  const payload: unknown = JSON.parse(t(raw));
  if (
    !record(payload) || Object.keys(payload).sort().join(",") !== "info,salt"
    || !record(payload.info) || typeof payload.salt !== "string"
  ) throw new Error("Invalid custody payload");
  const info = payload.info;
  if (typeof info.controller !== "string" || typeof info.discloser !== "string") throw new Error("Invalid bindings");
  const canonical = { registry, controller: info.controller, discloser: info.discloser };
  if (
    Object.keys(info).length !== Object.keys(canonical).length
    || Object.entries(canonical).some(([key, value]) => info[key] !== value)
  ) throw new Error("Invalid bindings");
  new Salter({ qb64: payload.salt });
  return { info: canonical, salt: payload.salt };
}
/** Explicit capability over an existing wallet environment and accepted public registry evidence. */
export class RegistryCustody {
  private env: WalletBaser["env"] = null;
  private custody?: Komer<CustodyRecord>;
  private derivations?: Komer<DerivedRecord>;

  /** Borrow owners only; construction opens no table and loads no encrypted row. */
  constructor(readonly options: { hby: Habery; registry: RegistryStore; db: WalletBaser }) {}

  /** Rebind optional tables after the caller reopens the same wallet owner. */
  private tables() {
    const { db } = this.options;
    if (!db.opened || !db.env) throw new ValidationError("Wallet inventory is closed");
    if (this.env !== db.env) {
      this.custody = new Komer(db, { subkey: "custody.", recordClass: CustodyRecord });
      this.derivations = new Komer(db, { subkey: "derived-updates.", recordClass: DerivedRecord });
      this.env = db.env;
    }
    return { custody: this.custody!, derivations: this.derivations! };
  }

  /** Authenticate the current Keeper before any secret-bearing operation. */
  private box() {
    const mgr = this.options.hby.mgr;
    if (!mgr.aeid || !mgr.seed) {
      throw new ValidationError("Private credential custody requires an authenticated encrypted Keeper");
    }
    const encrypter = new Encrypter({ verkey: mgr.aeid });
    if (!encrypter.verifySeed(mgr.seed)) throw new ValidationError("Keeper authentication does not match its AEID");
    return { aeid: mgr.aeid, encrypter, decrypter: new Decrypter({ seed: mgr.seed }) };
  }

  /** Bind explicit participants to the accepted inception; salt possession is not delegation. */
  private binding(registry: string, controller: string, discloser: string): void {
    new Prefixer({ qb64: controller });
    new Prefixer({ qb64: discloser });
    const rip = this.options.registry.seqEvent(registry, 0);
    if (!rip || rip.issuer !== controller) {
      throw new ValidationError("Custody must match the accepted registry controller");
    }
    const local = this.options.hby.habs;
    if (!local.has(controller)) {
      throw new ValidationError("Custody operation requires the intended local identifier");
    }
    if (!this.options.hby.db.getKever(discloser)) {
      throw new ValidationError("Designated discloser key state is unknown");
    }
  }

  /** Decrypt exactly one provisioned row under its original Keeper AEID. */
  private load(registry: string): Secret {
    const box = this.box(), stored = this.tables().custody.get(registry);
    if (!stored) throw new ValidationError("Registry custody is not provisioned");
    if (stored.aeid !== box.aeid) {
      throw new ValidationError("Local custody is unavailable under the changed Keeper AEID");
    }
    try {
      return parseSecret(box.decrypter.decrypt({ qb64: stored.cipher, bare: true }) as Uint8Array, registry);
    } catch {
      throw new ValidationError("Unable to authenticate private registry custody");
    }
  }

  /** Retain locally encrypted material once; a concurrent differing record is refused. */
  private retain(secret: Secret): CustodyInfo {
    const box = this.box(), rows = this.tables().custody, key = secret.info.registry;
    const value = { aeid: box.aeid, cipher: box.encrypter.encrypt({ ser: b(JSON.stringify(secret)) }).qb64 };
    if (!rows.put(key, value) && JSON.stringify(this.load(key)) !== JSON.stringify(secret)) {
      throw new ValidationError("Different registry custody was concurrently retained");
    }
    return secret.info;
  }

  /** Provision once, refusing replacement salt after any undisclosed accepted blinded history. */
  createCustody(registry: string, discloser: string): CustodyInfo {
    this.box();
    const rip = this.options.registry.seqEvent(registry, 0);
    if (!rip?.issuer) throw new ValidationError("Accepted registry inception is required before custody");
    const info = { registry, controller: rip.issuer, discloser };
    this.binding(registry, info.controller, discloser);
    if (this.tables().custody.get(registry)) {
      const current = this.load(registry);
      if (JSON.stringify(current.info) !== JSON.stringify(info)) {
        throw new ValidationError("Registry custody has different designated bindings");
      }
      return info;
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
    return this.retain({
      info,
      salt: new Salter({ code: MtrDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }).qb64,
    });
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
    const secret = this.load(registry), local = this.options.hby.habs;
    if (!local.has(secret.info.controller) && !local.has(secret.info.discloser)) {
      throw new ValidationError("This wallet is not a designated custody participant");
    }
    const values = { salt: secret.salt, sn: ordinal, tier: "low" as const, acdc: credential, state };
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
