/** Signed group proposal records and concrete Poster delivery, independent of approval policy. */
import { concatBytes, type SerderKERI } from "cesr-ts";
import type { Operation } from "effection";
import type { Poster } from "./forwarding.ts";
import { uniqueMembers } from "./group-members.ts";
import type { MultisigMessage } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { Reactor } from "./reactor.ts";

/** Recipient-specific wrapper identity and its shared Multiplexor proposal index key. */
export interface MultisigMessageIdentity {
  recipient: string;
  /** Outer multisig coordination EXN SAID; also selected by join --said. */
  exnSaid: string;
  /** Multiplexor key: v1 embedded-bundle SAID or supported v2 signed-child SAID. */
  payloadSaid: string;
}

/** Complete signed proposal ready for local admission or concrete transmission. */
export interface SignedMultisigMessage extends MultisigMessageIdentity {
  src: string;
  message: Uint8Array;
}

/** Completed transport destinations, not participant approval or group acceptance. */
export interface MultisigMessageDelivery extends MultisigMessageIdentity {
  deliveries: string[];
}

/** Public publication facts for exact selection, without treating transport as approval. */
export interface MultisigSendResult {
  messages: MultisigMessageIdentity[];
  deliveries: string[];
}

/** Select unique remote member AIDs, preserving the supplied member order. */
export function remoteMultisigMembers(hby: Habery, member: Hab, recipients: readonly string[]): string[] {
  return uniqueMembers(recipients).filter(recipient => recipient !== member.pre && !hby.habs.has(recipient));
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
  const said = payloadSection(ked)[route.slice(route.lastIndexOf("/") + 1)];
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

/** Sign one prepared wrapper once; callers decide when to admit its exact bytes locally. */
export function signMultisigMessage(
  member: Hab,
  recipient: string,
  [serder, attachments]: MultisigMessage,
): SignedMultisigMessage {
  const payloadSaid = multisigPayloadSaid(serder);
  if (!serder.said || !payloadSaid) throw new Error("Constructed multisig wrapper lacks its proposal identity");
  return {
    src: member.pre,
    recipient,
    exnSaid: serder.said,
    payloadSaid,
    message: concatBytes(member.endorse(serder, { pipelined: false }), attachments),
  };
}

/** Send the prepared bytes and await Poster completion; no worker or protocol policy is created here. */
export function* sendMultisigMessage(
  postman: Poster,
  prepared: SignedMultisigMessage,
): Operation<MultisigMessageDelivery> {
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
export function multisigSendResult(outcomes: readonly MultisigMessageDelivery[]): MultisigSendResult {
  return {
    messages: outcomes.map(({ recipient, exnSaid, payloadSaid }) => ({ recipient, exnSaid, payloadSaid })),
    deliveries: outcomes.flatMap(outcome => outcome.deliveries),
  };
}

/** Admit the exact signed local contribution before sending can elicit a peer response. */
export function* processAndSendMultisigMessage(
  input: Reactor,
  postman: Poster,
  prepared: SignedMultisigMessage,
): Operation<MultisigMessageDelivery> {
  yield* input.processBytes(prepared.message, { local: true });
  return yield* sendMultisigMessage(postman, prepared);
}
