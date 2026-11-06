/**
 * Explicit encrypted copies of existing registry roots.
 *
 * `RegistryRoot` replicates held roots to individual members with ESSR `exn`
 * messages, ported from KERIpy `keri.acdc.salting` (kentbull/keripy v2-spec).
 *
 * Local profile, not a KERI, ACDC or #1740 standard. Upstream KERIpy uses ESSR
 * only as the v1 `/essr/req` transport envelope on direct sends.
 * `/registry/root` is the first application-route ESSR payload and the first
 * ESSR carried through a witness mailbox. Its v2 `a` field map `{essr, gid, rd}`
 * carries the payload digest that v1 puts in a string `a`; the Exchanger checks
 * only the v1 form, so this handler verifies it.
 *
 * Copies are store-and-forward: KRAM exempts the route (built-in
 * `KramPolicy` store-and-forward exemption) and the exchange store keys them by
 * SAID. Received copies are accepted automatically, with no approval step: a
 * copy that verifies on arrival is retained at once, and one that cannot yet
 * verify because local KEL, TEL, group or opening evidence is missing waits in a
 * dependency escrow (`Baser.rrpe`, no timeout) that `processEscrows` retries.
 */
import {
  concatBytes,
  Counter,
  Dater,
  Diger,
  Encrypter,
  essrChunks,
  Kinds,
  LabelDex,
  makeBlindUuid,
  type Matter,
  MtrDex,
  ParserError,
  Prefixer,
  Saider,
  Salter,
  type SerderACDC,
  type SerderKERI,
  Texter,
  unblindBlindState,
  unblindBoundState,
  type Verfer,
  Vrsn_2_0,
} from "cesr-ts";
import type { ExchangeRouteHandler } from "../app/exchanges/exchanging.ts";
import type { Hab, Habery } from "../app/identity/habbing.ts";
import { groupWitnesserSelection, isLocalGroupHab } from "../app/multisig/group-members.ts";
import type { Notifier } from "../app/notifications/notifying.ts";
import { ValidationError } from "../core/errors.ts";
import { exchange } from "../core/protocol-eventing.ts";
import type { Baser } from "../db/basing.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { type RegistryDisclosure, validateRip, validateUpdate, verifyRegistryAnchor, vetBlind } from "./regeventing.ts";
import type { Regery } from "./registraring.ts";

/** A stored registry-root copy that can never be retained as received. */
export class RootRefused extends ValidationError {}

/** A stored registry-root copy whose root cannot yet be verified locally. */
export class RootUnverified extends ValidationError {}

/** A registry-root copy whose authorization needs KEL, TEL or group state not yet local. */
export class RootDeferred extends RootUnverified {}

/** One escrowed copy awaiting automatic retention; `escrowed` is when it last entered escrow. */
export interface PendingRootCopy {
  said: string;
  sender: string;
  recipient: string;
  gid: string;
  registry: string;
  dt: string;
  escrowed: string;
}

/** Sealed-box plaintext field map. */
interface RootPlaintext {
  i: string;
  ri: string;
  gid: string;
  rd: string;
  s: string;
  e: string;
  td?: string;
}

const ED25519 = new Set<string>([MtrDex.Ed25519, MtrDex.Ed25519N]);
const PLAIN_REQUIRED = ["i", "ri", "gid", "rd", "s", "e"];
const PLAIN_ALLOWED = new Set([...PLAIN_REQUIRED, "td"]);

/** Parse a canonical primitive; malformed remote text is a ValidationError, never a parser crash. */
function canonical<T extends Matter>(value: unknown, ctor: new(args: { qb64: string }) => T): T {
  if (typeof value !== "string") throw new ValidationError("invalid registry root identity");
  try {
    const material = new ctor({ qb64: value });
    if (material.qb64 !== value) throw new ValidationError("invalid registry root identity");
    return material;
  } catch (error) {
    if (error instanceof ParserError || error instanceof RangeError || error instanceof TypeError) {
      throw new ValidationError("invalid registry root identity", { cause: error });
    }
    throw error;
  }
}

