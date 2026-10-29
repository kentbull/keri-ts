/** Local R&D salt reply route, matching KERIpy RegistrySaltService.
 * Ordinary Revery owns signature thresholds and its existing proof escrow.
 * This application adds no assignment protocol, acknowledgement or retry state.
 */
import { Cipher, Diger, Encrypter, MtrDex, parseBytes, Prefixer, SerderKERI } from "cesr-ts";
import {
  endorseReply,
  EssrRecipient,
  type Exchanger,
  type Hab,
  type Habery,
  inspectReplyProposal,
  type Reactor,
  reply,
  ValidationError,
} from "keri-ts/runtime";
import { RegistryCustody } from "./custody.ts";

const ROUTE = "/registry/salt";
type ReplyInput = Parameters<Habery["rvy"]["processReply"]>[0] & { diger: Diger; route: string };
interface SaltPayload {
  registry: string;
  recipient: string;
  target: string;
  cipher: string;
}

/** Borrow the custody owner's accepted evidence and normal reply verifier. */
export class RegistrySaltService {
  constructor(readonly custody: RegistryCustody, readonly rvy: Habery["rvy"]) {
    if (rvy.db !== custody.options.hby.db) {
      throw new ValidationError("Salt sharing requires matching evidence and custody owners");
    }
  }

  /** Register only this application route; the caller owns parsing and scheduling. */
  register(): void {
    this.rvy.rtr.addRoute(ROUTE, this, "RegistrySalt");
  }

  /** Dispatch one decrypted salt reply through the caller's ordinary parser.
   * Exchanger has already authenticated and retained the outer envelope. The
   * inner reply still passes Revery; an envelope cannot grant issuer authority.
   */
  registerEnvelope(member: Hab, exc: Exchanger, reactor: Reactor): void {
    const recipient = new EssrRecipient(member);
    exc.addHandler({
      resource: "/essr/req",
      *handle({ serder }) {
        const opened = recipient.decrypt(serder.said!);
        if (opened.kind !== "accept") throw new ValidationError("Invalid encrypted salt envelope");
        const frames = parseBytes(opened.message.body);
        if (
          frames.length !== 1 || !(frames[0].body instanceof SerderKERI) || frames[0].body.ilk !== "rpy" ||
          frames[0].body.route !== ROUTE
        ) {
          throw new ValidationError("Encrypted salt envelope requires one registry salt reply");
        }
        yield* reactor.processBytes(opened.message.body);
      },
    });
  }

  /** Validate public bindings independently of the reply's signatures. */
  validate(body: SerderKERI): { issuer: string; data: SaltPayload } {
    const attrs = body.ked?.a;
    if (
      body.route !== ROUTE || body.pvrsn.major !== 2 || body.pvrsn.minor !== 0 ||
      !attrs || typeof attrs !== "object" || Array.isArray(attrs) ||
      Object.keys(attrs).sort().join(",") !== "cipher,recipient,registry,target"
    ) {
      throw new ValidationError("Invalid registry salt reply");
    }
    const data = attrs as unknown as SaltPayload;
    try {
      if (new Diger({ qb64: data.registry }).qb64 !== data.registry) throw new Error();
      for (const aid of [data.recipient, data.target]) {
        if (new Prefixer({ qb64: aid }).qb64 !== aid) throw new Error();
      }
      const cipher = new Cipher({ qb64: data.cipher });
      if (cipher.code !== MtrDex.X25519_Cipher_Salt || cipher.qb64 !== data.cipher) throw new Error();
    } catch {
      throw new ValidationError("Invalid encrypted salt or recipient");
    }
    const rip = this.custody.options.registry.seqEvent(data.registry, 0);
    if (!rip || rip.ilk !== "rip" || !rip.issuer) {
      throw new ValidationError("Accepted registry inception is required before salt delivery");
    }
    if (body.pre !== rip.issuer && body.pre !== data.recipient) {
      throw new ValidationError("Salt reply must be signed by the issuer or recipient group");
    }
    return { issuer: rip.issuer, data };
  }

