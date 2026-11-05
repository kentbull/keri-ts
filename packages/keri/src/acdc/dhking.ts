/**
 * Python's local IPEX DHKE profile, carried by KERI/CESR v2. The HKDF profile
 * itself is not a KERI standard. Consent and ephemeral keys are process-local;
 * only completed Salt128 roots enter the encrypted Keeper.
 */
import {
  bytesEqual,
  type CesrFrame,
  type Cigar,
  type Diger,
  Kinds,
  makeBlindUuid,
  Matter,
  MtrDex,
  parseAttachmentGroup,
  ParserError,
  Prefixer,
  Saider,
  Salter,
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
import { isLocalGroupHab } from "../app/multisig/group-members.ts";
import type { AuxiliaryQueryProcessor, MessageDropDecision } from "../app/protocol/parsering.ts";
import { Deck } from "../core/deck.ts";
import type { KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { verifyQueryAttachments } from "../core/exchange/exchange-proofing.ts";
import { query, reply } from "../core/protocol-eventing.ts";
import { type ReplyProcessDecision, unverifiedReplyDecision } from "../core/routing.ts";
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
  completed: boolean;
  abandoned: boolean;
}

/** Application-owned delivery of an already authenticated, signed reply. */
export interface DhkeOutgoing {
  kin: "reply";
  dest: string;
  msg: Uint8Array;
}

/**
 * Individual issuer/issuee DH for an explicitly approved pending Grant. Wire
 * intake cannot approve work. Inject as ProtocolProcessor.qvy and register on
 * Revery's existing Router at Route. Full proofs remain owned by KRAM/Revery.
 * Groups require a later custodian/contribution implementation and refuse here.
 */
export class Dhke implements AuxiliaryQueryProcessor {
  static readonly Route = "/ipex/dhke";
  readonly outgoing = new Deck<DhkeOutgoing>();
  private readonly operations = new Map<string, DhkeOperation>();
  readonly hab: Hab;
  readonly exc: Exchanger;
  readonly registryStore: RegistryStore;

  /** Bind concrete local owners; construction grants no consent and writes nothing. */
  constructor({ hab, exc, registryStore }: { hab: Hab; exc: Exchanger; registryStore: RegistryStore }) {
    if (
      !(hab instanceof Hab) || hab.db !== exc.hby.db || exc.hby.habs.get(hab.pre!) !== hab
      || isLocalGroupHab(exc.hby, hab)
    ) throw new ValidationError("DH requires a local individual signing habitat");
    this.hab = hab;
    this.exc = exc;
    this.registryStore = registryStore;
  }

  /** Select one live fresh issuance and freeze its exact bodies, parties and registry order. */
  approve(grant: string): string {
    this.hab.mgr.requireRegistryRootAccess();
    for (const op of this.operations.values()) {
      if (op.grant === grant) {
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
      completed: false,
      abandoned: false,
    };
    this.roots(op);
    this.operations.set(xid, op);
    return xid;
  }

  /** Return the same signed issuer query on every retry; no automatic delivery occurs. */
  start(grant: string): Uint8Array {
    const op = this.operation(this.approve(grant));
    if (this.hab.pre !== op.issuer) throw new ValidationError("Only the issuer starts DH");
    this.roots(op);
    if (!op.query) {
      this.generate(op);
      op.query = this.hab.endorse(
        query(Dhke.Route, { x: op.xid, pk: op.publicKeys }, {
          pre: this.hab.pre,
          replyRoute: Dhke.Route,
          pvrsn: Vrsn_2_0,
          kind: Kinds.json,
        }),
        { gvrsn: Vrsn_2_0 },
      );
    }
    return op.query.slice();
  }

  /** Independently authenticate the full issuer threshold, even when KRAM is disabled. */
  processQuery(envelope: KeriDispatchEnvelope): { kind: "accept" } | MessageDropDecision {
    try {
      const { serder } = envelope;
      if (serder.ilk !== "qry" || serder.sad!.rr !== Dhke.Route) throw new ValidationError("Invalid DH query");
      const { op, peer } = this.preflight(serder, "q", "issuee");
      if (!verifyQueryAttachments(this.hab.db, envelope)) {
        return { kind: "drop", reason: "missingAuthentication" };
      }
      if (!op.reply) {
        this.generate(op);
        const roots = this.derive(op, peer, "issuee");
        const signed = this.hab.endorse(
          reply(Dhke.Route, { x: op.xid, pk: op.publicKeys }, {
            pre: this.hab.pre!,
            pvrsn: Vrsn_2_0,
            kind: Kinds.json,
          }),
          { gvrsn: Vrsn_2_0 },
        );
        this.retain(op, peer, roots);
        op.reply = signed;
      }
      this.outgoing.push({ kin: "reply", dest: op.issuer, msg: op.reply.slice() });
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
      const { op, peer } = this.preflight(serder, "a", "issuer");
      if (!op.query) throw new ValidationError("DH reply has no outstanding query");
      const decision = this.hab.rvy.acceptReply({ serder, saider: diger, route, aid: op.issuee, cigars, tsgs });
      if (decision.kind !== "accept") return decision;
      if (!op.completed) this.retain(op, peer, this.derive(op, peer, "issuer"));
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
    return yield* this.exc.processEvent(input);
  }

  /** Drop local ephemeral key references and permanently refuse this operation. */
  abandon(xid: string): void {
    const op = this.operation(xid);
    this.clearPrivate(op);
    op.abandoned = true;
  }

  private operation(xid: string): DhkeOperation {
    const op = this.operations.get(xid);
    if (!op) throw new ValidationError("DH transaction has no local approval");
    return op;
  }

  private pending(op: DhkeOperation): ExchangeInput {
    this.hab.mgr.requireRegistryRootAccess();
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

  private preflight(serder: SerderKERI, field: "q" | "a", role: "issuer" | "issuee") {
    const data = serder.sad?.[field];
    if (
      !serder.verify() || serder.pvrsn.major !== 2 || serder.pvrsn.minor !== 0 || serder.route !== Dhke.Route
      || !data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).sort().join() !== "pk,x" || !("x" in data) || typeof data.x !== "string"
      || !("pk" in data) || !data.pk || typeof data.pk !== "object" || Array.isArray(data.pk)
    ) {
      throw new ValidationError("Invalid DH message shape");
    }
    const op = this.operation(data.x);
    this.live(op);
    if (this.hab.pre !== op[role] || serder.pre !== op[role === "issuer" ? "issuee" : "issuer"]) {
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
    if (op.peer && op.registries.some((registry) => op.peer![registry] !== peer[registry])) {
      throw new ValidationError("Conflicting DH public keys");
    }
    this.roots(op);
    return { op, peer };
  }

  private generate(op: DhkeOperation): void {
    if (op.privateKeys.size) return;
    for (const registry of op.registries) {
      const { privateKey, publicKey } = generateKeyPair();
      op.privateKeys.set(registry, privateKey);
      op.publicKeys[registry] = publicKey;
    }
  }

  private derive(op: DhkeOperation, peer: Record<string, string>, role: "issuer" | "issuee"): Map<string, Salter> {
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
  }

  private clearPrivate(op: DhkeOperation): void {
    for (const key of op.privateKeys.values()) key.fill(0);
    op.privateKeys.clear(); // Best effort for owned arrays only; not a process-erasure guarantee.
  }
}