/** Latest member establishment whose first key is in `verfers`, as KERIpy `fetchLatestContribTo`. */
function contribution(db: Baser, member: string, verfers: readonly Verfer[]): { sn: number; index: number } | null {
  const state = db.getKever(member);
  if (!state) return null;
  const keys = verfers.map(verfer => verfer.qb64);
  for (const [, sn, said] of db.kels.getOnItemBackIter(member, state.lastEst.s)) {
    if (db.kels.getLast(member, sn) !== said) continue;
    const event = db.getEvtSerder(member, said);
    if (!event?.estive) continue;
    const index = keys.indexOf(event.verfers[0]?.qb64 ?? "");
    if (index >= 0) return { sn, index };
  }
  return null;
}

/** Qualify one sealed box as a variable-size bytes Texter, as KERIpy `Texter(raw=...)`. */
function essrTexter(raw: Uint8Array): Texter {
  const rem = raw.length % 3;
  return new Texter({ code: rem === 0 ? LabelDex.Bytes_L0 : rem === 1 ? LabelDex.Bytes_L1 : LabelDex.Bytes_L2, raw });
}

/** Concatenate ordered ESSR fragments into the sealed box bytes. */
function essrBytes(essrs: readonly Texter[] | null | undefined): Uint8Array {
  return concatBytes(...(essrs ?? []).map(texter => texter.raw));
}

/**
 * Return one signed v2 `/registry/root` ESSR exchange carrying `root`.
 *
 * The individual `hab` signs a bare `exn` (`x`/`p` empty) whose `a` is
 * `{essr, gid, rd}`: `essr` is the Blake3-256 digest of a libsodium sealed box
 * to `recipient`'s current first signing key. The box holds the JSON field map
 * `{i, ri, gid, rd, s, e[, td]}`: sender, recipient, holder AID, registry,
 * Salt128 root, one accepted BUP SAID and an optional ACDC SAID hint. The box
 * travels as one ESSR payload Texter inside the message's attachment group.
 * Callers apply policy first.
 */
export function rootExn(
  hab: Hab,
  recipient: string,
  gid: string,
  registry: string,
  root: Salter,
  { event, td }: { event: string; td?: string },
): Uint8Array {
  if (!hab.pre || hab.db.getHab(hab.pre)?.mid) {
    throw new ValidationError("registry root copies are signed by an individual habitat");
  }
  if (!(root instanceof Salter) || root.code !== MtrDex.Salt_128) {
    throw new ValidationError("registry root must be a Salt128 primitive");
  }
  const verfer = hab.db.getKever(recipient)?.verfers[0];
  if (!verfer || !ED25519.has(verfer.code)) {
    throw new ValidationError("recipient encryption requires a current Ed25519 key");
  }
  const plain: RootPlaintext = { i: hab.pre, ri: recipient, gid, rd: registry, s: root.qb64, e: event };
  if (td) plain.td = td;
  const sealed = new Encrypter({ verkey: verfer.qb64 }).encrypt({
    ser: new TextEncoder().encode(JSON.stringify(plain)),
  }).raw;
  const texter = essrTexter(sealed);
  const digest = new Diger({ code: MtrDex.Blake3_256, raw: Diger.digest(sealed, MtrDex.Blake3_256) });
  const serder = exchange(RegistryRoot.Route, {
    sender: hab.pre,
    receiver: recipient,
    attributes: { essr: digest.qb64, gid, rd: registry },
    pvrsn: Vrsn_2_0,
    kind: Kinds.json,
  });
  const signed = hab.endorse(serder, { gvrsn: Vrsn_2_0, pipelined: false });
  const atc = concatBytes(signed.slice(serder.raw.length), ...essrChunks([texter], { gvrsn: Vrsn_2_0 }));
  return concatBytes(serder.raw, Counter.enclose({ qb64: atc, code: "AttachmentGroup", version: Vrsn_2_0 }));
}

