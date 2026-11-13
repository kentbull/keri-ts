/** Authenticated /fwd intake: deliver locally or re-forward for senders this host serves, else store for recipients. */
import {
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  nestedPayload,
  parsePather,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import type { Kever } from "../../core/kel/kever.ts";
import { Roles } from "../../core/roles.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import { isAcceptedGroupMember } from "../multisig/group-members.ts";
import type { Reactor } from "../protocol/reactor.ts";
import { abortable } from "../runtime/abortable.ts";
import type { MailboxDirector } from "./mailbox-director.ts";

/**
 * What a relaying host uses for a served sender's child: its own Poster for a remote recipient, and its own byte
 * ingress for a recipient that is one of its habitats.
 */
export interface ForwardRelaying {
  /** Borrowed delivery owner that re-sends the child to a remote recipient with this host as source. */
  readonly postman: Poster;
  /** Borrowed byte ingress of this host's runtime, through which a local recipient receives the child. */
  readonly reactor: Reactor;
}

/** The single path one accepted `/fwd` takes, decided from accepted state in the turn that takes it. */
type ForwardPath =
  /** The recipient is a habitat of this Habery and the sender is served: process the child here. */
  | { readonly kind: "ingest" }
  /** This host is the recipient's witness, mailbox or agent: store the child in its mailbox topic. */
  | { readonly kind: "store" }
  /** The sender is served and the recipient is remote: re-send the child as `host`. */
  | { readonly kind: "relay"; readonly host: string };

/**
 * Accepted `/fwd` route handler that stores embedded payloads in mailbox topics and, on a relaying host, delivers
 * a served sender's payloads onward.
 *
 * This is the `keri-ts` mailbox-storage analogue to KERIpy's `ForwardHandler`.
 *
 * Paths, in order; exactly one runs for one `/fwd`:
 * - ingest (relaying only): the recipient is a habitat of this Habery and the
 *   `/fwd` sender is served. The child goes through this runtime's own byte
 *   ingress as remote input addressed to that habitat's endpoint, so signature,
 *   KRAM and escrow rules apply as for any received message. This is how an
 *   edge's group co-member hosted on the agent receives every group message.
 * - store: the request-scoped mailbox AID passed with this message must
 *   currently be authorized for the addressed recipient (witness, mailbox or
 *   agent). A recipient this host stores for is never also relayed.
 * - relay (relaying only): the `/fwd` sender is served and the recipient is
 *   remote. The host re-sends the child with its own Poster, as KERIA's agent
 *   re-sends a Signify client's exn.
 *
 * A served sender authorized this host as its `mailbox` or `agent`, directly or
 * through a group it is an accepted member of. Witness membership never makes a
 * sender served.
 */
export class ForwardHandler implements ExchangeRouteHandler {
  /** Registered exchange route for store-forward messages. */
  static readonly resource = "/fwd";
  /** Instance route identity used by exchange dispatch. */
  readonly resource = ForwardHandler.resource;
  /** This route binds a single v2 child body; recipient processors authenticate its evidence. */
  readonly acceptsNests = true;
  /** Borrowed provider publication/correlation owner. */
  readonly mailboxDirector: MailboxDirector;
  /** Borrowed relaying collaborators; null means store-only intake. */
  readonly relaying: ForwardRelaying | null;

  /**
   * Bind mailbox publication and optional relaying without acquiring a store.
   *
   * @param mailboxDirector Borrowed provider owner that publishes accepted forwarded payloads.
   * @param relaying Borrowed Poster and ingress that deliver a served sender's child; null keeps store-only intake.
   */
  constructor(mailboxDirector: MailboxDirector, relaying: ForwardRelaying | null) {
    this.mailboxDirector = mailboxDirector;
    this.relaying = relaying;
  }

  /**
   * Verify that the embedded exchange has the mailbox modifiers and one
   * extractable forwarded payload.
   *
   * @param args Signed forwarding exchange, attachment evidence and optional nested frames; children retain their own authentication requirements.
   * @returns Whether required modifiers and one bound forwarded payload are structurally valid.
   */
  verify(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
    nests?: readonly CesrFrame[];
  }): boolean {
    const modifiers = args.serder.ked?.q as Record<string, unknown> | undefined;
    if (typeof modifiers?.pre !== "string" || typeof modifiers?.topic !== "string") return false;
    if (args.serder.pvrsn.major < 2) {
      return !args.nests?.length && extractForwardedMessage(args.serder, args.attachments) !== null;
    }
    if (args.nests?.length !== 1) return false;
    const signed = (args.serder.a as Record<string, unknown>)?.evt;
    const child = args.nests[0].body;
    if (typeof signed !== "string" || !(child instanceof SerderKERI || child instanceof SerderACDC)) return false;
    try {
      return child.verify() && new Diger({ qb64: signed }).verify(child.raw);
    } catch {
      return false;
    }
  }

  /**
   * Take the one {@link ForwardPath} this `/fwd` qualifies for, or drop it.
   *
   * Accepted store host shapes:
   * - explicit mailbox provider authorized in `ends.`
   * - recipient witness host from the accepted KEL witness set
   * - recipient agent host authorized in `ends.`
   *
   * Controller endpoints stay excluded here because they are direct
   * correspondence destinations, not store-and-forward hosts.
   *
   * A relayed child is admitted to the Poster with this host as source and the
   * `/fwd` topic unchanged; the Poster's own `transportMailboxTopic` is
   * idempotent on that already-bare topic. Admission is the end of this
   * handler's duty: a failed onward attempt is the Poster's logged failed
   * outcome, with no outbox and no acknowledgement back to the sender.
   *
   * An ingested child is dispatched inside this handler's operation, after the
   * Exchanger has committed the `/fwd`; it is one more input to the shared
   * protocol owners, which hold no lock or input queue. A child the recipient
   * cannot process yet escrows as any received message does.
   *
   * @param args Accepted exchange with borrowed attachments/children and receiving mailboxAid provenance.
   * @returns An operation for v2 child serialization or local ingest, or synchronous completion/no-op otherwise.
   */
  handle(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
    /** Borrowed child wire remains live for this awaited handler operation. */
    nests?: readonly CesrFrame[];
    /** Receiving hosted endpoint whose authority must cover the addressed recipient. */
    mailboxAid?: string | null;
  }): void | Operation<void> {
    const modifiers = args.serder.ked?.q as Record<string, unknown> | undefined;
    const recipient = typeof modifiers?.pre === "string" ? modifiers.pre : null;
    const topic = typeof modifiers?.topic === "string" ? modifiers.topic : null;
    const child = args.serder.pvrsn.major >= 2 ? args.nests?.[0] : undefined;
    const forwarded = child ? null : extractForwardedMessage(args.serder, args.attachments);
    const mailboxAid = args.mailboxAid;
    if (!recipient || !topic || (!child && !forwarded)) {
      return;
    }

    const source: ForwardSource = {
      sender: args.serder.pre,
      origin: child ? childOrigin(child) : embeddedOrigin(args.serder),
    };
    const path = this.forwardPath(source, recipient, mailboxAid);
    if (!path) return;
    if (!child) return this.deliver(path, recipient, topic, forwarded!);
    // deno-lint-ignore no-this-alias -- The operation owns this one child's delivery.
    const self = this;
    return call(function*() {
      // Mailbox LMDB and Poster take one finite message; collect one child, never the whole exchange stream.
      const wire = yield* abortable((signal) => collectPayload(nestedPayload(child, Vrsn_2_0), signal));
      // Re-read accepted authority in the same synchronous turn as delivery.
      const current = self.forwardPath(source, recipient, mailboxAid);
      if (current) yield* call(() => self.deliver(current, recipient, topic, wire));
    });
  }

  /**
   * Decide the path from current accepted state; see the class rules for their order.
   *
   * @param source Authenticated `/fwd` signer and the forwarded message's own originator.
   * @param recipient Final recipient AID named by the `/fwd` modifiers.
   * @param mailboxAid Receiving hosted endpoint AID, or null when the request named none.
   * @returns The one path to take, or null to drop the `/fwd`.
   */
  private forwardPath(
    source: ForwardSource,
    recipient: string,
    mailboxAid: string | null | undefined,
  ): ForwardPath | null {
    const hby = this.mailboxDirector.hby;
    if (this.relaying && hby.habs.has(recipient) && this.servingHost(source, mailboxAid)) return { kind: "ingest" };
    if (this.canStoreRecipient(recipient, mailboxAid)) return { kind: "store" };
    // Nothing addressed to this Habery leaves through its own Poster; it would only loop back here.
    if (!this.relaying || hby.db.prefixes.has(recipient)) return null;
    const host = this.servingHost(source, mailboxAid);
    return host ? { kind: "relay", host } : null;
  }

  /**
   * Select the local host that serves this source, or null.
   *
   * Without request-scoped provenance any local habitat the source authorized serves it, as the store path
   * accepts any local store host.
   *
   * @param source Authenticated `/fwd` signer and the forwarded message's own originator.
   * @param mailboxAid Receiving hosted endpoint AID, or null when the request named none.
   * @returns The local AID the source authorized, or null.
   */
  private servingHost(source: ForwardSource, mailboxAid: string | null | undefined): string | null {
    const hby = this.mailboxDirector.hby;
    const hosts = mailboxAid ? [mailboxAid] : [...hby.db.prefixes];
    return hosts.find((host) => hby.habs.has(host) && servesSource(hby, source, host)) ?? null;
  }

  /**
   * Take one decided path for complete child wire.
   *
   * @param path Path decided in this turn.
   * @param recipient Final recipient AID.
   * @param topic `/fwd` mailbox topic.
   * @param wire Complete child message, signed by its originator.
   * @returns The ingest operation for a local recipient; storage and Poster admission complete synchronously.
   */
  private deliver(path: ForwardPath, recipient: string, topic: string, wire: Uint8Array): void | Operation<void> {
    switch (path.kind) {
      case "store":
        this.mailboxDirector.publish(recipient, topic, wire);
        return;
      case "relay":
        this.relaying!.postman.send({ src: path.host, dest: recipient, topic, msg: wire });
        return;
      case "ingest":
        // Remote input at the recipient's own endpoint, never `local`: it must earn acceptance like any arrival.
        return this.relaying!.reactor.processBytes(wire, { mailboxAid: recipient });
    }
  }

  /** Re-read accepted authority in the same synchronous turn as provider publication. */
  private canStoreRecipient(recipient: string, mailboxAid: string | null | undefined): boolean {
    const hby = this.mailboxDirector.hby;
    const kever = hby.db.getKever(recipient);
    if (!kever) return false;
    if (mailboxAid) return hostCanStoreForwardRecipient(hby, recipient, kever, mailboxAid);
    return hasLocalStoreForwardHost(hby, recipient, kever);
  }
}

