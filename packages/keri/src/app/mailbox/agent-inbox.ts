/**
 * The host's inbox rules: what a host keeps for pickup by an identifier that runs elsewhere, under the storing roles
 * it honours (`mailbox` and `agent`), and which raw arrivals it keeps for an identifier that authorized it as `agent`.
 *
 * A KERIpy or KERIA sender reaches an agent with `sendDirect`: one bare signed message per request, no `/fwd`, no
 * topic and often no recipient (keripy forwarding.py `Poster.deliverDo`; keria indirecting.py `HttpEnd.on_post`).
 * The agent processes that message as its own input (dispatch is the single ingest). For an identifier that runs
 * elsewhere (an edge) and authorized this host as its agent, the host also keeps one copy in the edge's mailbox
 * topic, where the edge polls it. This module decides that copy and writes it; it owns no store and no registry and
 * reads only accepted `ends.` rows, local habitats and accepted key state.
 *
 * A `/fwd` names its recipient and topic; the forward handler stores it under {@link keepsForPickup} and
 * {@link ownTraffic}. A raw arrival is kept only under the `agent` role: a sender reaches a `mailbox` with `/fwd`.
 *
 * Raw-arrival rules:
 * - Principal: an identifier with an allowed or enabled `ends.[cid, agent, host]` row.
 * - With a named recipient R, the one principal is R when it authorized the host as agent and
 *   {@link keepsForPickup}; otherwise nothing is kept.
 * - With no named recipient, every principal that is not a local habitat (a local group is processed by its hosted
 *   co-member through dispatch, so the edge receives one copy under its member AID).
 * - Never kept: {@link ownTraffic}, a message whose originator is a local habitat, a principal of the host, or a
 *   member of the recipient group (an edge's own traffic, or a local group's own events); and a message whose topic,
 *   derived from its remote route, the mailbox store cannot key.
 * - Kept only when the body verifies its SAID, carries attached authentication, and the agent's own processor
 *   decided it from content it decoded ({@link keptDecision}). The edge is the verifier of signatures and state and
 *   re-verifies everything, so a decision that waits on state is kept: `accept`, `escrow`, KRAM `pending`/`missing`
 *   and an `unverified` reply. The agent never keeps what it could not decode: a message dispatch refuses as
 *   malformed is a `reject` or `drop` and is not kept, nor is a KEL event's `ooo` or `duplicitous` escrow (decided
 *   from its prefix, sequence number and SAID before the agent evaluated its keys, thresholds or signatures), nor a
 *   message no processor decided (none reports a decision), except a receipt, whose processor decodes it and reports
 *   none.
 */
import {
  type CesrFrame,
  collectPayload,
  framePayload,
  Ilks,
  SerderACDC,
  SerderKERI,
} from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { EscrowKind } from "../../core/kel/kever-decisions.ts";
import {
  CREDENTIAL_MAILBOX_TOPIC,
  DELEGATE_MAILBOX_TOPIC,
  RECEIPT_MAILBOX_TOPIC,
  REPLAY_MAILBOX_TOPIC,
  REPLY_MAILBOX_TOPIC,
} from "../../core/mailbox/mailbox-topics.ts";
import { Roles } from "../../core/roles.ts";
import { storableTopic } from "../../db/mailbox/mailboxing.ts";
import type { Habery } from "../identity/habbing.ts";
import { isAcceptedGroupMember } from "../multisig/group-members.ts";
import { type DispatchDecision, envelopeFromFrame } from "../protocol/parsering.ts";
import { abortable } from "../runtime/abortable.ts";
import type { MailboxDirector } from "./mailbox-director.ts";
import { mailboxTopicKey } from "./mailboxing.ts";
import { mailboxTopicForRoute } from "./topic-routing.ts";

/**
 * Whether `cid` authorized `hostAid` under a storing role: row `ends.[cid, mailbox, hostAid]` or
 * `ends.[cid, agent, hostAid]`, allowed or enabled. Witness membership is not a storing role here.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param cid Identifier whose end-role authorization is read.
 * @param hostAid Endpoint AID the role must name.
 * @returns True when either row authorizes the host.
 */
export function authorizedStoringHost(hby: Habery, cid: string, hostAid: string): boolean {
  return [Roles.mailbox, Roles.agent].some((role) => {
    const end = hby.db.ends.get([cid, role, hostAid]);
    return !!(end?.allowed || end?.enabled);
  });
}

/**
 * Whether `cid` authorized `hostAid` as its agent: row `ends.[cid, agent, hostAid]`, allowed or enabled.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param cid Identifier whose end-role authorization is read.
 * @param hostAid Local endpoint AID the role must name.
 * @returns True when the accepted row authorizes the host.
 */
export function authorizedAgent(hby: Habery, cid: string, hostAid: string): boolean {
  const end = hby.db.ends.get([cid, Roles.agent, hostAid]);
  return !!(end?.allowed || end?.enabled);
}