/**
 * Replicate held registry roots to individual members by ESSR `exn`.
 *
 * Local profile route `/registry/root`; see `rootExn` for the wire. Register on
 * the Habery's Exchanger with `exc.addHandler`. Authorization uses the accepted
 * KEL and TEL only:
 *
 * - recipient `ri`: a local individual habitat that is a current signing member
 *   of `gid` (or is `gid`, an individual holder) with a local group habitat for
 *   `gid`;
 * - sender `i`: an individual AID, other than the recipient, that is a
 *   historical signing member of `gid`, the registry issuer, or a historical
 *   signing member of the issuer group;
 * - registry `rd`: an accepted, issuer-anchored registry with a BUP head;
 * - `a.essr`: the Blake3-256 digest of the attached ESSR payload.
 *
 * `verify` refuses, so nothing persists, when the copy can never be retained
 * here: malformed exchange or identifiers, ESSR digest mismatch, `ri` not a
 * local individual habitat, `i == ri`, `gid` a local habitat that is not this
 * member's group, a non-Ed25519 recipient key, or a membership or
 * sender-authority failure against complete local state. A SAID already
 * stored is ignored while its root is retained or the copy is still escrowed,
 * so duplicate deliveries are idempotent; an identical resend of a stored copy
 * that is neither escrows it again.
 *
 * Acceptance is automatic. `handle` escrows the stored copy (exchange store plus
 * an `rrpe` entry) and immediately tries to retain it: full authorization,
 * decryption, plaintext binding and root verification against a held opening or
 * by reproducing the BUP `b` commitment. On success the root is retained and the
 * escrow entry removed; a newly retained root adds one informational Notifier
 * note. A copy not yet verifiable (missing registry TEL, sender, recipient or
 * holder key state, local group habitat, an unaccepted rotation that adds the
 * recipient, missing opening evidence or a locked Keeper) stays escrowed and
 * `processEscrows` retries it, which the Exchanger drives from its own
 * `processEscrows`. Like the v2 TEL dependency escrows it has no wall-clock
 * timeout: it stays escrowed until retained or refused, so a newcomer that
 * acquires the missing state much later still retains it. A copy refused on any attempt
 * (plaintext mismatch, undecryptable, membership lost, or a different root
 * already retained, which is never replaced) is dropped from escrow; the signed
 * exchange stays in `exns`. `receive` is a manual retry that can supply a BUP or
 * opening.
 *
 * TypeScript divergences: `verify` runs inside the Exchanger's synchronous LMDB
 * writer, so it only reads stores; `handle` escrows and attempts after commit.
 * A locked Keeper is a `RootUnverified` here (KERIpy raises `AuthError`), so it
 * keeps the copy escrowed rather than refusing it.
 */
export class RegistryRoot implements ExchangeRouteHandler {
  static readonly Route = "/registry/root";
  static readonly Note = "/exn/registry/root";
  static readonly States = ["issued", "revoked"] as const;
  readonly resource = RegistryRoot.Route;
  readonly protocolMajor = 2;
  readonly hby: Habery;
  readonly rgy: Regery;
  readonly notifier: Notifier | null;

  constructor(hby: Habery, rgy: Regery, notifier: Notifier | null = null) {
    if (rgy.hby !== hby) throw new ValidationError("registry root replication requires the Habery's registry owner");
    this.hby = hby;
    this.rgy = rgy;
    this.notifier = notifier;
  }

  // policy

  /** True when `member` contributed to any accepted establishment of `group`. */
  private historical(member: string, group: string): boolean {
    const db = this.hby.db, gkever = db.getKever(group);
    if (!db.getKever(member) || !gkever) return false;
    for (const [, sn, said] of db.kels.getOnItemBackIter(group, gkever.sn)) {
      if (db.kels.getLast(group, sn) !== said) continue;
      const event = db.getEvtSerder(group, said);
      if (event?.estive && contribution(db, member, event.verfers)) return true;
    }
    return false;
  }