/**
 * Check recipient-specific store-forward authority without treating a controller endpoint as a mailbox.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param recipient Final recipient AID.
 * @param recipientKever Accepted recipient state supplying its current witness cohort.
 * @param hostAid Receiving endpoint AID whose witness/mailbox/agent authority is checked.
 * @returns True when current accepted witness or endpoint-role state authorizes a local store-forward host.
 */
function hostCanStoreForwardRecipient(
  hby: Habery,
  recipient: string,
  recipientKever: Kever,
  hostAid: string,
): boolean {
  // A local host may store forwarded traffic only when it is an authorized
  // witness/mailbox/agent for the recipient. This keeps mailbox storage from
  // becoming a generic unauthenticated relay.
  if (recipientKever.wits.includes(hostAid)) {
    return true;
  }
  return authorizesHost(hby, recipient, hostAid);
}

/**
 * Whether `cid` has an accepted `mailbox` or `agent` end role naming `hostAid`: rows
 * `ends.[cid, mailbox, hostAid]` and `ends.[cid, agent, hostAid]`, allowed or enabled.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param cid Controller AID whose end-role authorization is read.
 * @param hostAid Endpoint AID the role must name.
 * @returns True when either row authorizes the host.
 */
function authorizesHost(hby: Habery, cid: string, hostAid: string): boolean {
  for (const role of [Roles.mailbox, Roles.agent]) {
    const end = hby.db.ends.get([cid, role, hostAid]);
    if (end?.allowed || end?.enabled) {
      return true;
    }
  }
  return false;
}

