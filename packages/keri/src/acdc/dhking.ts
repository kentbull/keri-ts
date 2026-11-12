/**
 * Python's local IPEX DHKE profile, carried by KERI/CESR v2. The HKDF profile
 * itself is not a KERI standard. Consent and ephemeral keys are process-local;
 * only completed Salt128 roots enter the encrypted Keeper.
 */
import {
  bytesEqual,
  type CesrFrame,
  type Cigar,
  concatBytes,
  Counter,
  type Diger,
  Kinds,
  makeBlindUuid,
  Matter,
  MtrDex,
  parseAttachmentGroup,
  parseBytes,
  ParserError,
  Prefixer,
  Saider,
  Salter,
  SealLast,
  type SerderKERI,
  unblindBlindState,
  Vrsn_2_0,
  x25519PublicKey,
  x25519SharedSecret,
} from "cesr-ts";
import type { Operation } from "effection";
import { hkdf } from "npm:@noble/hashes@1.8.0/hkdf";
import { sha256 } from "npm:@noble/hashes@1.8.0/sha2";
import type { ExchangeDecision, ExchangeInput, Exchanger } from "../app/exchanges/exchanging.ts";
import { Hab } from "../app/identity/habbing.ts";
import {
  type GroupCoordinator,
  groupWitnesserSelection,
  isLocalGroupHab,
  latestGroupContribution,
  localGroupMember,
} from "../app/multisig/group-members.ts";
import {
  type AuxiliaryQueryProcessor,
  copyAuxiliaryQuery,
  envelopeFromFrame,
  type MessageDropDecision,
} from "../app/protocol/parsering.ts";
import { Deck } from "../core/deck.ts";
import type { KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { verifyQueryAttachments } from "../core/exchange/exchange-proofing.ts";
import { Kever } from "../core/kel/kever.ts";
import { query, reply } from "../core/protocol-eventing.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { fetchStoredTsgs, type ReplyProcessDecision, type Revery, unverifiedReplyDecision } from "../core/routing.ts";
import type { Baser } from "../db/basing.ts";
import { timestampMicros } from "../time/mod.ts";
import { validateUpdate, verifyRegistryAnchor } from "./regeventing.ts";
import { publicOpeningAttachment, type RegistryStore } from "./registering.ts";

const domain = new TextEncoder().encode("KERI/ipex/dhke/X25519-HKDF-SHA256-Salt128/v1");

/** Exact context bound by the Python HKDF profile. XID can differ from Grant SAID. */
export interface DhkeContext {
  role: "issuer" | "issuee";
  xid: string;
  grant: string;
  registry: string;
  issuer: string;
  issuee: string;
  issuerPublicKey: string;
  issueePublicKey: string;
}

/** Parse exactly one qualified primitive; decoder failures are caller-input refusals here. */
function canonical<T extends Matter>(value: unknown, ctor: new(args: { qb64: string }) => T): T {
  if (typeof value !== "string" || !value) throw new ValidationError("Expected canonical CESR material");
  try {
    const material = new ctor({ qb64: value });
    if (new Matter({ raw: material.raw, code: material.code }).qb64 !== value) {
      throw new ValidationError("Noncanonical or trailing CESR material");
    }
    return material;
  } catch (error) {
    if (error instanceof ParserError) throw new ValidationError("Invalid CESR material", { cause: error });
    throw error;
  }
}

/** Decode canonical CESR C public material; the agreement primitive checks contribution. */
export function decodePublicKey(value: unknown): Uint8Array {
  const key = canonical(value, Matter);
  if (key.code !== MtrDex.X25519 || key.raw.length !== 32) throw new ValidationError("Expected X25519 public key");
  return key.raw;
}

/** Generate a fresh agreement scalar, independent of every signing key. */
export function generateKeyPair(): { privateKey: Uint8Array; publicKey: string } {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  return { privateKey, publicKey: new Matter({ raw: x25519PublicKey(privateKey), code: MtrDex.X25519 }).qb64 };
}

/** Derive one Salt128; malformed context, wrong local keys and low-order peers refuse. */
export function deriveRoot(privateKey: Uint8Array, context: DhkeContext): Salter {
  const { role, xid, grant, registry, issuer, issuee, issuerPublicKey, issueePublicKey } = context;
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32 || !["issuer", "issuee"].includes(role)) {
    throw new ValidationError("Expected role and 32-byte ephemeral private key");
  }
  for (const value of [xid, grant, registry]) canonical(value, Saider);
  for (const value of [issuer, issuee]) canonical(value, Prefixer);
  const issuerKey = decodePublicKey(issuerPublicKey), issueeKey = decodePublicKey(issueePublicKey);
  const own = role === "issuer" ? issuerKey : issueeKey, peer = role === "issuer" ? issueeKey : issuerKey;
  if (!bytesEqual(x25519PublicKey(privateKey), own)) throw new ValidationError("Local ephemeral key mismatch");
  const shared = x25519SharedSecret(privateKey, peer);
  if (!shared) throw new ValidationError("Noncontributory X25519 public key");
  const parts = [
    domain,
    ...[xid, grant, registry, issuer, issuee, issuerPublicKey, issueePublicKey]
      .map((value) => new TextEncoder().encode(value)),
  ];
  const info = new Uint8Array(parts.reduce((size, part) => size + 4 + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    new DataView(info.buffer).setUint32(offset, part.length, false);
    info.set(part, offset + 4);
    offset += 4 + part.length;
  }
  try {
    return new Salter({ raw: hkdf(sha256, shared, sha256(domain), info, 16), code: MtrDex.Salt_128 });
  } finally {
    shared.fill(0);
  }
}

interface DhkeOperation {
  xid: string;
  grant: string;
  raw: Uint8Array;
  bodies: Uint8Array[];
  issuer: string;
  issuee: string;
  registries: readonly string[];
  privateKeys: Map<string, Uint8Array>;
  publicKeys: Record<string, string>;
  peer: Record<string, string> | null;
  query: Uint8Array | null;
  reply: Uint8Array | null;
  proposal: Uint8Array | null;
  contribution: Uint8Array | null;
  custody: {
    coordinator: GroupCoordinator;
    custodian: string;
    establishment: string;
    index: number;
    key: string;
  } | null;
  completed: boolean;
  abandoned: boolean;
}

/** Group consent names its own accepted coordinator and elected member; individuals omit both. */
export interface DhkeApproval {
  coordinator?: GroupCoordinator;
  custodian?: string;
}

/** Delivery of signed wire; sign asks members to review/contribute, never authorizes them. */
export interface DhkeOutgoing {
  kin: "query" | "reply" | "sign";
  dest: string;
  msg: Uint8Array;
}

/**
 * The group custodian just retained these registries' roots for `gid`; every other
 * current member should receive a sealed copy (KERIpy's `replicate` cue). It carries
 * coordinates only, never a root. It is a separate deck from `outgoing` because it is
 * not wire: a drainer that sends every `outgoing` item would send it.
 */
export interface DhkeReplicate {
  gid: string;
  registries: string[];
}

/**
 * Issuer/issuee DH for an explicitly approved pending Grant. Wire
 * intake cannot approve work. Inject as ProtocolProcessor.qvy and register on
 * Revery's existing Router at Route. Full proofs remain owned by KRAM/Revery.
 * A group freezes its own accepted coordinator/custodian at approval. Members
 * contribute ordinary signatures; only the custodian generates or retains keys,
 * after own complete query/reply intake through the same threshold owners.
 */
export class Dhke implements AuxiliaryQueryProcessor {
  static readonly Route = "/ipex/dhke";
  readonly resource = Dhke.Route;
  readonly outgoing = new Deck<DhkeOutgoing>();
  /** Completion cues for roots just retained by this group's custodian; feed `RootReplicator.replicate`. */
  readonly replicated = new Deck<DhkeReplicate>();
  private readonly pendingQueries = new Map<
    string,
    { envelope: KeriDispatchEnvelope; expires: bigint; grant: string }
  >();
  private readonly now: () => number;
  private readonly operations = new Map<string, DhkeOperation>();
  readonly hab: Hab;
  readonly exc: Exchanger;
  readonly rvy: Revery;
  readonly registryStore: RegistryStore;
  readonly group: boolean;

  /** Bind concrete local owners; construction grants no consent and writes nothing. */
  constructor({ hab, exc, registryStore, rvy = hab.rvy, now = Date.now }: {
    hab: Hab;
    exc: Exchanger;
    registryStore: RegistryStore;
    rvy?: Revery;
    now?: () => number;
  }) {
    if (
      !(hab instanceof Hab) || hab.db !== exc.hby.db || rvy.db !== hab.db
      || exc.hby.habs.get(hab.pre!) !== hab
    ) throw new ValidationError("DH requires a local signing habitat");
    this.now = now;
    this.hab = hab;
    this.exc = exc;
    this.rvy = rvy;
    this.registryStore = registryStore;
    this.group = isLocalGroupHab(exc.hby, hab);
    if (this.group && !(localGroupMember(exc.hby, hab.pre!) instanceof Hab)) {
      throw new ValidationError("DH requires a local signing member");
    }
  }

  /** Select one live fresh issuance and freeze its exact bodies, parties and registry order. */
  approve(grant: string, { coordinator, custodian }: DhkeApproval = {}): string {
    this.pruneQueries();
    this.hab.mgr.requireRegistryRootAccess();
    for (const op of this.operations.values()) {
      if (op.grant === grant) {
        if (
          (coordinator
            && (coordinator.sn !== op.custody?.coordinator.sn || coordinator.said !== op.custody?.coordinator.said))
          || (custodian !== undefined && custodian !== op.custody?.custodian)
        ) {
          throw new ValidationError("DH coordinator and custodian are already frozen");
        }
        this.live(op);
        return op.xid;
      }
    }
    const input = this.exc.retainedInput(grant, { pending: true });
    if (!input) throw new ValidationError("DH requires an authenticated pending Grant");
    const message = input.serder, issuer = message.pre!, issuee = message.sad!.ri;
    const xid = message.ilk === "xip" ? message.said : message.sad!.x;
    if (
      typeof xid !== "string" || typeof issuee !== "string" || issuer === issuee
      || ![issuer, issuee].includes(this.hab.pre!)
    ) throw new ValidationError("Local habitat is not a DH party");
    if (this.operations.has(xid)) throw new ValidationError("Another Grant is selected for this transaction");
    const context = this.exc.pendingGrant(grant, { xid, sender: issuer, recipient: issuee });
    if (!context) throw new ValidationError("DH requires authenticated fresh registry scope");
    const op: DhkeOperation = {
      xid,
      grant,
      issuer,
      issuee,
      raw: message.raw.slice(),
      bodies: (input.nests ?? []).map((nest) => nest.body.raw.slice()),
      registries: [...context.registries],
      privateKeys: new Map(),
      publicKeys: {},
      peer: null,
      query: null,
      reply: null,
      proposal: null,
      contribution: null,
      custody: null,
      completed: false,
      abandoned: false,
    };
    if (this.group) {
      if (!coordinator || !custodian) {
        throw new ValidationError("Group DH requires its own accepted coordinator and custodian");
      }
      const selected = groupWitnesserSelection(this.hab.db, this.hab.pre!, coordinator);
      if (!selected) throw new ValidationError("Group coordinator lacks accepted threshold evidence");
      op.custody = {
        coordinator: { ...coordinator },
        custodian,
        establishment: selected.establishment.said!,
        index: selected.index,
        key: selected.establishment.verfers[selected.index].qb64,
      };
      this.custody(op);
    } else if (coordinator !== undefined || custodian !== undefined) {
      throw new ValidationError("Individual DH has no group coordinator");
    }
    this.roots(op);
    this.operations.set(xid, op);
    this.replayQuery(xid);
    return xid;
  }

  /** Return the stable issuer proposal until own threshold intake supplies the complete query. */
  start(grant: string): Uint8Array {
    const op = this.operation(this.approve(grant));
    if (this.hab.pre !== op.issuer) throw new ValidationError("Only the issuer starts DH");
    this.custody(op, true);
    this.roots(op);
    if (!op.query && !op.proposal) {
      this.generate(op);
      const message = query(Dhke.Route, { x: op.xid, pk: op.publicKeys }, {
        pre: this.hab.pre,
        replyRoute: Dhke.Route,
        pvrsn: Vrsn_2_0,
        kind: Kinds.json,
      });
      const signed = this.hab.endorse(message, { gvrsn: Vrsn_2_0 });
      if (this.group) {
        op.proposal = message.raw.slice();
        op.contribution = signed;
      } else op.query = signed;
    }
    return (op.query ?? op.contribution!).slice();
  }

  /**
   * Re-sign this issuer's started individual query for delivery now.
   *
   * KERIpy `Dhke.requery` (kentbull/keripy#159): a queued query can age past the
   * issuee's KRAM timeliness window before transport begins. The renewal keeps
   * the approved Grant, ephemeral keys and registry scope; only the query's own
   * `dt`, SAID and signatures change, and it becomes the outstanding query. It
   * never extends the Grant's exchange deadline. A group threshold query needs
   * a new member proposal, so groups cannot renew here.
   */
  requery(xid: string): Uint8Array {
    const op = this.operation(xid);
    if (this.group) throw new ValidationError("one group member cannot renew a threshold DH query");
    if (this.hab.pre !== op.issuer || !op.query) throw new ValidationError("DH has no started issuer query");
    this.live(op);
    this.roots(op);
    if (op.completed) throw new ValidationError("DH operation has already completed");
    const message = query(Dhke.Route, { x: op.xid, pk: op.publicKeys }, {
      pre: this.hab.pre,
      replyRoute: Dhke.Route,
      pvrsn: Vrsn_2_0,
      kind: Kinds.json,
    });
    op.query = this.hab.endorse(message, { gvrsn: Vrsn_2_0 });
    return op.query.slice();
  }

  /** Explicitly sign one exact custodian proposal; partial proof authorizes review, never DH. */
  contribute(xid: string, proposal: Uint8Array): Uint8Array {
    if (!this.group) throw new ValidationError("DH contribution requires a local group member");
    const frames = parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), proposal));
    if (frames.length !== 1) throw new ValidationError("DH proposal must be one signed query or reply");
    const parsed = envelopeFromFrame(frames[0]), message = parsed.serder;
    const allowed = ["ControllerIdxSigs", "TransIdxSigGroups", "TransLastIdxSigGroups"];
    if (
      !["qry", "rpy"].includes(message.ilk!) || parsed.essrs?.length || parsed.nests.length
      || parsed.attachmentGroups.some(group => !allowed.includes(group.name.replace(/^Big/, "")))
    ) {
      throw new ValidationError("DH proposal must contain only ordinary group signatures");
    }
    const querying = message.ilk === "qry";
    const { op, peer: publicKeys } = this.preflight(
      message,
      querying ? "q" : "a",
      querying ? "issuer" : "issuee",
      true,
    );
    if (op.xid !== xid || (querying && message.sad!.rr !== Dhke.Route)) {
      throw new ValidationError("DH proposal differs from the approved transaction");
    }
    if (!querying && !op.peer) throw new ValidationError("Group reply requires its authenticated peer query");
    if (op.proposal && !bytesEqual(op.proposal, message.raw)) {
      throw new ValidationError("DH proposal body is already frozen");
    }
    const kever = this.hab.kever!;
    const signatures = [
      ...parsed.sigers,
      ...parsed.ssgs.filter(group => group.pre === this.hab.pre).flatMap(group => group.sigers),
      ...parsed.tsgs.filter(group =>
        group.pre === this.hab.pre && group.sn === BigInt(kever.lastEst.s)
        && group.said === kever.lastEst.d
      ).flatMap(group => group.sigers),
    ];
    const { indices } = Kever.verifyIndexedSignatures(message.raw, signatures, kever.verfers);
    const contribution = latestGroupContribution(this.hab.db, op.custody!.custodian, kever.verfers);
    if (!contribution || !indices.includes(contribution.index)) {
      throw new ValidationError("DH proposal lacks the frozen custodian signature");
    }
    const signed = this.hab.endorse(message, { gvrsn: Vrsn_2_0 });
    op.proposal = message.raw.slice();
    op.publicKeys = { ...publicKeys };
    op.contribution = signed;
    return signed.slice();
  }

  /** Independently authenticate the full issuer threshold, even when KRAM is disabled. */
  processQuery(envelope: KeriDispatchEnvelope): { kind: "accept" } | MessageDropDecision {
    this.pruneQueries();
    try {
      const { serder } = envelope;
      if (serder.ilk !== "qry" || serder.sad!.rr !== Dhke.Route) throw new ValidationError("Invalid DH query");
      const own = this.group && serder.pre === this.hab.pre;
      const xid = (serder.sad?.q as { x?: unknown } | undefined)?.x;
      if (!own && typeof xid === "string" && !this.operations.has(xid)) {
        this.retainQuery(envelope);
        return { kind: "accept" };
      }
      const { op, peer } = this.preflight(serder, "q", own ? "issuer" : "issuee", own);
      if (own && (!op.proposal || !bytesEqual(op.proposal, serder.raw))) {
        throw new ValidationError("Own DH query lacks exact local proposal approval");
      }
      if (!verifyQueryAttachments(this.hab.db, envelope)) {
        return { kind: "drop", reason: "missingAuthentication" };
      }
      if (own) {
        if (!op.query) {
          const tsgs = envelope.tsgs.filter(group => group.pre === this.hab.pre);
          const lasts = envelope.ssgs.filter(group => group.pre === this.hab.pre);
          op.query = messagize(serder, {
            tsgs,
            sigers: tsgs.length ? [] : lasts.length ? lasts.flatMap(group => group.sigers) : envelope.sigers,
            seal: !tsgs.length && lasts.length ? SealLast.fromTuple([lasts[0].prefixer]) : undefined,
            gvrsn: Vrsn_2_0,
          });
        }
        if (this.custody(op)) this.outgoing.push({ kin: "query", dest: op.issuee, msg: op.query.slice() });
        return { kind: "accept" };
      }
      if (this.group && !this.custody(op)) {
        op.peer = { ...peer };
        return { kind: "accept" };
      }
      if (!op.reply) {
        if (!op.proposal) {
          this.generate(op);
          const roots = this.derive(op, peer, "issuee");
          const message = reply(Dhke.Route, { x: op.xid, pk: op.publicKeys }, {
            pre: this.hab.pre!,
            pvrsn: Vrsn_2_0,
            kind: Kinds.json,
          });
          const signed = this.hab.endorse(message, { gvrsn: Vrsn_2_0 });
          if (this.group) {
            op.proposal = message.raw.slice();
            op.contribution = signed;
            op.peer = { ...peer };
          } else {
            this.retain(op, peer, roots);
            op.reply = signed;
          }
        }
        if (this.group) {
          this.outgoing.push({ kin: "sign", dest: this.hab.pre!, msg: op.contribution!.slice() });
          return { kind: "accept" };
        }
      }
      this.outgoing.push({ kin: "reply", dest: op.issuer, msg: op.reply!.slice() });
      return { kind: "accept" };
    } catch (error) {
      if (error instanceof ValidationError) return { kind: "drop", reason: "invalidQuery" };
      throw error;
    }
  }

  /** Revery decides reply threshold acceptance before any issuer derivation or retention. */
  processReply({ serder, diger, route, cigars = [], tsgs = [] }: {
    serder: SerderKERI;
    diger: Diger;
    route: string;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): ReplyProcessDecision {
    try {
      if (serder.ilk !== "rpy" || route !== Dhke.Route) throw new ValidationError("Invalid DH reply");
      const own = this.group && serder.pre === this.hab.pre;
      const { op, peer } = this.preflight(serder, "a", own ? "issuee" : "issuer", own);
      if (own && (!op.proposal || !bytesEqual(op.proposal, serder.raw) || !op.peer)) {
        throw new ValidationError("Own DH reply lacks exact local proposal approval");
      }
      if (!own && !op.query) throw new ValidationError("DH reply has no outstanding query");
      const decision = this.rvy.acceptReply({ serder, saider: diger, route, aid: op.issuee, cigars, tsgs });
      if (decision.kind !== "accept") return decision;
      if (own) {
        if (this.custody(op) && !op.completed) this.retain(op, op.peer!, this.derive(op, op.peer!, "issuee"));
        if (!op.reply) {
          op.reply = messagize(serder, {
            tsgs: fetchStoredTsgs(this.hab.db, diger.qb64).filter(group => group.pre === this.hab.pre),
            gvrsn: Vrsn_2_0,
          });
        }
        if (this.custody(op)) this.outgoing.push({ kin: "reply", dest: op.issuer, msg: op.reply.slice() });
      } else if (this.custody(op) && !op.completed) this.retain(op, peer, this.derive(op, peer, "issuer"));
      return decision;
    } catch (error) {
      if (error instanceof ValidationError) return unverifiedReplyDecision(error.message);
      throw error;
    }
  }

  /** Completion remains inspectable after BUP, while the same original Grant is live. */
  complete(xid: string): boolean {
    const op = this.operation(xid);
    this.pending(op);
    this.roots(op);
    return op.completed;
  }

  /** Recipient members may defer reply contribution until the issuer query independently authenticates. */
  hasPeerQuery(xid: string): boolean {
    const op = this.operation(xid);
    this.pending(op);
    if (this.hab.pre !== op.issuee) throw new ValidationError("Peer query readiness requires the selected issuee");
    return op.peer !== null;
  }

  /** Verify all current issued openings, then retry the exact Grant; this never authors Admit. */
  *finish(xid: string): Operation<ExchangeDecision> {
    const op = this.operation(xid), input = this.pending(op);
    if (!op.completed) throw new ValidationError("Issuance has no completed DH operation");
    this.roots(op);
    const openings: { nest: CesrFrame; opening: NonNullable<ReturnType<typeof unblindBlindState>> }[] = [];
    const found = new Set<string>();
    for (const nest of input.nests ?? []) {
      const registry = nest.body.ked?.rd;
      if (typeof registry !== "string" || !op.registries.includes(registry)) continue;
      const head = this.registryStore.headEvent(registry);
      if (!head) throw new ValidationError("Issued registry head is unavailable");
      const validated = validateUpdate(head, registry), anchor = this.registryStore.anchor(head.said!);
      if (
        validated.kind !== "valid" || !verifyRegistryAnchor(validated.event, {
          db: this.hab.db,
          issuer: op.issuer,
          number: anchor?.[0],
          diger: anchor?.[1],
        })
      ) throw new ValidationError("Issued registry head lacks accepted anchor evidence");
      const root = this.hab.mgr.getRegistryRoot(this.hab.pre!, registry)!;
      const opening = unblindBlindState({
        said: String(head.sad!.b),
        uuid: makeBlindUuid({ salt: root.qb64, sn: validated.event.sn }),
        acdc: nest.body.said!,
        states: ["issued"],
      });
      if (!opening || opening.ts.label !== "issued" || opening.td.nonce !== nest.body.said) {
        throw new ValidationError("Current registry head does not open this credential as issued");
      }
      openings.push({ nest, opening });
      found.add(registry);
    }
    if (found.size !== op.registries.length) throw new ValidationError("Approved registry scope is absent");
    for (const { nest, opening } of openings) {
      nest.attachments.push(parseAttachmentGroup(publicOpeningAttachment(opening), Vrsn_2_0, "txt").group);
    }
    return yield* this.exc.acceptPendingGrantProof(input);
  }

  /** Drop local ephemeral key references and permanently refuse this operation. */
  abandon(xid: string): void {
    const retained = this.pendingQueries.delete(xid);
    if (retained && !this.operations.has(xid)) return;
    const op = this.operation(xid);
    this.clearPrivate(op);
    op.abandoned = true;
  }

  /**
   * Whether this local habitat is the party of DH transaction `xid` with `sender`.
   *
   * Messages carry no recipient, so a per-identifier registry selects the owner by transaction:
   * an approved operation here, a stored Grant from `sender` addressed to this habitat, or, for a
   * group, its own members' contributions, which KRAM must pool before this owner consents.
   */
  inTransaction(sender: string, xid: string): boolean {
    return this.operations.has(xid) || (this.group && sender === this.hab.pre)
      || Dhke.recipients(this.hab.db, sender, xid).includes(this.hab.pre!);
  }

  /** Recipients of the pending Grants `sender` opened in DH transaction `xid`, from KRAM-accepted store rows. */
  static recipients(db: Baser, sender: string, xid: string): string[] {
    const recipients: string[] = [];
    for (const [key] of db.tmsc.getTopItemIter([sender, xid])) {
      const recipient = db.epse.get([key[2]])?.sad?.ri;
      if (typeof recipient === "string") recipients.push(recipient);
    }
    return recipients;
  }

  /** Release all process-local approvals and retry bytes; zero owned ephemeral scalar arrays. */
  close(): void {
    for (const op of this.operations.values()) this.clearPrivate(op);
    this.operations.clear();
    this.pendingQueries.clear();
    this.outgoing.clear();
    this.replicated.clear();
  }

  /** Retain public query evidence against one exact pending Grant, without creating keys or consent. */
  private retainQuery(envelope: KeriDispatchEnvelope): void {
    const query = envelope.serder, data = this.parameters(query, "q");
    if (!verifyQueryAttachments(this.hab.db, envelope)) throw new ValidationError("Unauthenticated DH query");
    const candidates = [...this.hab.db.tmsc.getTopItemIter([query.pre!, data.x])]
      .map(([key]) => this.hab.db.epse.get([key[2]]))
      .filter(grant =>
        grant && grant.pre === query.pre && grant.sad!.ri === this.hab.pre
        && this.exc.pendingGrant(grant.said!, { xid: data.x, sender: query.pre!, recipient: this.hab.pre })
      );
    if (candidates.length !== 1) throw new ValidationError("DH query has no unique authenticated pending Grant");
    const grant = candidates[0]!;
    const scope = this.exc.pendingGrant(grant.said!, { xid: data.x, sender: query.pre!, recipient: this.hab.pre })!;
    const entries = Object.entries(data.pk);
    if (entries.length !== scope.registries.length || entries.some(([regid]) => !scope.registries.includes(regid))) {
      throw new ValidationError("DH query differs from the authenticated registry scope");
    }
    for (const [, key] of entries) decodePublicKey(key);
    const expires = this.retainUntil(envelope, grant);
    const prior = this.pendingQueries.get(data.x);
    if (prior && !bytesEqual(prior.envelope.serder.raw, query.raw)) throw new ValidationError("Conflicting DH query");
    if (!prior) {
      this.pendingQueries.set(data.x, { envelope: copyAuxiliaryQuery(envelope), expires, grant: grant.said! });
    }
  }

  /** Expired evidence cannot survive another owner interaction. */
  private pruneQueries(): bigint {
    const now = BigInt(this.now()) * 1000n;
    for (const [xid, query] of this.pendingQueries) if (now >= query.expires) this.pendingQueries.delete(xid);
    return now;
  }

  /** Consume the first authenticated request only after explicit approval; never renew either clock. */
  private replayQuery(xid: string): void {
    const pending = this.pendingQueries.get(xid);
    this.pendingQueries.delete(xid);
    if (
      pending && pending.grant === this.operations.get(xid)?.grant
      && BigInt(this.now()) * 1000n < pending.expires
    ) this.processQuery(pending.envelope);
  }

  /** Bound process-local public evidence by the original query and accepted Grant lifetimes. */
  private retainUntil(envelope: KeriDispatchEnvelope, grant: SerderKERI): bigint {
    const now = this.pruneQueries();
    const cache = this.hab.db.msgc.get([envelope.serder.pre!, envelope.serder.said!]);
    const messageTime = cache && timestampMicros(cache.mdt);
    const grantTime = timestampMicros(this.exc.exchangeDeadline(grant) ?? undefined);
    if (
      !cache || this.hab.db.pmkm.get([envelope.serder.pre!, envelope.serder.said!]) || messageTime === null
      || messageTime === undefined || grantTime === null
      || !Number.isSafeInteger(cache.d) || !Number.isSafeInteger(cache.ml)
      || cache.d! < 0 || cache.ml! < 0 || !Number.isSafeInteger(cache.d! + cache.ml!)
    ) {
      throw new ValidationError("Query has no accepted original lifetime");
    }
    const queryTime = messageTime + BigInt(cache.d! + cache.ml!) * 1000n;
    const expires = queryTime < grantTime ? queryTime : grantTime;
    if (now >= expires) throw new ValidationError("Query or Grant has expired");
    return expires;
  }

  private operation(xid: string): DhkeOperation {
    const op = this.operations.get(xid);
    if (!op) throw new ValidationError("DH transaction has no local approval");
    return op;
  }

  private pending(op: DhkeOperation): ExchangeInput {
    this.hab.mgr.requireRegistryRootAccess();
    this.custody(op);
    const input = this.exc.retainedInput(op.grant, { pending: true });
    if (op.abandoned || !input || !bytesEqual(input.serder.raw, op.raw)) {
      throw new ValidationError("DH operation is unavailable, terminated or expired");
    }
    const nests = input.nests ?? [];
    if (
      nests.length !== op.bodies.length || nests.some((nest, index) => !bytesEqual(nest.body.raw, op.bodies[index]))
    ) {
      throw new ValidationError("Pending disclosure differs from the approved Grant");
    }
    return input;
  }

  private live(op: DhkeOperation): void {
    this.pending(op);
    const context = this.exc.pendingGrant(op.grant, { xid: op.xid, sender: op.issuer, recipient: op.issuee });
    if (
      !context || context.registries.length !== op.registries.length
      || context.registries.some((registry, index) => registry !== op.registries[index])
    ) {
      throw new ValidationError("DH requires authenticated fresh registry scope");
    }
  }

  private roots(op: DhkeOperation): void {
    for (const registry of op.registries) {
      if ((this.hab.mgr.getRegistryRoot(this.hab.pre!, registry) !== null) !== op.completed) {
        throw new ValidationError("Registry root conflicts with this live DH operation");
      }
    }
  }

  /** Decode only the exact DH message contract; authorization belongs to the selected operation. */
  private parameters(serder: SerderKERI, field: "q" | "a"): { x: string; pk: Record<string, unknown> } {
    const data = serder.sad?.[field];
    if (
      !serder.verify() || serder.pvrsn.major !== 2 || serder.pvrsn.minor !== 0 || serder.route !== Dhke.Route
      || !data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).sort().join() !== "pk,x" || !("x" in data) || typeof data.x !== "string"
      || !("pk" in data) || !data.pk || typeof data.pk !== "object" || Array.isArray(data.pk)
    ) {
      throw new ValidationError("Invalid DH message shape");
    }
    return data as { x: string; pk: Record<string, unknown> };
  }

  private preflight(serder: SerderKERI, field: "q" | "a", role: "issuer" | "issuee", own = false) {
    const data = this.parameters(serder, field);
    const op = this.operation(data.x);
    this.live(op);
    if (this.hab.pre !== op[role] || serder.pre !== op[own ? role : role === "issuer" ? "issuee" : "issuer"]) {
      throw new ValidationError("Wrong DH sender or local recipient");
    }
    const entries = Object.entries(data.pk), peer: Record<string, string> = {};
    if (entries.length !== op.registries.length || entries.some(([registry]) => !op.registries.includes(registry))) {
      throw new ValidationError("DH registry scope differs from the selected Grant");
    }
    for (const [registry, key] of entries) {
      decodePublicKey(key);
      peer[registry] = key as string;
    }
    if (!own && op.peer && op.registries.some((registry) => op.peer![registry] !== peer[registry])) {
      throw new ValidationError("Conflicting DH public keys");
    }
    this.roots(op);
    return { op, peer };
  }

  private generate(op: DhkeOperation): void {
    this.custody(op, true);
    if (op.privateKeys.size) return;
    for (const registry of op.registries) {
      const { privateKey, publicKey } = generateKeyPair();
      op.privateKeys.set(registry, privateKey);
      op.publicKeys[registry] = publicKey;
    }
  }

  private derive(op: DhkeOperation, peer: Record<string, string>, role: "issuer" | "issuee"): Map<string, Salter> {
    this.custody(op, true);
    // Complete the entire scope, including contributory checks, before any Keeper mutation.
    return new Map(op.registries.map((registry) => [
      registry,
      deriveRoot(op.privateKeys.get(registry)!, {
        role,
        xid: op.xid,
        grant: op.grant,
        registry,
        issuer: op.issuer,
        issuee: op.issuee,
        issuerPublicKey: role === "issuer" ? op.publicKeys[registry] : peer[registry],
        issueePublicKey: role === "issuee" ? op.publicKeys[registry] : peer[registry],
      }),
    ]));
  }

  private retain(op: DhkeOperation, peer: Record<string, string>, roots: ReadonlyMap<string, Salter>): void {
    for (const [registry, root] of roots) this.hab.mgr.putRegistryRoot(this.hab.pre!, registry, root);
    op.peer = { ...peer };
    op.completed = true;
    this.clearPrivate(op);
    // Every current member must hold every root; the custodian replicates.
    if (this.group) this.replicated.push({ gid: this.hab.pre!, registries: [...roots.keys()] });
  }

  private clearPrivate(op: DhkeOperation): void {
    for (const key of op.privateKeys.values()) key.fill(0);
    op.privateKeys.clear(); // Best effort for owned arrays only; not a process-erasure guarantee.
  }

  /** Recheck exact frozen election evidence and current membership without choosing a replacement. */
  private custody(op: DhkeOperation, requireLead = false): boolean {
    if (!this.group) return true;
    const frozen = op.custody;
    const selected = frozen && groupWitnesserSelection(this.hab.db, this.hab.pre!, frozen.coordinator);
    if (
      !frozen || !selected || selected.establishment.said !== frozen.establishment
      || !selected.indices.includes(frozen.index)
    ) throw new ValidationError("Frozen group coordinator evidence is unavailable");
    const current = this.hab.kever!.verfers, member = localGroupMember(this.exc.hby, this.hab.pre!);
    const contribution = latestGroupContribution(this.hab.db, frozen.custodian, selected.establishment.verfers);
    if (
      !contribution || contribution.index !== frozen.index || contribution.verfer.qb64 !== frozen.key
      || !latestGroupContribution(this.hab.db, frozen.custodian, current)
      || !latestGroupContribution(this.hab.db, member.pre!, current)
    ) {
      throw new ValidationError("Frozen DH custodian or local member is no longer authorized");
    }
    const elected = member.pre === frozen.custodian;
    if (requireLead && !elected) throw new ValidationError("Only the frozen DH custodian may generate or derive keys");
    return elected;
  }
}
