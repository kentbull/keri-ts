/**
 * Common signing, exact local admission and sending for multisig coordination.
 * KERI workflows own proposal/approval policy; Tufa projects returned facts into
 * CLI output. This module neither formats output nor starts a delivery worker.
 *
 * The outer EXN is recipient-specific. Its exnSaid is the join --said selector;
 * payloadSaid identifies the Multiplexor aggregation shared by contributions.
 * Neither completed transport nor collection of these identities proves group
 * acceptance. Callers must check their own accepted KEL/RPY/TEL/credential state.
 */
import { concatBytes, Counter, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import type { Operation } from "effection";
import type { Baser } from "../../db/basing.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import { abortable } from "../runtime/abortable.ts";
import { collectBytes } from "../transport/byte-source.ts";
import { uniqueMembers } from "./group-members.ts";
import type { MultisigMessage } from "./grouping.ts";

/** Recipient-specific wrapper identity and its shared Multiplexor proposal index key. */
export interface GroupMessageRef {
  /** Intended participant AID; this is not a resolved transport URL. */
  recipient: string;
  /** Outer multisig coordination EXN SAID; also selected by join --said. */
  exnSaid: string;
  /** Multiplexor key: v1 embedded-bundle SAID or supported v2 signed-child SAID. */
  payloadSaid: string;
}

/** Complete signed proposal ready for local admission or concrete transmission. */
export interface SignedGroupMessage extends GroupMessageRef {
  src: string;
  message: Uint8Array;
}

/** Completed transport destinations, not participant approval or group acceptance. */
export interface GroupDelivery extends GroupMessageRef {
  /** Successful transport destinations reported by this one concrete Poster admission. */
  deliveries: string[];
}

/** Public publication facts for exact selection, without treating transport as approval. */
export interface GroupSendResult {
  /** Recipient-specific outer/aggregate identities, in completed send order. */
  messages: GroupMessageRef[];
  /** Flattened completed destinations, preserving order and any repeats across messages. */
  deliveries: string[];
}

/** Select unique remote member AIDs, preserving the supplied member order. */
export function remoteGroupMembers(hby: Habery, member: Hab, recipients: readonly string[]): string[] {
  return uniqueMembers(recipients).filter((recipient) => recipient !== member.pre && !hby.habs.has(recipient));
}

/**
 * Read the proposal index identity without authenticating its evidence.
 * V1 commits the embedded bundle; v2 signs one child SAID. Multiplexor verifies
 * those commitments and owns accepted proposal/submitter indexes separately.
 */
export function multisigPayloadSaid(serder: SerderKERI): string | null {
  const ked = serder.ked;
  if (!ked) return null;
  if (serder.pvrsn.major === 1) {
    const said = multisigEmbeddedSection(ked)?.d;
    return typeof said === "string" && said.length > 0 ? said : null;
  }
  const route = serder.route ?? "";
  const said = payloadSection(
    ked,
  )[(route === "/multisig/rip" || route === "/multisig/bup") ? "anc" : route.slice(route.lastIndexOf("/") + 1)];
  return typeof said === "string" && said.length > 0 ? said : null;
}

/** Read the legacy embedded bundle using the same shape as Multiplexor verification. */
export function multisigEmbeddedSection(ked: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(ked.e) && typeof ked.e.d === "string") {
    return ked.e;
  }
  const attrs = payloadSection(ked);
  return isRecord(attrs.e) && typeof attrs.e.d === "string" ? attrs.e : null;
}

/** Read the signed attributes without interpreting protocol-specific fields. */
function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
  return isRecord(ked.a) ? ked.a : {};
}

/** Restrict SAD section access to ordinary records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Find an accepted local contribution in the ordinary Multiplexor index.
 * An optional destination selects its original recipient-specific wrapper.
 * The index locates evidence; accepted sender, route and payload must all agree.
 */
export function storedGroupMessage(
  db: Baser,
  member: string,
  proposal: SerderKERI,
  recipient?: string,
): SerderKERI | null {
  const payloadSaid = multisigPayloadSaid(proposal);
  if (!payloadSaid) return null;
  for (const indexed of db.meids.get([payloadSaid])) {
    const stored = db.exns.get([indexed.qb64]);
    if (
      !stored || stored.pre !== member || stored.route !== proposal.route
      || multisigPayloadSaid(stored) !== payloadSaid
    ) continue;
    const destination = stored.pvrsn.major === 1 ? stored.ked?.rp : stored.ked?.ri;
    if (recipient !== undefined && destination !== recipient) continue;
    return stored;
  }
  return null;
}

