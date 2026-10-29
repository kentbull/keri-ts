/** Optional encrypted derivation capability; ordinary wallet inventory never constructs or reads it. */
import {
  b,
  bytesEqual,
  Cipher,
  Decrypter,
  Encrypter,
  makeBlindState,
  makeBoundState,
  MtrDex,
  Prefixer,
  Salter,
  type SerderACDC,
  t,
  Verfer,
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
/** Ciphertext and the exact previous record for retention in the caller's wallet writer. */
export interface PreparedCustody {
  readonly registry: string;
  readonly expected: Readonly<EncryptedCustody> | null;
  readonly encrypted: Readonly<EncryptedCustody>;
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

  /** Encrypt supplied private data outside the writer; explicit rewrap never opens an old-AEID row. */
  private prepare(secret: Secret, rewrap = false): PreparedCustody {
    if (this.options.db.inWriteTransaction) {
      throw new ValidationError("Custody preparation must precede the wallet write transaction");
    }
    const box = this.box(), rows = this.tables().custody, key = secret.info.registry;
    const previous = rows.get(key);
    const expected = previous ? Object.freeze({ aeid: previous.aeid, cipher: previous.cipher }) : null;
    if (previous?.aeid === box.aeid) {
      if (JSON.stringify(this.load(key)) !== JSON.stringify(secret)) {
        throw new ValidationError("Different registry custody is already retained");
      }
      return Object.freeze({ registry: key, expected, encrypted: expected! });
    }
    if (previous && !rewrap) {
      throw new ValidationError("Custody encryption AEID changed; explicit operator rewrap is required");
    }
    if (!previous && rewrap) throw new ValidationError("Rewrap requires an existing custody record under a prior AEID");
    const encrypted = Object.freeze({
      aeid: box.aeid,
      cipher: box.encrypter.encrypt({ ser: b(JSON.stringify(secret)) }).qb64,
    });
    return Object.freeze({ registry: key, expected, encrypted });
  }

  /** Prepare a supplied Salt_128 root; the caller first authenticates assignment and membership.
   *
   * info retains the original fixed-profile parties, including for later recipients.
   * root is the established root, never generated here. Returns ciphertext only,
   * without retaining it. Structural binding checks establish no network authority.
   * KERIpy reference: RegistryCustody.prepareRoot at qualified core 23f526b4.
   */
  prepareRoot(info: CustodyInfo, root: Salter): PreparedCustody {
    this.box();
    const canonical = metadata(info.registry, info.controller, info.discloser);
    if (
      Object.keys(info).length !== Object.keys(canonical).length ||
      Object.entries(canonical).some(([key, value]) => info[key as keyof CustodyInfo] !== value)
    ) {
      throw new ValidationError("Registry root requires the fixed custody profile");
    }
    try {
      for (const aid of [info.controller, info.discloser]) {
        if (new Prefixer({ qb64: aid }).qb64 !== aid) throw new Error();
      }
    } catch {
      throw new ValidationError("Invalid original custody party");
    }
    const rip = this.options.registry.seqEvent(info.registry, 0);
    if (!rip || rip.ilk !== "rip" || rip.issuer !== info.controller) {
      throw new ValidationError("Registry root must match the accepted registry controller");
    }
    if (!(root instanceof Salter) || root.code !== MtrDex.Salt_128 || root.raw.length !== 16) {
      throw new ValidationError("Registry root must be one Salt_128 Salter");
    }
    return this.prepare({ info: canonical, salt: root.qb64 });
  }

  /** CAS-retain prepared ciphertext inside this wallet's already-active write transaction.
   *
   * prepared comes from prepareRoot before the writer. Returns whether the row
   * changed. No encryption, decryption, owned commit, flush or receipt is performed;
   * the owner commits related records together and awaits env.flushed afterward.
   */
  retainPrepared(prepared: PreparedCustody): boolean {
    const { db } = this.options;
    if (!db.inWriteTransaction) throw new ValidationError("Prepared custody requires the caller's wallet writer");
    const box = this.box(), rows = this.tables().custody;
    if (prepared.encrypted.aeid !== box.aeid) {
      throw new ValidationError("Prepared custody does not match the authenticated Keeper");
    }
    const current = rows.get(prepared.registry)?.asDict() ?? null;
    if (JSON.stringify(current) !== JSON.stringify(prepared.expected)) {
      throw new ValidationError("Custody changed during prepared retention");
    }
    if (JSON.stringify(prepared.expected) === JSON.stringify(prepared.encrypted)) return false;
    // Komer's synchronous write joins the already-active native writer; an outer
    // abort still rolls back this row together with the caller's related records.
    rows.pin(prepared.registry, prepared.encrypted);
    return true;
  }

  /** Retain the explicit file/create adapter through the same prepared CAS path, without a flush claim. */
  private retain(secret: Secret, rewrap = false): CustodyInfo {
    const prepared = this.prepare(secret, rewrap);
    this.options.db.env!.transactionSync(() => this.retainPrepared(prepared));
    return secret.info;
  }

  /** Seal one existing root to the caller-authenticated X25519 recipient, returning qualified Cipher_Salt.
   *
   * regid selects retained custody; encrypter selects the exact recipient key.
   * Existing CESR Encrypter uses libsodium sealed boxes; confidentiality grants no
   * sender authority. The caller binds assignment, member and key coordinates.
   */
  sealRoot(regid: string, encrypter: Encrypter): Cipher {
    if (!(encrypter instanceof Encrypter) || encrypter.code !== MtrDex.X25519) {
      throw new ValidationError("Registry root requires an accepted X25519 recipient key");
    }
    return encrypter.encrypt({ prim: new Salter({ qb64: this.load(regid).salt }) });
  }

  /** Open Cipher_Salt using the exact retained Ed25519 key through Keeper Manager.
   *
   * cipher is one complete qualified primitive; verfer is selected and authorized
   * by the caller. Returns Salt_128 for commitment validation before prepareRoot;
   * neither private seeds nor root values may be logged. Decryption grants no entitlement.
   */
  openRoot(cipher: Cipher | string, verfer: Verfer): Salter {
    this.box();
    let sealed: Cipher;
    try {
      sealed = typeof cipher === "string" ? new Cipher({ qb64: cipher }) : cipher;
      if (
        !(sealed instanceof Cipher) || sealed.code !== MtrDex.X25519_Cipher_Salt ||
        (typeof cipher === "string" && sealed.qb64 !== cipher) ||
        !(verfer instanceof Verfer) || (verfer.code !== MtrDex.Ed25519 && verfer.code !== MtrDex.Ed25519N)
      ) throw new Error();
    } catch {
      throw new ValidationError("Registry root cipher or recipient key is unsupported");
    }
    // Only null is a sealed-box authentication failure. Key lookup and backend
    // failures keep their identity so the owning service can recover correctly.
    const raw = this.options.hby.mgr.open(sealed.raw, verfer);
    if (raw === null) throw new ValidationError("Unable to authenticate encrypted registry root");
    if (raw.length !== Salter.fullSizeForCode(MtrDex.Salt_128)) {
      throw new ValidationError("Encrypted registry root has invalid salt encoding");
    }
    try {
      const root = new Salter({ qb64b: raw });
      if (root.code !== MtrDex.Salt_128 || !bytesEqual(root.qb64b, raw)) throw new Error();
      return root;
    } catch {
      throw new ValidationError("Encrypted registry root has invalid salt encoding");
    }
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
