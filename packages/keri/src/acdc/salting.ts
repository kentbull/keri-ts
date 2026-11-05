/** Explicit encrypted copies of existing registry roots, following Python's RegistrySalt profile. */
import {
  BlindState,
  BoundState,
  bytesEqual,
  type Cigar,
  Cipher,
  type Diger,
  Encrypter,
  Kinds,
  makeBlindUuid,
  Matter,
  MtrDex,
  ParserError,
  Prefixer,
  Salter,
  type SerderKERI,
  type Verfer,
  Vrsn_2_0,
} from "cesr-ts";
import { Hab } from "../app/identity/habbing.ts";
import {
  type GroupCoordinator,
  groupWitnesserSelection,
  isLocalGroupHab,
  latestGroupContribution,
  localGroupMember,
} from "../app/multisig/group-members.ts";
import type { KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { reply } from "../core/protocol-eventing.ts";
import { type ReplyProcessDecision, unverifiedReplyDecision } from "../core/routing.ts";
import { type RegistryDisclosure, validateRip, validateUpdate, verifyRegistryAnchor, vetBlind } from "./regeventing.ts";
import type { Regery } from "./registraring.ts";

interface ReceiveApproval {
  event: string;
  opening: RegistryDisclosure;
  uuid: string;
}

/**
 * Copy a retained root only after explicit local approval and current reply
 * authentication. Register Route on the habitat's existing Revery Router;
 * composition delivers signed bytes and explicitly approves group contributions.
 * Receive approvals are process-local. Public TEL evidence is read-only, and
 * neither this owner nor restarting it creates roots, consent or transfer rows.
 */
export class RegistrySalt {
  static readonly Route = "/registry/salt";
  readonly hab: Hab;
  readonly rgy: Regery;
  readonly target: Hab;
  private readonly approvals = new Map<string, ReceiveApproval>();

  /** Bind actual local signing/decryption habitats and their registry owner. */
  constructor({ hab, rgy }: { hab: Hab; rgy: Regery }) {
    if (!(hab instanceof Hab) || hab.db !== rgy.hby.db || rgy.hby.habs.get(hab.pre!) !== hab) {
      throw new ValidationError("Registry transfer requires the habitat's actual local owners");
    }
    this.hab = hab;
    this.rgy = rgy;
    this.target = isLocalGroupHab(rgy.hby, hab) ? localGroupMember(rgy.hby, hab.pre!) : hab;
    if (!(this.target instanceof Hab) || this.target.db !== hab.db) {
      throw new ValidationError("Registry transfer requires a local signing and decryption member");
    }
  }

  /** Approve receipt using one accepted BUP and held ordinary or bound opening, never inferred state. */
  approve(registry: string, sender: string, { event, opening }: { event: string; opening: RegistryDisclosure }): void {
    this.hab.mgr.requireRegistryRootAccess();
    this.scope(registry, sender, this.hab.pre!, this.target.pre!);
    this.event(registry, event, opening);
    // Snapshot the exact primitive encodings rather than borrowing caller-owned arrays.
    const fields = [
      opening.d.qb64b.slice(),
      opening.u.qb64b.slice(),
      opening.td.qb64b.slice(),
      opening.ts.qb64b.slice(),
    ] as const;
    const held = "bn" in opening
      ? BoundState.fromQb64bTuple([...fields, opening.bn.qb64b.slice(), opening.bd.qb64b.slice()])
      : BlindState.fromQb64bTuple(fields);
    this.approvals.set(this.approvalKey(registry, sender), { event, opening: held, uuid: held.u.qb64 });
  }

  /** Revoke this process's receipt approval; an already retained root stays immutable. */
  abandon(registry: string, sender: string): void {
    this.approvals.delete(this.approvalKey(registry, sender));
  }

  /**
   * Return one encrypted signed reply, partial for a group. Only the elected
   * member prepares ciphertext; contributors endorse this unchanged body.
   */
  prepare(
    registry: string,
    recipient: string,
    target: string,
    { coordinator }: { coordinator?: GroupCoordinator } = {},
  ): Uint8Array {
    this.hab.mgr.requireRegistryRootAccess();
    const key = this.scope(registry, this.hab.pre!, recipient, target);
    if (isLocalGroupHab(this.rgy.hby, this.hab)) {
      const selected = coordinator && groupWitnesserSelection(this.hab.db, this.hab.pre!, coordinator);
      const contribution = selected
        && latestGroupContribution(this.hab.db, this.target.pre!, selected.establishment.verfers);
      if (!selected || !contribution || contribution.index !== selected.index) {
        throw new ValidationError("Only the existing elected group coordinator prepares a root copy");
      }
      if (!latestGroupContribution(this.hab.db, this.target.pre!, this.hab.kever!.verfers)) {
        throw new ValidationError("Group coordinator is no longer a current signing member");
      }
    }
    const root = this.hab.mgr.getRegistryRoot(this.hab.pre!, registry);
    if (!root) throw new ValidationError("Authorized registry root is unavailable");
    const cipher = new Encrypter({ verkey: key.qb64 }).encrypt({ prim: root });
    const message = reply(RegistrySalt.Route, { registry, recipient, target, cipher: cipher.qb64 }, {
      pre: this.hab.pre!,
      pvrsn: Vrsn_2_0,
      kind: Kinds.json,
    });
    return this.hab.endorse(message, { gvrsn: Vrsn_2_0 });
  }

  /** Accept only after threshold authentication, decryption and immutable retention, including an identical root. */
  processReply({ serder, diger, route, cigars = [], tsgs = [], attachments }: {
    serder: SerderKERI;
    diger: Diger;
    route: string;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
    attachments?: KeriDispatchEnvelope;
  }): ReplyProcessDecision {
    try {
      if (
        serder.ilk !== "rpy" || serder.pvrsn.major !== 2 || serder.pvrsn.minor !== 0
        || route !== RegistrySalt.Route || serder.route !== route || !serder.verify()
      ) {
        throw new ValidationError("Invalid registry transfer reply");
      }
      this.attachments(serder, attachments);
      const data = serder.sad?.a;
      if (
        !data || typeof data !== "object" || Array.isArray(data)
        || Object.keys(data).sort().join() !== "cipher,recipient,registry,target"
        || Object.values(data).some(value => typeof value !== "string")
      ) {
        throw new ValidationError("Invalid registry transfer scope");
      }
      const { registry, recipient, target, cipher: encrypted } = data as Record<string, string>;
      const sender = serder.pre!, approval = this.approvals.get(this.approvalKey(registry, sender));
      if (!approval || recipient !== this.hab.pre || target !== this.target.pre) {
        throw new ValidationError("Registry transfer has no exact local approval");
      }
      this.hab.mgr.requireRegistryRootAccess();
      const key = this.scope(registry, sender, recipient, target);
      const event = this.event(registry, approval.event, approval.opening);
      const cipher = this.canonical(encrypted, Cipher);
      if (cipher.code !== MtrDex.X25519_Cipher_Salt) throw new ValidationError("Invalid encrypted Salt128 root");
      // BADA can accept historical establishments; a new capability copy requires current author authority.
      const author = this.hab.db.getKever(sender)!;
      const current = tsgs.filter(group =>
        group.pre === sender && group.sn === BigInt(author.lastEst.s)
        && group.said === author.lastEst.d
      );
      const nontrans = cigars.filter(cigar => cigar.verfer?.qb64 === sender);
      if (!current.length && !nontrans.length) {
        throw new ValidationError("Registry transfer requires current author signatures");
      }
      const decision = this.hab.rvy.acceptReply({
        serder,
        saider: diger,
        route,
        aid: sender,
        cigars: nontrans,
        tsgs: current,
      });
      if (decision.kind !== "accept") return decision;
      const plain = this.target.mgr.open(cipher.raw, key);
      if (!plain) throw new ValidationError("Root cannot be decrypted with the current target key");
      const root = this.canonical(new TextDecoder().decode(plain), Salter);
      if (root.code !== MtrDex.Salt_128 || !bytesEqual(root.qb64b, plain)) {
        throw new ValidationError("Decrypted root is not a canonical Salt128");
      }
      if (makeBlindUuid({ salt: root.qb64, sn: event.sn }).qb64 !== approval.uuid) {
        throw new ValidationError("Root does not reproduce the approved accepted opening");
      }
      const retained = this.hab.mgr.getRegistryRoot(this.hab.pre!, registry);
      if (retained && retained.qb64 !== root.qb64) {
        throw new ValidationError("A different registry root is already retained");
      }
      this.hab.mgr.putRegistryRoot(this.hab.pre!, registry, root);
      return decision;
    } catch (error) {
      if (error instanceof ValidationError) return unverifiedReplyDecision(error.message);
      throw error;
    }
  }

  /** Validate accepted registry authority and target contribution to current recipient keys. */
  private scope(registry: string, sender: string, recipient: string, target: string): Verfer {
    for (const aid of [sender, recipient, target]) this.canonical(aid, Prefixer);
    const store = this.rgy.store, rip = store.seqEvent(registry, 0), head = store.headEvent(registry);
    const inception = rip && validateRip(rip);
    if (!rip || rip.said !== registry || inception?.kind !== "valid" || !head || head.ilk !== "bup") {
      throw new ValidationError("Root transfer requires an accepted registry update");
    }
    const anchor = store.anchor(rip.said!);
    if (
      !verifyRegistryAnchor(inception.event, {
        db: this.hab.db,
        issuer: rip.issuer!,
        number: anchor?.[0],
        diger: anchor?.[1],
      })
    ) {
      throw new ValidationError("Registry inception lacks accepted anchor evidence");
    }
    const author = this.hab.db.getKever(sender),
      receiver = this.hab.db.getKever(recipient),
      member = this.hab.db.getKever(target);
    if (!author || !receiver || !member) {
      throw new ValidationError("Registry transfer requires accepted party key state");
    }
    if (recipient !== target && !latestGroupContribution(this.hab.db, target, receiver.verfers)) {
      throw new ValidationError("Encryption target is not a current group signing member");
    }
    if (sender !== rip.issuer && !(sender === recipient && recipient !== target)) {
      throw new ValidationError("Only the issuer or recipient group may authorize this transfer");
    }
    const key = member.verfers[0];
    if (!key || (key.code !== MtrDex.Ed25519 && key.code !== MtrDex.Ed25519N)) {
      throw new ValidationError("Recipient encryption requires a current Ed25519 key");
    }
    return key;
  }

  /** Recheck exact accepted BUP membership, anchoring and the held primitive commitment. */
  private event(registry: string, said: string, opening: RegistryDisclosure) {
    const store = this.rgy.store, body = store.event(said), rip = store.seqEvent(registry, 0);
    const update = body && validateUpdate(body, registry);
    if (
      !body || body.said !== said || update?.kind !== "valid" || update.event.sn > BigInt(Number.MAX_SAFE_INTEGER)
      || store.seqSaider(registry, Number(update.event.sn))?.qb64 !== said || !rip
    ) {
      throw new ValidationError("Approval requires the exact accepted registry BUP");
    }
    const anchor = store.anchor(said);
    if (
      !verifyRegistryAnchor(update.event, {
        db: this.hab.db,
        issuer: rip.issuer!,
        number: anchor?.[0],
        diger: anchor?.[1],
      })
      || !vetBlind(opening, body.sad!.b as string)
    ) {
      throw new ValidationError("Approval requires an anchored BUP and its exact held opening");
    }
    return update.event;
  }

  /** Parse caller/wire primitives canonically; storage and backend exceptions remain outside this boundary. */
  private canonical<T extends Matter>(value: string, ctor: new(args: { qb64: string }) => T): T {
    try {
      const material = new ctor({ qb64: value });
      if (new Matter({ raw: material.raw, code: material.code }).qb64 !== value) {
        throw new ValidationError("Noncanonical registry transfer material");
      }
      return material;
    } catch (error) {
      if (error instanceof ParserError) {
        throw new ValidationError("Invalid registry transfer material", { cause: error });
      }
      throw error;
    }
  }

  /** Reject non-authentication evidence, including unknown raw groups and missing full-parser context. */
  private attachments(serder: SerderKERI, envelope?: KeriDispatchEnvelope): void {
    const allowed = ["ControllerIdxSigs", "NonTransReceiptCouples", "TransIdxSigGroups"];
    if (
      !envelope || !bytesEqual(envelope.serder.raw, serder.raw)
      || [
        envelope.wigers,
        envelope.trqs,
        envelope.ssgs,
        envelope.unresolvedLast,
        envelope.frcs,
        envelope.sscs,
        envelope.ssts,
        envelope.tdcs,
        envelope.ptds,
        envelope.essrs ?? [],
        envelope.nests,
        envelope.bsqs,
        envelope.bsss,
        envelope.tmqs,
      ].some(values => values.length)
      || envelope.attachmentGroups.some(group => !allowed.includes(group.name.replace(/^Big/, "")))
    ) {
      throw new ValidationError("Registry transfer carries unsupported attachments");
    }
  }

  private approvalKey(registry: string, sender: string): string {
    return JSON.stringify([registry, sender]);
  }
}
