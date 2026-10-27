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
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import process from "node:process";
import type { WalletBaser } from "./storing.ts";

/** Python-compatible public bindings and the fixed derivation profile. */
export interface CustodyInfo {
  registry: string;
  controller: string;
  discloser: string;
  algorithm: "keripy.Blinder.makeUUID";
  version: 1;
  path: "Number.snh";
  tier: "low";
  kdf: "argon2id13";
  nonce: "Salt_256";
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

/** Construct the single supported profile in Python's field order. */
function metadata(registry: string, controller: string, discloser: string): CustodyInfo {
  return {
    registry,
    controller,
    discloser,
    algorithm: "keripy.Blinder.makeUUID",
    version: 1,
    path: "Number.snh",
    tier: "low",
    kdf: "argon2id13",
    nonce: "Salt_256",
  };
}
/** Narrow only the operator JSON boundary; it never supplies an application policy. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Validate a closed plaintext payload without including secret material in failures. */
function parseSecret(raw: Uint8Array, registry: string, expected?: CustodyInfo): Secret {
  const payload: unknown = JSON.parse(t(raw));
  if (
    !record(payload) || Object.keys(payload).sort().join(",") !== "info,salt" ||
    !record(payload.info) || typeof payload.salt !== "string"
  ) throw new Error("Invalid custody payload");
  const info = payload.info;
  if (typeof info.controller !== "string" || typeof info.discloser !== "string") throw new Error("Invalid bindings");
  const canonical = expected ?? metadata(registry, info.controller, info.discloser);
  if (
    Object.keys(info).length !== Object.keys(canonical).length ||
    Object.entries(canonical).some(([key, value]) => info[key] !== value)
  ) throw new Error("Invalid profile");
  new Salter({ qb64: payload.salt });
  return { info: canonical, salt: payload.salt };
}
/** File protections are a POSIX contract; no weaker platform fallback is offered. */
function requirePosix(): void {
  if (
    process.platform === "win32" || typeof process.geteuid !== "function" ||
    constants.O_NOFOLLOW === undefined || constants.O_NONBLOCK === undefined
  ) {
    throw new ValidationError("Protected plaintext custody handoff requires POSIX file protections");
  }
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
  private binding(registry: string, controller: string, discloser: string, importing = false, rewrap = false): void {
    new Prefixer({ qb64: controller });
    new Prefixer({ qb64: discloser });
    const rip = this.options.registry.seqEvent(registry, 0);
    if (!rip || rip.issuer !== controller) {
      throw new ValidationError("Custody must match the accepted registry controller");
    }
    const local = this.options.hby.habs;
    if (!local.has(importing ? discloser : controller) && !(rewrap && local.has(controller))) {
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
      throw new ValidationError("Custody encryption AEID changed; explicit operator rewrap is required");
    }
    try {
      return parseSecret(box.decrypter.decrypt({ qb64: stored.cipher, bare: true }) as Uint8Array, registry);
    } catch {
      throw new ValidationError("Unable to authenticate private registry custody");
    }
  }

  /** Retain only authenticated ciphertext; explicit reimport never decrypts an old-AEID row. */
  private retain(secret: Secret, rewrap = false): CustodyInfo {
    const box = this.box(), rows = this.tables().custody, key = secret.info.registry;
    const previous = rows.get(key);
    if (previous?.aeid === box.aeid) {
      if (JSON.stringify(this.load(key)) !== JSON.stringify(secret)) {
        throw new ValidationError("Different registry custody is already retained");
      }
      return secret.info;
    }
    if (previous && !rewrap) {
      throw new ValidationError("Custody encryption AEID changed; explicit operator rewrap is required");
    }
    if (!previous && rewrap) throw new ValidationError("Rewrap requires an existing custody record under a prior AEID");
    const value = { aeid: box.aeid, cipher: box.encrypter.encrypt({ ser: b(JSON.stringify(secret)) }).qb64 };
    if (rewrap) {
      this.options.db.env!.transactionSync(() => {
        const current = rows.get(key);
        if (!current || current.aeid !== previous!.aeid || current.cipher !== previous!.cipher) {
          throw new ValidationError("Custody changed during explicit operator rewrap");
        }
        rows.pin(key, value);
      });
    } else if (!rows.put(key, value) && JSON.stringify(this.load(key)) !== JSON.stringify(secret)) {
      throw new ValidationError("Different registry custody was concurrently retained");
    }
    return secret.info;
  }

  /** Provision once, refusing replacement salt after any undisclosed accepted blinded history. */
  createCustody(registry: string, discloser: string): CustodyInfo {
    this.box();
    const rip = this.options.registry.seqEvent(registry, 0);
    if (!rip?.issuer) throw new ValidationError("Accepted registry inception is required before custody");
    const info = metadata(registry, rip.issuer, discloser);
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
          "Blinded registry history requires explicit custody import; salt cannot be recreated",
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
    const values = { salt: secret.salt, sn: ordinal, tier: secret.info.tier, acdc: credential, state };
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

  /** Create one exclusive mode0600 plaintext artifact for authenticated private operator transfer. */
  async exportCustody(registry: string, path: string): Promise<string> {
    requirePosix();
    const secret = this.load(registry);
    const file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      try {
        await file.chmod(0o600);
        await file.writeFile(b(JSON.stringify(secret)));
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (error) {
      await unlink(path);
      throw error;
    }
    return path;
  }

  /** Import only a protected exact Python-profile handoff, optionally rewrapping an existing old-AEID row. */
  async importCustody(
    path: string,
    { registry, controller, discloser, rewrap = false }: {
      registry: string;
      controller: string;
      discloser: string;
      rewrap?: boolean;
    },
  ): Promise<CustodyInfo> {
    requirePosix();
    if (typeof rewrap !== "boolean") throw new ValidationError("Explicit rewrap must be a boolean");
    this.box();
    this.binding(registry, controller, discloser, true, rewrap);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let raw: Uint8Array;
    try {
      const info = await file.stat();
      if (!info.isFile() || (info.mode & 0o7777) !== 0o600 || info.uid !== process.geteuid!() || info.nlink !== 1) {
        throw new ValidationError("Custody file must be a regular owner-only mode0600 file");
      }
      const buffer = new Uint8Array(16385);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > 16384) throw new ValidationError("Custody file exceeds the supported size");
      raw = buffer.subarray(0, offset);
    } finally {
      await file.close();
    }
    let secret: Secret;
    try {
      secret = parseSecret(raw, registry, metadata(registry, controller, discloser));
    } catch {
      throw new ValidationError("Custody file does not match the expected bindings and derivation profile");
    }
    this.binding(registry, controller, discloser, true, rewrap);
    return this.retain(secret, rewrap);
  }
}