/**
 * Who a `/fwd` speaks for. A group's `/fwd` wrapper is signed by its local member (Poster cannot meet a group
 * threshold with one signature), so the signer and the forwarded message's originator can differ.
 */
interface ForwardSource {
  /** Authenticated `/fwd` signer (its `i`), verified by the Exchanger before this handler runs. */
  readonly sender: string | null;
  /** The forwarded message's own `i` (an ACDC's issuer), or null when it carries none. */
  readonly origin: string | null;
}

/**
 * Whether `hostAid` relays for this source: the sender authorized the host, or the forwarded message originates
 * from a group the sender is an accepted member of and that group authorized the host. Witness membership of
 * either is not consulted. Rows read: `ends.[sender, mailbox|agent, hostAid]`, then, only when the sender is an
 * accepted member of `origin`, `ends.[origin, mailbox|agent, hostAid]`.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param source Authenticated `/fwd` signer and forwarded originator.
 * @param hostAid Local endpoint AID that would relay.
 * @returns True when accepted end-role state makes the sender a served sender of this host.
 */
function servesSource(hby: Habery, source: ForwardSource, hostAid: string): boolean {
  if (!source.sender) return false;
  if (authorizesHost(hby, source.sender, hostAid)) return true;
  return !!source.origin && source.origin !== source.sender
    && isAcceptedGroupMember(hby.db, source.origin, source.sender)
    && authorizesHost(hby, source.origin, hostAid);
}