  /** True when `member`'s latest contributing key is in `group`'s current keys. */
  private current(member: string, group: string): boolean {
    const gkever = this.hby.db.getKever(group);
    return !!gkever && !!this.hby.db.getKever(member) && !!contribution(this.hby.db, member, gkever.verfers);
  }

  /** True when `group`'s latest next-key digests commit to `member`'s current key (an unaccepted rotation). */
  private prospective(member: string, group: string): boolean {
    const mkever = this.hby.db.getKever(member)!, gkever = this.hby.db.getKever(group)!;
    return gkever.ndigers.some(diger => mkever.verfers.some(verfer => diger.verify(verfer.qb64b)));
  }

  /** Return the accepted, issuer-anchored `rip`; RootDeferred when not yet accepted locally. */
  registry(registry: string): SerderACDC {
    const store = this.rgy.store, rip = store.seqEvent(registry, 0), head = store.headEvent(registry);
    const inception = rip && validateRip(rip);
    if (!rip || rip.said !== registry || inception?.kind !== "valid" || !head || head.ilk !== "bup") {
      throw new RootDeferred("registry is not yet accepted locally with a registry update");
    }
    const anchor = store.anchor(rip.said!);
    if (
      !verifyRegistryAnchor(inception.event, {
        db: this.hby.db,
        issuer: rip.issuer!,
        number: anchor?.[0],
        diger: anchor?.[1],
      })
    ) {
      throw new RootDeferred("registry is not yet anchored in the local issuer KEL");
    }
    return rip;
  }

  /** Raise ValidationError for malformed or self-addressed copy identities. */
  private static identities(sender: unknown, recipient: unknown, gid: unknown, registry: unknown): void {
    for (const aid of [sender, recipient, gid]) canonical(aid, Prefixer);
    canonical(registry, Saider);
    if (sender === recipient) throw new ValidationError("registry root sender and recipient must differ");
  }

  /**
   * Raise ValidationError unless this KEL/TEL state authorizes the copy.
   * RootDeferred (a RootUnverified) means only local state is missing: sender,
   * recipient or holder key state, an unaccepted group rotation that adds the
   * recipient, or the registry TEL.
   */
  authorize(sender: string, recipient: string, gid: string, registry: string): SerderACDC {
    RegistryRoot.identities(sender, recipient, gid, registry);
    const db = this.hby.db;
    const missing = [sender, recipient, gid].filter((aid, index, all) => all.indexOf(aid) === index)
      .filter(aid => !db.getKever(aid));
    if (missing.length) throw new RootDeferred(`key state is not yet local for ${missing.join(", ")}`);
    if (!ED25519.has(db.getKever(recipient)!.verfers[0]?.code ?? "")) {
      throw new ValidationError("recipient encryption requires a current Ed25519 key");
    }
    if (recipient !== gid && !this.current(recipient, gid)) {
      if (this.prospective(recipient, gid)) {
        throw new RootDeferred("the holder rotation that adds the recipient is not yet accepted");
      }
      throw new ValidationError("recipient is not a current signing member of the holder");
    }
    const rip = this.registry(registry), issuer = rip.issuer!;
    if (!(this.historical(sender, gid) || sender === issuer || this.historical(sender, issuer))) {
      throw new ValidationError("sender is not a historical holder member or registry issuer");
    }
    return rip;
  }