/**
 * Reconstruct an existing recipient wrapper, or sign its first publication.
 * Replay validates retained authentication and preserves the original EXN SAID;
 * a retry never replaces an already recorded wrapper with a new timestamp/nonce.
 * Missing fanout destinations can still receive the same approved child in a
 * newly signed outer wrapper. No group-event signature is made here.
 */
export function* prepareGroupMessage(
  exchanger: Exchanger,
  member: Hab,
  recipient: string,
  prepared: MultisigMessage,
): Operation<SignedGroupMessage> {
  const stored = storedGroupMessage(exchanger.hby.db, member.pre, prepared[0], recipient);
  if (!stored) return signGroupMessage(member, recipient, prepared);
  const message = yield* abortable((signal) => collectBytes(exchanger.replay(stored.said!, signal)));
  return {
    src: member.pre,
    recipient,
    exnSaid: stored.said!,
    payloadSaid: multisigPayloadSaid(stored)!,
    message,
  };
}

/**
 * Endorse one prepared outer EXN once, retaining its accompanying child evidence.
 * Extracting payloadSaid here checks shape, not authentication or approval;
 * Multiplexor validates the commitment during normal protocol intake.
 * The prepared tuple supplies the EXN Serder and accompanying child attachments.
 *
 * @param member Local participant signing Hab, distinct from the group AID.
 * @param recipient Intended remote participant, already resolved by the workflow.
 * @returns One signed packet reused for local admission and remote publication.
 */
export function signGroupMessage(
  member: Hab,
  recipient: string,
  [serder, attachments]: MultisigMessage,
): SignedGroupMessage {
  const payloadSaid = multisigPayloadSaid(serder);
  if (!serder.said || !payloadSaid) throw new Error("Constructed multisig wrapper lacks its proposal identity");
  const endorsed = member.endorse(serder, { pipelined: false });
  const message = serder.pvrsn.major === 2
    ? concatBytes(
      serder.raw,
      Counter.enclose({
        code: "AttachmentGroup",
        version: Vrsn_2_0,
        qb64: concatBytes(endorsed.subarray(serder.raw.length), attachments),
      }),
    )
    : concatBytes(endorsed, attachments);
  return {
    src: member.pre,
    recipient,
    exnSaid: serder.said,
    payloadSaid,
    message,
  };
}

/**
 * Publish prepared bytes on the multisig topic and await this admission's outcome.
 * The caller must run Poster.deliverDo concurrently and keep its stores alive.
 * A failed outcome throws its original error; earlier successful fanout is not
 * rolled back. Cancellation stops observation, not already admitted delivery.
 * Returning reports completed destinations, never participant approval.
 */
export function* sendGroupMessage(
  postman: Poster,
  prepared: SignedGroupMessage,
): Operation<GroupDelivery> {
  const evt = postman.send({
    src: prepared.src,
    dest: prepared.recipient,
    msg: prepared.message,
    topic: "multisig",
  }, { notify: true });
  const outcome = yield* postman.wait(evt);
  if (outcome.kin === "failed") throw outcome.error;
  return {
    recipient: prepared.recipient,
    exnSaid: prepared.exnSaid,
    payloadSaid: prepared.payloadSaid,
    deliveries: [...outcome.deliveries],
  };
}

/** Collect successful recipient outcomes into message identities and completed target URLs. */
export function groupSendResult(outcomes: readonly GroupDelivery[]): GroupSendResult {
  return {
    messages: outcomes.map(({ recipient, exnSaid, payloadSaid }) => ({ recipient, exnSaid, payloadSaid })),
    deliveries: outcomes.flatMap((outcome) => outcome.deliveries),
  };
}

/**
 * Process the exact signed local contribution before admitting remote delivery,
 * so an immediate peer reply cannot outrun local Multiplexor evidence. Await
 * normal intake, then send the same bytes without signing again. Intake or send
 * failures propagate; no cross-store/network transaction is implied.
 */
export function* admitAndSendGroupMessage(
  input: Reactor,
  postman: Poster,
  prepared: SignedGroupMessage,
): Operation<GroupDelivery> {
  yield* input.processBytes(prepared.message, { local: true });
  return yield* sendGroupMessage(postman, prepared);
}
