/** Authenticated /fwd intake: deliver locally or re-forward for senders this host serves, else store for recipients. */
import {
  type CesrBody,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  nestedPayload,
  parseBytes,
  parsePather,
  ParserError,
  type Payload,
  Prefixer,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import type { Kever } from "../../core/kel/kever.ts";
import { storableTopic } from "../../db/mailbox/mailboxing.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import { isAcceptedGroupMember } from "../multisig/group-members.ts";
import type { Reactor } from "../protocol/reactor.ts";
import { abortable } from "../runtime/abortable.ts";
import { authorizedStoringHost, keepsForPickup, ownTraffic } from "./agent-inbox.ts";
import type { MailboxDirector } from "./mailbox-director.ts";
import { mailboxTopicKey } from "./mailboxing.ts";
import { transportMailboxTopic } from "./topic-routing.ts";

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
  /**
   * The recipient is a habitat of this Habery, and the sender is served or this host keeps the recipient's mail for
   * pickup: process the child here, and when `store`, also keep one copy in the recipient's mailbox topic.
   */
  | { readonly kind: "ingest"; readonly store: boolean }
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
 * - ingest (relaying only): the recipient is a habitat of this Habery and
 *   either the `/fwd` sender is served or this host keeps the recipient's mail
 *   for pickup (`keepsForPickup`: a local group that authorized it as mailbox
 *   or agent), whoever the sender is. The child goes through this runtime's own
 *   byte ingress as remote input addressed to that habitat's endpoint, so
 *   signature, KRAM and escrow rules apply as for any received message. This is
 *   how an edge's group co-member hosted on the agent receives every group
 *   message. When the host keeps mail for pickup and the child is not
 *   `ownTraffic` (its originator is a local habitat, an agent principal of the
 *   host, or a member of the group, i.e. the edge that would pick it up), it is
 *   also stored once in the group's mailbox topic for its remote members: one
 *   ingest, one stored copy. A third party's `/fwd` to the group is ingested and
 *   stored; the edge's own is ingested only.
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
   * Verify that the exchange names a {@link ForwardAddress} and carries one forwarded message: a legacy embed that
   * rebuilds into exactly one complete message ({@link legacyForwardedMessage}), or one SAID-bound v2 child. Any
   * other shape is refused here, so the Exchanger rejects the `/fwd` and nothing is stored, relayed or ingested.
   *
   * @param args Signed forwarding exchange, attachment evidence and optional nested frames; children retain their own authentication requirements.
   * @returns Whether the address and one bound forwarded message are structurally valid.
   */
  verify(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
    nests?: readonly CesrFrame[];
  }): boolean {
    if (!forwardAddress(args.serder)) return false;
    if (args.serder.pvrsn.major < 2) {
      return !args.nests?.length && legacyForwardedMessage(args.serder, args.attachments) !== null;
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
    const address = forwardAddress(args.serder);
    const mailboxAid = args.mailboxAid;
    if (!address) return;
    if (args.serder.pvrsn.major < 2) {
      const message = legacyForwardedMessage(args.serder, args.attachments);
      if (!message) return;
      const path = this.forwardPath(forwardSource(args.serder, message.frame.body), address.recipient, mailboxAid);
      return path ? this.deliver(path, address, message.wire) : undefined;
    }
    const child = args.nests?.[0];
    if (!child) return;
    const source = forwardSource(args.serder, child.body);
    if (!this.forwardPath(source, address.recipient, mailboxAid)) return;
    // deno-lint-ignore no-this-alias -- The operation owns this one child's delivery.
    const self = this;
    return call(function*() {
      const wire = yield* collectNestedMessage(child);
      if (!wire) return;
      // Re-read accepted authority in the same synchronous turn as delivery.
      const current = self.forwardPath(source, address.recipient, mailboxAid);
      if (current) yield* call(() => self.deliver(current, address, wire));
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
    if (this.relaying && hby.habs.has(recipient)) {
      const pickup = this.pickupHost(recipient, mailboxAid);
      if (pickup || servingHost(hby, source, mailboxAid)) {
        return { kind: "ingest", store: !!pickup && !ownTraffic(hby, source.origin, recipient, pickup) };
      }
    }
    if (this.canStoreRecipient(recipient, mailboxAid)) return { kind: "store" };
    // Nothing addressed to this Habery leaves through its own Poster; it would only loop back here.
    if (!this.relaying || hby.db.prefixes.has(recipient)) return null;
    const host = servingHost(hby, source, mailboxAid);
    return host ? { kind: "relay", host } : null;
  }

  /**
   * Select the local host that keeps `recipient`'s mail for pickup, or null; any local habitat without
   * request-scoped provenance, as {@link servingHost} does.
   *
   * @param recipient Final recipient AID named by the `/fwd` modifiers.
   * @param mailboxAid Receiving hosted endpoint AID, or null when the request named none.
   * @returns The local AID that keeps the recipient's mail for pickup, or null.
   */
  private pickupHost(recipient: string, mailboxAid: string | null | undefined): string | null {
    const hby = this.mailboxDirector.hby;
    const hosts = mailboxAid ? [mailboxAid] : [...hby.db.prefixes];
    return hosts.find((host) => hby.habs.has(host) && keepsForPickup(hby, recipient, host)) ?? null;
  }

  /**
   * Take one decided path for complete child wire.
   *
   * @param path Path decided in this turn.
   * @param address Final recipient AID and `/fwd` mailbox topic.
   * @param wire Exactly one complete child message, signed by its originator.
   * @returns The ingest operation for a local recipient; storage (including an ingested child's pickup copy, written
   *   before ingest in the turn its authority was read) and Poster admission complete synchronously.
   */
  private deliver(path: ForwardPath, address: ForwardAddress, wire: Uint8Array): void | Operation<void> {
    const { recipient, topic } = address;
    switch (path.kind) {
      case "store":
        this.mailboxDirector.publish(recipient, topic, wire);
        return;
      case "relay":
        this.relaying!.postman.send({ src: path.host, dest: recipient, topic, msg: wire });
        return;
      case "ingest":
        if (path.store) this.mailboxDirector.publish(recipient, topic, wire);
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
  return authorizedStoringHost(hby, recipient, hostAid);
}

/**
 * Who a relayed request speaks for. A group's `/fwd` wrapper is signed by its local member (Poster cannot meet a
 * group threshold with one signature), so the signer and the forwarded message's originator can differ. A request
 * the host consumes itself (an `/oobis` request) has no forwarded originator.
 */
export interface ForwardSource {
  /** Authenticated `/fwd` signer (its `i`), verified by the Exchanger before this handler runs. */
  readonly sender: string | null;
  /** The forwarded message's own `i` (an ACDC's issuer), or null when it carries none. */
  readonly origin: string | null;
}

/**
 * Select the local host that serves this source, or null. This is the one served-sender rule of a relaying host:
 * `/fwd` intake relays only for it and the `/oobis` handler resolves only for it.
 *
 * Without request-scoped provenance any local habitat the source authorized serves it, as the store path
 * accepts any local store host.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param source Authenticated signer and, for a `/fwd`, the forwarded message's own originator.
 * @param mailboxAid Receiving hosted endpoint AID, or null when the request named none.
 * @returns The local AID the source authorized, or null.
 */
export function servingHost(hby: Habery, source: ForwardSource, mailboxAid: string | null | undefined): string | null {
  const hosts = mailboxAid ? [mailboxAid] : [...hby.db.prefixes];
  return hosts.find((host) => hby.habs.has(host) && servesSource(hby, source, host)) ?? null;
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
  if (authorizedStoringHost(hby, source.sender, hostAid)) return true;
  return !!source.origin && source.origin !== source.sender
    && isAcceptedGroupMember(hby.db, source.origin, source.sender)
    && authorizedStoringHost(hby, source.origin, hostAid);
}

/** Where one `/fwd` delivers: its `q.pre` recipient and `q.topic` mailbox topic, both checked usable. */
interface ForwardAddress {
  /** Final recipient AID: a well-formed identifier prefix. */
  readonly recipient: string;
  /** Mailbox topic as the `/fwd` names it: nonempty in bare form, and storable under the recipient. */
  readonly topic: string;
}

/**
 * Read the `/fwd` address, or null when this host could not store or relay under it.
 *
 * The recipient must parse as one identifier prefix, since it becomes a Poster destination and a mailbox key. The
 * topic must be nonempty in bare form (a forwarded delivery requires one, and the Poster refuses an empty topic as a
 * programmer error) and storable as a mailbox key under that recipient, so a stored, ingested or relayed child never
 * reaches the mailbox store with a key it would refuse as a fault.
 *
 * @param serder Forwarding exchange.
 * @returns The usable address, or null.
 */
function forwardAddress(serder: SerderKERI): ForwardAddress | null {
  const modifiers = serder.ked?.q as Record<string, unknown> | undefined;
  const recipient = modifiers?.pre, topic = modifiers?.topic;
  if (typeof recipient !== "string" || typeof topic !== "string") return null;
  if (!wellFormedPrefix(recipient) || transportMailboxTopic(topic).length === 0) return null;
  return storableTopic(mailboxTopicKey(recipient, topic)) ? { recipient, topic } : null;
}

/**
 * Whether `value` is exactly one qb64 identifier prefix.
 *
 * @param value Remote-supplied prefix text.
 * @returns True when it parses as a prefix and nothing follows it.
 */
function wellFormedPrefix(value: string): boolean {
  try {
    return new Prefixer({ qb64: value }).qb64 === value;
  } catch (error) {
    if (error instanceof ParserError) return false;
    throw error;
  }
}

/**
 * The `/fwd` signer and the forwarded message's own originator: a KERI message's `i`, an ACDC's issuer.
 *
 * @param serder Authenticated forwarding exchange.
 * @param body Body of the one forwarded message.
 * @returns Who the request speaks for.
 */
function forwardSource(serder: SerderKERI, body: CesrBody): ForwardSource {
  const origin = body instanceof SerderKERI ? body.pre : body instanceof SerderACDC ? body.issuer : null;
  return { sender: serder.pre, origin };
}

/** The one message a legacy `/fwd` carries, decided once from its embed and `/e/evt` attachments. */
interface ForwardedMessage {
  /** Exactly one complete CESR message: the embedded body followed by its own attachments. */
  readonly wire: Uint8Array;
  /** The message `wire` parses as. */
  readonly frame: CesrFrame;
}

/**
 * The one frame `wire` parses as, or null when it is not exactly one complete CESR message with its attachments.
 *
 * `ParserError` is the decoder's refusal of the bytes; nothing else here reads a store or does I/O, so any other
 * error is a fault and propagates.
 *
 * @param wire Candidate child wire.
 * @returns The single parsed frame, or null.
 */
function oneCompleteMessage(wire: Uint8Array): CesrFrame | null {
  try {
    const frames = parseBytes(wire);
    return frames.length === 1 ? frames[0] : null;
  } catch (error) {
    if (error instanceof ParserError) return null;
    throw error;
  }
}

/**
 * Collect a v2 child's own wire, or null when it does not re-enclose as exactly one complete message.
 *
 * @param child Bound nested child, borrowed for this operation.
 * @returns The child's complete wire, or null.
 */
function* collectNestedMessage(child: CesrFrame): Operation<Uint8Array | null> {
  let payload: Payload;
  try {
    payload = nestedPayload(child, Vrsn_2_0);
  } catch (error) {
    if (error instanceof ParserError) return null;
    throw error;
  }
  // Mailbox LMDB and Poster take one finite message; collect one child, never the whole exchange stream.
  const wire = yield* abortable((signal) => collectPayload(payload, signal));
  return oneCompleteMessage(wire) ? wire : null;
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
 * Rebuild the legacy embed into its one message, or null when it is not exactly one complete message.
 *
 * The body is serialized from `e.evt`, followed by only the attachment material pathed to `/e/evt`; other pathed
 * groups belong to the outer `/fwd`. The result must parse as exactly one complete message with its attachments, so
 * an embed that is not a message, or whose pathed attachments are not that message's complete attachments, is
 * refused here and never reaches the mailbox store, this runtime's ingress or the Poster.
 *
 * @param serder Legacy forwarding exchange containing an e.evt body.
 * @param attachments Pathed attachments; only /e/evt material belongs to the embedded message.
 * @returns The forwarded message, or null.
 */
function legacyForwardedMessage(
  serder: SerderKERI,
  attachments: readonly ExchangeAttachment[],
): ForwardedMessage | null {
  const embeds = serder.ked?.e as Record<string, unknown> | undefined;
  const evt = embeds?.evt;
  if (!evt || typeof evt !== "object" || Array.isArray(evt)) {
    return null;
  }
  const parts: Uint8Array[] = [];
  try {
    parts.push(embeddedSerderRaw(evt as Record<string, unknown>));
    for (const attachment of attachments) {
      const atc = forwardedAttachmentForPath(attachment.raw, "/e/evt");
      if (atc) parts.push(atc);
    }
  } catch (error) {
    // The embed's SAD and the pathed groups are remote input; the codec refuses what it cannot serialize or read.
    if (error instanceof ParserError) return null;
    throw error;
  }
  const wire = concatBytes(...parts);
  const frame = oneCompleteMessage(wire);
  return frame ? { wire, frame } : null;
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