  /**
   * Return current signing member AIDs added by one accepted group rotation.
   *
   * Members, not keys, are compared: a continuing member usually rotates its
   * own key, so it contributes to both establishments. Candidates are the AIDs
   * with accepted key state in this Habery.
   */
  newcomers(ghab: Hab, rotation: string): string[] {
    const db = this.hby.db, pre = ghab.pre;
    if (!pre || ghab.db !== db || !isLocalGroupHab(this.hby, ghab)) {
      throw new ValidationError("newcomers require a local group habitat");
    }
    const event = db.getEvtSerder(pre, rotation);
    if (!event || !["rot", "drt"].includes(event.ilk!) || db.kels.getLast(pre, event.sn!) !== rotation) {
      throw new ValidationError("newcomers require an accepted group rotation");
    }
    let prior: SerderKERI | null = null;
    for (const [, sn, said] of db.kels.getOnItemBackIter(pre, event.sn! - 1)) {
      if (db.kels.getLast(pre, sn) !== said) continue;
      const candidate = db.getEvtSerder(pre, said);
      if (candidate?.estive) {
        prior = candidate;
        break;
      }
    }
    if (!prior) throw new ValidationError("rotation has no accepted prior establishment");
    const found: [number, string][] = [];
    for (const [keys] of db.states.getTopItemIter()) {
      const aid = keys.join(".");
      if (aid === pre || !db.getKever(aid)) continue;
      const added = contribution(db, aid, event.verfers);
      if (added && !contribution(db, aid, prior.verfers) && this.current(aid, pre)) found.push([added.index, aid]);
    }
    return found.sort((left, right) => left[0] - right[0]).map(([, aid]) => aid);
  }

  /** Return the current signing member AIDs of `gid` known to this Habery. */
  members(gid: string): string[] {
    const db = this.hby.db, gkever = db.getKever(gid), found: [number, string][] = [];
    if (!gkever) return [];
    for (const [keys] of db.states.getTopItemIter()) {
      const aid = keys.join(".");
      const contributed = aid === gid ? null : contribution(db, aid, gkever.verfers);
      if (contributed) found.push([contributed.index, aid]);
    }
    return found.sort((left, right) => left[0] - right[0]).map(([, aid]) => aid);
  }

  /** Return the registry SAIDs with a root retained locally for `gid`. */
  held(gid: string): string[] {
    const found: string[] = [];
    for (const [keys] of this.hby.mgr.ks.rroots.getTopItemIter()) {
      if (keys[0] === gid && keys.length === 2) found.push(keys[1]);
    }
    return found.sort();
  }

  /** True when `ghab`'s local member is the elected sender for `rotation`. */
  witnesser(ghab: Hab, rotation: string): boolean {
    const db = this.hby.db, event = ghab.pre ? db.getEvtSerder(ghab.pre, rotation) : null;
    if (!event) return false;
    const selection = groupWitnesserSelection(db, ghab.pre!, { sn: event.sn!, said: rotation });
    const member = db.getHab(ghab.pre!)?.mid;
    if (!selection || !member) return false;
    return contribution(db, member, selection.establishment.verfers)?.index === selection.index;
  }

  // sending

  /**
   * Return one authorized copy of a root held locally for `gid` or the issuer.
   * `hab` is the local individual sender. `event` defaults to the registry's
   * accepted BUP head.
   */
  prepare(
    hab: Hab,
    recipient: string,
    gid: string,
    registry: string,
    { event, td }: { event?: string; td?: string } = {},
  ): Uint8Array {
    const rip = this.authorize(hab.pre!, recipient, gid, registry);
    let root: Salter | null = null;
    for (const holder of [gid, rip.issuer!]) {
      if (this.hby.habs.has(holder)) {
        root = this.hby.mgr.getRegistryRoot(holder, registry);
        if (root) break;
      }
    }
    if (!root) throw new ValidationError("no local root is held for this registry");
    const [bup] = this.event(registry, event ?? this.rgy.store.headEvent(registry)!.said!, rip);
    return rootExn(hab, recipient, gid, registry, root, { event: bup.said!, td });
  }

  // receiving