/**
 * Whether this host keeps mail for pickup for `recipient`: the recipient authorized it under a storing role
 * ({@link authorizedStoringHost}) and is either remote (an edge) or a local group (whose remote members poll the
 * group's mailbox). A local single-sig habitat processes its own mail here and has nobody to pick it up.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param recipient Identifier the message is addressed to.
 * @param hostAid Local endpoint AID that received the message.
 * @returns True when the host keeps a copy in the recipient's mailbox.
 */
export function keepsForPickup(hby: Habery, recipient: string, hostAid: string): boolean {
  return authorizedStoringHost(hby, recipient, hostAid) && (!hby.habs.has(recipient) || hby.db.groups.has(recipient));
}

/**
 * Whether a message is traffic of the very identifiers that would pick it up, which is never kept: its originator
 * is a local habitat, authorized `hostAid` as agent, or is an accepted member of the recipient group (the edge
 * member that polls the group's mailbox). An edge does not pick up what it sent, and a local group's own events
 * reach its remote members through their own exchanges.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param originator The message's own `i` (an ACDC's issuer), or null when it names none.
 * @param recipient Named recipient, or null when the message names none.
 * @param hostAid Local endpoint AID that received the message.
 * @returns True when the message must not be kept.
 */
export function ownTraffic(hby: Habery, originator: string | null, recipient: string | null, hostAid: string): boolean {
  if (!originator) return false;
  if (hby.habs.has(originator) || authorizedAgent(hby, originator, hostAid)) return true;
  return recipient !== null && hby.db.groups.has(recipient) && isAcceptedGroupMember(hby.db, recipient, originator);
}

/**
 * The recipient a raw message names, or null when it names none.
 *
 * An exn or xip names it in `rp` (v1) or `ri` (v2) when non-empty. A delegated event is addressed to its delegator:
 * a `dip` carries it in `di`; a `drt` carries no `di`, so its delegator is read from the delegate's accepted key
 * state (dispatch has already run, so a `drt` the agent accepted or escrowed has its `dip` behind it).
 *
 * @param hby Borrowed accepted-state database, read only for a `drt`'s delegator.
 * @param serder Raw message body.
 * @returns Named recipient AID, or null.
 */
export function rawRecipient(hby: Habery, serder: SerderKERI): string | null {
  switch (serder.ilk) {
    case Ilks.exn:
    case Ilks.xip: {
      const named = serder.ked?.rp ?? serder.ked?.ri;
      return typeof named === "string" && named.length > 0 ? named : null;
    }
    case Ilks.dip:
      return serder.delpre;
    case Ilks.drt:
      return serder.pre ? hby.db.getKever(serder.pre)?.delpre ?? null : null;
    default:
      return null;
  }
}

/**
 * Mailbox topic for a raw message; null means it is never kept.
 *
 * | body | topic |
 * | --- | --- |
 * | exn/xip | `mailboxTopicForRoute(route)` |
 * | exn `/fwd`, qry, other ilks | null (host-addressed transport or nothing to pick up) |
 * | dip/drt addressed to its delegator | `/delegate` |
 * | other KEL events | `/replay` |
 * | rct | `/receipt` |
 * | rpy | `/reply` |
 * | TEL events and ACDC bodies | `/credential` |
 *
 * @param body Raw message body.
 * @param recipient Recipient from {@link rawRecipient}; for a dip/drt, its delegator.
 * @returns Mailbox topic, or null.
 */
export function rawMailboxTopic(body: SerderKERI | SerderACDC, recipient: string | null): string | null {
  if (body instanceof SerderACDC) return CREDENTIAL_MAILBOX_TOPIC;
  switch (body.ilk) {
    case Ilks.exn:
    case Ilks.xip: {
      if (body.route === "/fwd") return null;
      const topic = mailboxTopicForRoute(body.route ?? "");
      return topic.length > 0 ? topic : null;
    }
    case Ilks.dip:
    case Ilks.drt:
      return recipient !== null ? DELEGATE_MAILBOX_TOPIC : REPLAY_MAILBOX_TOPIC;
    case Ilks.icp:
    case Ilks.rot:
    case Ilks.ixn:
      return REPLAY_MAILBOX_TOPIC;
    case Ilks.rct:
      return RECEIPT_MAILBOX_TOPIC;
    case Ilks.rpy:
      return REPLY_MAILBOX_TOPIC;
    case Ilks.vcp:
    case Ilks.vrt:
    case Ilks.iss:
    case Ilks.rev:
    case Ilks.bis:
    case Ilks.brv:
      return CREDENTIAL_MAILBOX_TOPIC;
    default:
      return null;
  }
}

/** One raw message the host's ingress has just dispatched. */
export interface RawArrival {
  /** The complete parsed frame, borrowed from the request parser for this call. */
  readonly frame: CesrFrame;
  /** Local endpoint AID the request addressed. */
  readonly hostAid: string;
  /** The agent's own dispatch decision for this frame. */
  readonly decision: DispatchDecision | undefined;
}

/**
 * Store one dispatched raw arrival once for each of its principals (see the module rules).
 *
 * @param director Borrowed mailbox owner; a host without a mailbox store keeps nothing.
 * @param arrival The dispatched frame, its host and the agent's decision.
 * @returns Number of mailbox entries written.
 */