/**
 * Originator of a v2 nested child: a KERI message's `i`, an ACDC's issuer.
 *
 * @param child Bound nested child frame.
 * @returns Originator AID, or null when the child names none.
 */
function childOrigin(child: CesrFrame): string | null {
  const body = child.body;
  if (body instanceof SerderKERI) return body.pre;
  if (body instanceof SerderACDC) return body.issuer;
  return null;
}

/**
 * Originator of a legacy `e.evt` embed: its `i` field.
 *
 * @param serder Legacy forwarding exchange.
 * @returns Originator AID, or null when the embed names none.
 */
function embeddedOrigin(serder: SerderKERI): string | null {
  const evt = (serder.ked?.e as Record<string, unknown> | undefined)?.evt as Record<string, unknown> | undefined;
  return typeof evt?.i === "string" ? evt.i : null;
}

/**
 * Check recipient-specific store-forward authority without treating a controller endpoint as a mailbox.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param recipient Final recipient AID.
 * @param recipientKever Accepted recipient state supplying its current witness cohort.
 * @returns True when current accepted witness or endpoint-role state authorizes a local store-forward host.
 */
function hasLocalStoreForwardHost(
  hby: Habery,
  recipient: string,
  recipientKever: Kever,
): boolean {
  // Check all local prefixes because a multi-role runtime can host a mailbox
  // AID that is distinct from the controller currently processing the EXN.
  for (const hostAid of hby.db.prefixes) {
    if (hostCanStoreForwardRecipient(hby, recipient, recipientKever, hostAid)) {
      return true;
    }
  }
  return false;
}

/**
 * Reconstruct legacy forwarded wire without assigning outer attachments to the child.
 *
 * @param serder Legacy forwarding exchange containing an e.evt body.
 * @param attachments Pathed attachments; only /e/evt material belongs to the embedded message.
 * @returns Reconstructed child wire, or null without an embedded event.
 */
function extractForwardedMessage(
  serder: SerderKERI,
  attachments: readonly ExchangeAttachment[],
): Uint8Array | null {
  const embeds = serder.ked?.e as Record<string, unknown> | undefined;
  const evt = embeds?.evt;
  if (!evt || typeof evt !== "object" || Array.isArray(evt)) {
    return null;
  }

  // Rebuild the embedded event from SAD plus only the attachment material
  // pathed to `/e/evt`; other pathed groups belong to the outer `/fwd` message.
  const embedded = embeddedSerderRaw(evt as Record<string, unknown>);
  const messageParts: Uint8Array[] = [embedded];

  for (const attachment of attachments) {
    const atc = forwardedAttachmentForPath(attachment.raw, "/e/evt");
    if (atc) {
      messageParts.push(atc);
    }
  }

  return concatBytes(...messageParts);
}

/**
 * Serialize one legacy embedded body according to its declared protocol.
 *
 * @param sad Embedded self-addressing data; version prefix selects ACDC versus KERI serialization.
 * @returns Serialized embedded body bytes; caller owns attachment reconstruction.
 */
function embeddedSerderRaw(sad: Record<string, unknown>): Uint8Array {
  const version = typeof sad.v === "string" ? sad.v : "";
  if (version.startsWith("ACDC")) {
    return new SerderACDC({ sad, verify: false }).raw;
  }
  return new SerderKERI({ sad }).raw;
}

/**
 * Extract the forwarded attachment bytes for the embedded `/e/evt` path.
 *
 * Forwarded attachment groups can carry multiple pathed attachments, so the
 * path filter keeps mailbox reconstruction focused on the embedded event.
 *
 * @param raw One qualified pathed attachment group in text-domain bytes.
 * @param path Exact embedded SAD path to match.
 * @returns Attachment bytes after the matching pather, or null for a different/empty group.
 */
function forwardedAttachmentForPath(
  raw: Uint8Array,
  path: string,
): Uint8Array | null {
  if (raw.length === 0) {
    return null;
  }

  const counter = new Counter({ qb64b: raw });
  const offset = counter.fullSize;
  const pather = parsePather(raw.slice(offset), "txt");
  if (pather.path !== path) {
    return null;
  }
  return raw.slice(offset + pather.fullSize);
}
