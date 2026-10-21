/** Authenticated /fwd intake: validate provider authority before storing reconstructed child bytes. */
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
import { type Operation } from "npm:effection@^3.6.0";
import type { Kever } from "../../core/kel/kever.ts";
import { Roles } from "../../core/roles.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import { abortable } from "../runtime/abortable.ts";
import type { MailboxDirector } from "./mailbox-director.ts";

/**
 * Accepted `/fwd` route handler that stores embedded payloads in mailbox topics.
 *
 * This is the `keri-ts` mailbox-storage analogue to KERIpy's `ForwardHandler`.
 *
 * Authorization rule:
 * - the request-scoped mailbox AID passed with this message must currently be
 *   authorized for the addressed recipient
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

  /**
   * Bind mailbox publication without acquiring a store.
   *
   * @param mailboxDirector Borrowed provider owner that publishes accepted forwarded payloads.
   */
  constructor(mailboxDirector: MailboxDirector) {
    this.mailboxDirector = mailboxDirector;
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
   * Store one forwarded payload when the receiving host is allowed to act as
   * the recipient's async correspondence store.
   *
   * Accepted host shapes:
   * - explicit mailbox provider authorized in `ends.`
   * - recipient witness host from the accepted KEL witness set
   * - recipient agent host authorized in `ends.`
   *
   * Controller endpoints stay excluded here because they are direct
   * correspondence destinations, not store-and-forward hosts.
   *
   * @param args Accepted exchange with borrowed attachments/children and receiving mailboxAid provenance.
   * @returns An operation for v2 child serialization, or synchronous completion/no-op for legacy or unauthorized input.
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

    if (!this.canStoreRecipient(recipient, mailboxAid)) return;
    if (child) {
      // Mailbox LMDB accepts a finite row; collect one child, never the whole exchange stream.
      return abortable(async (signal) => {
        const wire = await collectPayload(nestedPayload(child, Vrsn_2_0), signal);
        signal.throwIfAborted();
        if (this.canStoreRecipient(recipient, mailboxAid)) this.mailboxDirector.publish(recipient, topic, wire);
      });
    }
    this.mailboxDirector.publish(recipient, topic, forwarded!);
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

  for (const role of [Roles.mailbox, Roles.agent]) {
    const end = hby.db.ends.get([recipient, role, hostAid]);
    if (end?.allowed || end?.enabled) {
      return true;
    }
  }

  return false;
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