export function* keepRawArrival(director: MailboxDirector, arrival: RawArrival): Operation<number> {
  const hby = director.hby;
  const body = arrival.frame.body;
  if (!director.mailboxer || !(body instanceof SerderKERI || body instanceof SerderACDC)) return 0;
  if (!keptDecision(body, arrival.decision) || !saidVerifies(body)) return 0;
  const recipient = body instanceof SerderKERI ? rawRecipient(hby, body) : null;
  const topic = rawMailboxTopic(body, recipient);
  if (topic === null || !authenticated(arrival.frame)) return 0;
  const originator = body instanceof SerderKERI ? body.pre : body.issuer;
  if (!rawPrincipals(hby, originator, recipient, arrival.hostAid).length) return 0;
  const wire = yield* abortable((signal) => collectPayload(framePayload(arrival.frame), signal));
  // Re-read accepted authority in the same synchronous turn as publication. The topic comes from a remote route; one
  // the mailbox store cannot key is not kept, never a store fault.
  const principals = rawPrincipals(hby, originator, recipient, arrival.hostAid)
    .filter((principal) => storableTopic(mailboxTopicKey(principal, topic)));
  for (const principal of principals) director.publish(principal, topic, wire);
  return principals.length;
}

/**
 * The principals one raw arrival is kept for, from current accepted state; empty when it is never kept.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param originator The message's own `i` (an ACDC's issuer), or null.
 * @param recipient Named recipient from {@link rawRecipient}, or null.
 * @param hostAid Local endpoint AID that received the message.
 * @returns Principals to publish under, in a stable order.
 */
function rawPrincipals(hby: Habery, originator: string | null, recipient: string | null, hostAid: string): string[] {
  if (ownTraffic(hby, originator, recipient, hostAid)) return [];
  if (recipient !== null) {
    return authorizedAgent(hby, recipient, hostAid) && keepsForPickup(hby, recipient, hostAid) ? [recipient] : [];
  }
  return agentPrincipals(hby, hostAid);
}

/**
 * Every remote identifier that authorized `hostAid` as its agent.
 *
 * `ends.` is keyed cid-first with no reverse index, so this scans every row; it runs only for a message that names
 * no recipient. One Habery serves one account downstream, so the table is that account's contacts' roles.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param hostAid Local endpoint AID.
 * @returns Principals in stored key order.
 */
function agentPrincipals(hby: Habery, hostAid: string): string[] {
  const cids: string[] = [];
  for (const [[cid, role, eid], end] of hby.db.ends.getTopItemIter()) {
    if (role === Roles.agent && eid === hostAid && (end.allowed || end.enabled) && !hby.habs.has(cid)) cids.push(cid);
  }
  return cids;
}

/**
 * Whether the agent's decision shows it decoded the message and leaves it worth delivering: not refused, not a repeat
 * of what it holds, and decided from the message's content rather than before reading it. See the module rules.
 *
 * Malformed fields are the dispatch processors' typed `reject` or `drop`; this reads only the decision they return.
 *
 * @param body Dispatched message body.
 * @param decision Dispatch decision; undefined when no processor reported one.
 * @returns True for `accept`, `escrow` (except a KEL event's `ooo` or `duplicitous`), `pending`, `missing` and
 *   `unverified`, and for a receipt with no decision; false otherwise.
 */
function keptDecision(body: SerderKERI | SerderACDC, decision: DispatchDecision | undefined): boolean {
  if (!decision) return body instanceof SerderKERI && body.ilk === Ilks.rct;
  switch (decision.kind) {
    case "accept":
    case "pending":
    case "missing":
    case "unverified":
      return true;
    case "escrow":
      return !(KEL_EVENT_ILKS.has(body.ilk ?? "") && PRE_EVALUATION_ESCROWS.has(decision.reason));
    default:
      return false;
  }
}

/** Ilks dispatched to Kevery as key events; their escrow decision carries an `EscrowKind` reason. */
const KEL_EVENT_ILKS: ReadonlySet<string> = new Set([Ilks.icp, Ilks.rot, Ilks.ixn, Ilks.dip, Ilks.drt]);

/** Kevery escrows decided from a key event's prefix, sequence number and SAID alone, before Kever evaluates it. */
const PRE_EVALUATION_ESCROWS: ReadonlySet<string> = new Set<EscrowKind>(["ooo", "duplicitous"]);

/** Whether the body's SAID matches its content. */
function saidVerifies(body: SerderKERI | SerderACDC): boolean {
  try {
    return body.verify();
  } catch {
    return false;
  }
}

/**
 * Whether the frame carries any attached signature, receipt or seal-source authentication.
 *
 * @param frame Dispatched frame.
 * @returns True when the normalized attachments include authentication material.
 */
function authenticated(frame: CesrFrame): boolean {
  const envelope = envelopeFromFrame(frame);
  return [
    envelope.sigers,
    envelope.wigers,
    envelope.cigars,
    envelope.trqs,
    envelope.tsgs,
    envelope.ssgs,
    envelope.sscs,
    envelope.ssts,
  ].some((material) => material.length > 0);
}
