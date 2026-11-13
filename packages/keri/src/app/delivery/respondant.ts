import type { AgentCue } from "../../core/cues.ts";
import { Deck } from "../../core/deck.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import type { Poster } from "./forwarding.ts";

/**
 * What `Respondant.enqueueCue` did with the head cue:
 * - `taken`: removed, after its signed output was admitted to Poster or because it had nowhere to go;
 * - `unrouted`: left at the head, as it has no responder output (no recipient, topic or sender);
 * - `unsignable`: left at the head, as the signing habitat cannot sign now (its signer is not held yet).
 */
export type CueOutcome = "taken" | "unrouted" | "unsignable";

/**
 * Shared host-side responder for indirect and witness runtimes.
 *
 * KERIpy correspondence:
 * - this is the local analogue of `Respondant` for reply/replay/receipt-style
 *   cues
 * - `BaseHab.processCuesIter()` interprets the cue; `Poster` delivers the
 *   resulting bytes
 * - mailbox-query `stream` cues stay with mailbox storage/query coordination
 *
 * Boundary rule:
 * - this class constructs signed non-`stream` output and admits it to Poster
 * - `MailboxDirector` owns provider publication and `stream` cue correlation,
 *   using its separately owned Mailboxer for actual storage
 * - ordinary query replies follow this output path rather than returning from
 *   the HTTP query POST; direct TCP correlation claims its own reply cues first
 *
 * Source cue removal proves complete output admission, not delivery. Poster runs
 * independently and owns routing, transport attempts and failure outcomes. Keep
 * mailbox provider writes in that routing path, not in responder cue interpretation.
 */
export class Respondant {
  /** Borrowed local signer and accepted-state collection. */
  private readonly hby: Habery;
  /** Delivery owner; source cues are consumed only after its admission succeeds. */
  private readonly postman: Poster;
  /** Bind borrowed identity and delivery owners without acquiring stores or network lifetimes. */
  constructor(hby: Habery, postman: Poster) {
    this.hby = hby;
    this.postman = postman;
  }

  /**
   * Produce a whole cue before publishing or removing it; construction failure leaves the source visible.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param cues Source Deck; only its current head is interpreted, and removed after full publication.
   * @param hint Optional local sender hint used when cue provenance does not resolve a habitat.
   * @returns What became of the head; see {@link CueOutcome}. Only `taken` removes it.
   * @throws Construction/admission failures leave the source cue present.
   */
  enqueueCue(hab: Hab, cues: Deck<AgentCue>, hint?: Hab | null): CueOutcome {
    this.postman.ensureOpen();
    const cue = cues.peekHead();
    if (!cue) return "unrouted";
    const dest = recipientForCue(cue), topic = topicForCue(cue);
    const src = senderHabForCue(this.hby, cue, hint);
    if (this.nothingToSend(cue, dest, topic, src)) {
      cues.pull();
      return "taken";
    }
    if (!dest || !topic || !src) return "unrouted";
    // A replay carries already-signed messages; receipts, witness receipts and replies are signed here.
    if (cue.kin !== "replay" && !hab.canSign()) return "unsignable";
    const msgs = [...hab.processCuesIter([cue])];
    this.postman.sendAll(msgs.map((msg) => ({ src: src.pre, dest, topic, msg, replies: true })));
    cues.pull();
    return "taken";
  }

  /**
   * Whether a receipt cue has nothing to send to. A receipt goes to the controller of the event it receipts, so it
   * has nowhere to go when that controller is a group this runtime is a member of (the group's own event: its
   * members are the Counselor's business) or when the controller has no end role to deliver to. Deciding that here
   * keeps an attempt that could only fail from being made, and logged, for every event of a group.
   */
  private nothingToSend(cue: AgentCue, dest: string | null, topic: string | null, src: Hab | null): boolean {
    if ((cue.kin !== "receipt" && cue.kin !== "witness") || !dest || !topic) return false;
    const subject = this.hby.habs.get(dest);
    if (subject && isLocalGroupHab(this.hby, subject)) return true;
    return !!src && !this.postman.canReach(src.pre!, dest, topic);
  }

  /**
   * Admit already produced witness messages without signing them again.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param cue Routing/provenance cue for the already-signed output.
   * @param msgs Complete signed messages; Poster copies them during atomic admission.
   */
  enqueueMsgs(hab: Hab, cue: AgentCue, msgs: readonly Uint8Array[]): void {
    const dest = recipientForCue(cue), topic = topicForCue(cue);
    const src = senderHabForCue(this.hby, cue, hab);
    if (this.nothingToSend(cue, dest, topic, src)) return;
    if (!dest || !topic || !src) return;
    this.postman.sendAll(msgs.map((msg) => ({ src: src.pre, dest, topic, msg, replies: true })));
  }
}

/**
 * Select the existing mailbox topic for a responder cue.
 *
 * @param cue Typed cue whose family determines the field meaning.
 * @returns Mailbox topic or null for a non-responder cue.
 */
function topicForCue(
  cue: AgentCue,
): string | null {
  switch (cue.kin) {
    case "replay":
      return "/replay";
    case "reply":
      return "/reply";
    case "receipt":
    case "witness":
      return "/receipt";
    default:
      return null;
  }
}

/**
 * Select the intended recipient without preparing or transmitting bytes.
 *
 * @param cue Typed cue whose family determines the field meaning.
 * @returns Final recipient AID, or null when this cue has none.
 */
function recipientForCue(
  cue: AgentCue,
): string | null {
  switch (cue.kin) {
    case "replay":
      return cue.dest ?? null;
    case "reply":
      return cue.dest ?? null;
    case "receipt":
    case "witness":
      return cue.serder.pre ?? null;
    default:
      return null;
  }
}

/**
 * Borrow the local sender selected by cue provenance, explicit hint or sole habitat.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param cue Cue whose src may identify a local sender.
 * @param hab Optional fallback habitat hint.
 * @returns Cue-selected habitat, hint or sole local habitat; null if unresolved.
 */
function senderHabForCue(
  hby: Habery,
  cue: AgentCue,
  hab?: Hab | null,
): Hab | null {
  const source = cueSourcePrefix(cue);
  if (source) {
    return hby.habs.get(source) ?? hab ?? soleHab(hby);
  }
  return hab ?? soleHab(hby);
}

/**
 * Read explicit local sender provenance only from cue families that carry it.
 *
 * @param cue Typed cue whose family determines the field meaning.
 * @returns Explicit local sender AID for reply/replay, or null.
 */
function cueSourcePrefix(
  cue: AgentCue,
): string | null {
  switch (cue.kin) {
    case "replay":
      return cue.src ?? null;
    case "reply":
      return cue.src ?? null;
    default:
      return null;
  }
}

/**
 * Use an implicit signer only when the local collection is unambiguous.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @returns The only local habitat, or null for zero/multiple candidates.
 */
function soleHab(hby: Habery): Hab | null {
  const habitats = hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}