  /** Recheck exact accepted BUP membership and issuer anchoring; return the BUP and its ordinal. */
  private event(registry: string, said: string, rip?: SerderACDC): [SerderACDC, bigint] {
    const store = this.rgy.store, body = store.event(said);
    const update = body && validateUpdate(body, registry);
    if (
      !body || body.said !== said || update?.kind !== "valid" || update.event.sn > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new RootUnverified("root verification requires an accepted registry BUP");
    }
    if (store.seqSaider(registry, Number(update.event.sn))?.qb64 !== said) {
      throw new RootUnverified("root verification BUP is not accepted");
    }
    const inception = rip ?? store.seqEvent(registry, 0), anchor = store.anchor(said);
    if (
      !inception || !verifyRegistryAnchor(update.event, {
        db: this.hby.db,
        issuer: inception.issuer!,
        number: anchor?.[0],
        diger: anchor?.[1],
      })
    ) {
      throw new RootUnverified("root verification BUP lacks accepted issuer anchoring");
    }
    return [body, update.event.sn];
  }

  /**
   * Check the outer exchange and authorize it; return [recipient hab, gid, rd].
   * Raises ValidationError for a copy that can never be retained here and
   * RootDeferred when only local KEL, TEL or group state is missing.
   */
  private scope(serder: SerderKERI, essr: Uint8Array): [Hab, string, string] {
    const sad = serder.sad ?? {}, data = sad.a;
    if (
      serder.pvrsn.major !== 2 || serder.pvrsn.minor !== 0 || serder.ilk !== "exn" || sad.r !== RegistryRoot.Route
      || sad.x || sad.p || (sad.q && (typeof sad.q !== "object" || Object.keys(sad.q).length))
      || !data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).sort().join() !== "essr,gid,rd"
      || Object.values(data).some(value => typeof value !== "string")
    ) {
      throw new ValidationError("invalid registry root exchange");
    }
    const { essr: commitment, gid, rd: registry } = data as Record<string, string>;
    const recipient = sad.ri;
    const hab = typeof recipient === "string" ? this.hby.habs.get(recipient) : undefined;
    if (!hab || isLocalGroupHab(this.hby, hab)) {
      throw new ValidationError("registry root recipient is not a local individual habitat");
    }
    const holder = this.hby.habs.get(gid);
    if (gid !== recipient && holder && this.hby.db.getHab(gid)?.mid !== recipient) {
      throw new ValidationError("registry root holder is not this member's local group");
    }
    if (!essr.length) throw new ValidationError("registry root exchange requires an ESSR payload");
    if (!RegistryRoot.essrMatches(commitment, essr)) {
      throw new ValidationError("ESSR payload does not match its digest");
    }
    if (gid !== recipient && !holder) {
      RegistryRoot.identities(serder.pre, recipient, gid, registry);
      throw new RootDeferred("the holder group habitat is not yet local");
    }
    this.authorize(serder.pre!, recipient as string, gid, registry);
    return [hab, gid, registry];
  }

  /** True when `commitment` is the canonical Blake3-256 digest of the sealed box. */
  static essrMatches(commitment: string, essr: Uint8Array): boolean {
    let digest: Diger;
    try {
      digest = canonical(commitment, Diger);
    } catch (error) {
      if (error instanceof ValidationError) return false;
      throw error;
    }
    return digest.code === MtrDex.Blake3_256 && digest.verify(essr);
  }

  /**
   * Store authorized or deferred copies once; refuse the rest; never decrypt here.
   *
   * A stored SAID is ignored while it is escrowed or its holder already retains
   * a root for that registry. Otherwise an identical resend falls through and
   * `handle` escrows it again.
   */
  verify(args: { serder: SerderKERI; essrs?: readonly Texter[] }): boolean {
    const said = args.serder.said!;
    if (this.hby.db.exns.get([said]) && (this.hby.db.rrpe.get([said]) || this.retains(args.serder))) return false;
    try {
      this.scope(args.serder, essrBytes(args.essrs));
    } catch (error) {
      if (error instanceof RootDeferred) return true;
      if (error instanceof ValidationError) return false;
      throw error;
    }
    return true;
  }

  /** True when the copy's holder already retains a root for its registry; never decrypts. */
  private retains(serder: SerderKERI): boolean {
    const data = serder.sad?.a;
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const { gid, rd } = data as Record<string, unknown>;
    return typeof gid === "string" && typeof rd === "string" && !!this.hby.mgr.ks.rroots.get([gid, rd]);
  }

  /** Escrow the stored copy and retain its root now when it verifies. */
  handle(args: { serder: SerderKERI; essrs?: readonly Texter[] }): void {
    const said = args.serder.said!;
    this.hby.db.rrpe.put([said], new Dater({ dts: makeNowIso8601() }));
    this.attempt(said);
  }

  private stored(said: string): [SerderKERI, Uint8Array] {
    const serder = this.hby.db.exns.get([said]);
    if (!serder || serder.route !== RegistryRoot.Route) throw new ValidationError("no stored registry root copy");
    return [serder, essrBytes(this.hby.db.getEssrs(said))];
  }

  /** Return [gid, rd, root, plaintext] after decrypting and binding the box. */
  private open(serder: SerderKERI, essr: Uint8Array): [string, string, Salter, RootPlaintext] {
    const [hab, gid, registry] = this.scope(serder, essr);
    try {
      hab.mgr.requireRegistryRootAccess();
    } catch (error) {
      if (error instanceof ValidationError) throw new RootUnverified(error.message, { cause: error });
      throw error;
    }
    let plain: unknown;
    try {
      const opened = hab.mgr.open(essr, hab.kever!.verfers[0]);
      if (!opened) throw new Error("unopened");
      plain = JSON.parse(new TextDecoder().decode(opened));
    } catch {
      throw new RootRefused("registry root cannot be decrypted with the current recipient key; resend needed");
    }
    const fields = plain && typeof plain === "object" && !Array.isArray(plain)
      ? plain as Record<string, unknown>
      : null;
    if (
      !fields || PLAIN_REQUIRED.some(key => !(key in fields))
      || Object.keys(fields).some(key => !PLAIN_ALLOWED.has(key))
      || Object.values(fields).some(value => typeof value !== "string")
      || fields.i !== serder.pre || fields.ri !== hab.pre || fields.gid !== gid || fields.rd !== registry
    ) {
      throw new RootRefused("registry root plaintext does not match its exchange");
    }
    let root: Salter;
    try {
      root = canonical(fields.s, Salter);
    } catch {
      throw new RootRefused("registry root is not a canonical Salt128");
    }
    if (root.code !== MtrDex.Salt_128) throw new RootRefused("registry root is not a canonical Salt128");
    return [gid, registry, root, fields as unknown as RootPlaintext];
  }

  /**
   * Verify one stored copy and retain its root; return true when newly retained.
   *
   * Throws RootUnverified (or its RootDeferred) while the copy may still verify
   * later, and RootRefused or another ValidationError when it never can be
   * retained here.
   */
  private accept(said: string, { event, opening }: { event?: string; opening?: RegistryDisclosure } = {}): boolean {
    const [serder, essr] = this.stored(said);
    let opened: [string, string, Salter, RootPlaintext];
    try {
      opened = this.open(serder, essr);
    } catch (error) {
      if (error instanceof RootDeferred) {
        throw new RootDeferred(
          `registry root copy is not yet verifiable: ${error.message}; it stays pending until that state is local`,
        );
      }
      throw error;
    }
    const [gid, registry, root, plain] = opened;
    const [bup, sn] = this.event(registry, event ?? plain.e);
    const blid = bup.sad!.b as string;
    const uuid = makeBlindUuid({ salt: root.qb64, sn });
    const held = opening ?? this.rgy.store.publicOpening(bup.said!);
    if (held) {
      if (!vetBlind(held, blid)) throw new ValidationError("held opening does not match the registry commitment");
      if (held.u.qb64 !== uuid.qb64) throw new RootUnverified("root does not reproduce the held opening");
    } else if (!this.reproduces(blid, uuid.qb64, plain.td ?? "", gid)) {
      throw new RootUnverified("root does not yet reproduce the registry commitment");
    }
    const retained = this.hby.mgr.getRegistryRoot(gid, registry);
    if (retained && retained.qb64 !== root.qb64) {
      throw new RootRefused("a different root is already retained for this holder and registry");
    }
    const added = this.hby.mgr.putRegistryRoot(gid, registry, root);
    this.hby.db.rrpe.rem([said]);
    if (added && this.notifier) {
      this.notifier.add({
        r: RegistryRoot.Note,
        d: said,
        i: serder.pre!,
        ri: serder.sad!.ri as string,
        gid,
        rd: registry,
      });
    }
    return added;
  }

  /** Try one escrowed copy: true retained, null still pending, false dropped. */
  private attempt(said: string): boolean | null {
    try {
      this.accept(said);
    } catch (error) {
      if (error instanceof RootUnverified) return null;
      if (error instanceof ValidationError) {
        this.hby.db.rrpe.rem([said]);
        return false;
      }
      throw error;
    }
    return true;
  }

  /**
   * Retry every escrowed copy; drop refused ones. The Exchanger
   * calls this from its own `processEscrows` when this handler is registered,
   * so ordinary escrow loops drive it.
   */
  processEscrows(): void {
    for (const [keys] of [...this.hby.db.rrpe.getTopItemIter()]) this.attempt(keys.join("."));
  }

  /**
   * Manually retry one stored copy with an optional BUP and held opening.
   *
   * Retention is automatic; use this only to supply evidence the copy lacks:
   * `event` overrides the sender's BUP hint and `opening` is a held opening for
   * that BUP. Without one, a held public opening in the registry store is used,
   * else the BUP `b` commitment is reproduced from `(uuid, td, ts)` using the
   * sender's `td` hint. Returns true on retention. RootRefused marks a copy that
   * can never be retained and drops it from escrow; RootUnverified leaves it as
   * it was; its RootDeferred subclass names the local state still missing.
   */
  receive(said: string, { event, opening }: { event?: string; opening?: RegistryDisclosure } = {}): boolean {
    try {
      this.accept(said, { event, opening });
    } catch (error) {
      if (error instanceof ValidationError && !(error instanceof RootUnverified)) this.hby.db.rrpe.rem([said]);
      throw error;
    }
    return true;
  }

  private reproduces(blid: string, uuid: string, td: string, gid: string): boolean {
    const states = [...RegistryRoot.States];
    if (unblindBlindState({ said: blid, uuid, acdc: td, states })) return true;
    const db = this.hby.db, kever = db.getKever(gid), bounds: [number, string][] = [];
    for (let sn = 0; kever && sn <= kever.sn; sn++) {
      const dig = db.kels.getLast(gid, sn);
      if (dig) bounds.push([sn, dig]);
    }
    return unblindBoundState({ said: blid, uuid, acdc: td, states, bounds }) !== null;
  }

  /** List escrowed copies awaiting automatic retention, without decrypting. */
  pending(): PendingRootCopy[] {
    const items: PendingRootCopy[] = [];
    for (const [keys, escrowed] of this.hby.db.rrpe.getTopItemIter()) {
      const said = keys.join("."), serder = this.hby.db.exns.get([said]);
      if (!serder) continue;
      const data = (serder.sad?.a ?? {}) as Record<string, string>;
      items.push({
        said,
        sender: serder.pre!,
        recipient: serder.sad?.ri as string,
        gid: data.gid,
        registry: data.rd,
        dt: serder.sad?.dt as string,
        escrowed: escrowed.dts,
      });
    }
    return items;
  }
}