  /** Build ciphertext for explicit signing and transport by the caller. */
  makeReply(hab: Hab, registry: string, recipient: string, target = recipient): SerderKERI {
    const { hby } = this.custody.options;
    if (hby.habs.get(hab.pre) !== hab) throw new ValidationError("Salt delivery requires a local author");
    const kever = hby.db.getKever(target);
    if (!kever || kever.verfers.length !== 1) {
      throw new ValidationError("Salt delivery requires a known individual encryption recipient");
    }
    const cipher = this.custody.sealRoot(registry, new Encrypter({ verkey: kever.verfers[0].qb64 }));
    const body = reply(ROUTE, { registry, recipient, target, cipher: cipher.qb64 }, {
      pre: hab.pre,
      version: { major: 2, minor: 0 },
    });
    const { issuer } = this.validate(body), group = hby.db.getHab(hab.pre);
    if (hab.pre !== issuer && !group?.mid) {
      throw new ValidationError("Nonissuer replication requires the recipient group");
    }
    if (group?.mid && hab.pre === recipient && !this.members(recipient).includes(target)) {
      throw new ValidationError("Replication target is not a current group member");
    }
    return body;
  }

  /** Approve the exact retained group reply through ordinary multisig helpers.
   * Consent receives public routing fields only. A declined or changed group
   * creates no contribution; this method neither sends nor records delivery.
   */
  approveProposal(
    group: Hab,
    exc: Exchanger,
    said: string,
    approve: (reply: SerderKERI) => boolean,
  ): { wire: Uint8Array; proposer: string; reply: SerderKERI } {
    const { hby } = this.custody.options;
    const validate = (reply: SerderKERI) => {
      this.validate(reply);
    };
    const proposal = inspectReplyProposal(hby, exc, said, { group: group.pre, validate });
    const reply = proposal.child.body as SerderKERI;
    const establishment = group.kever!.lastEst.d;
    if (!approve(reply)) throw new ValidationError("Registry salt reply approval declined");
    if (group.kever!.lastEst.d !== establishment) {
      throw new ValidationError("Group establishment changed during reply approval");
    }
    return {
      wire: endorseReply(hby, proposal.child, { group: group.pre, validate }),
      proposer: proposal.wrapper.pre!,
      reply,
    };
  }

  /** Read existing local group membership, without storing a second roster. */
  private members(group: string): string[] {
    const { hby } = this.custody.options;
    const current = hby.ks.getSmids(group).map((tuple) => tuple[0].qb64);
    return current.length ? current : hby.db.getHab(group)?.smids ?? [];
  }

  /** Verify through Revery, then decrypt only the addressed local member's copy. */
  processReplyRegistrySalt(args: ReplyInput): ReturnType<Habery["rvy"]["processReply"]> {
    const { issuer, data } = this.validate(args.serder), { hby } = this.custody.options;
    const recipient = hby.habs.get(data.recipient), group = hby.db.getHab(data.recipient);
    let member = recipient;
    if (recipient && group?.mid) {
      if (!this.members(data.recipient).includes(data.target)) {
        throw new ValidationError("Salt target is not a local group member");
      }
      member = hby.habs.get(group.mid);
    } else if (args.serder.pre !== issuer) {
      throw new ValidationError("Individual recipient requires issuer authorization");
    }
    const addressed = member?.pre === data.target;
    if (!addressed && !hby.habs.has(args.serder.pre!)) {
      throw new ValidationError("Salt reply is addressed to another local recipient");
    }
    const decision = this.rvy.acceptReply({ ...args, saider: args.diger, aid: args.serder.pre! });
    if (decision.kind !== "accept" || !addressed) return decision;
    const root = this.custody.openRoot(data.cipher, member!.kever!.verfers[0]);
    this.custody.receiveRoot(data.registry, data.recipient, root);
    return decision;
  }
}
