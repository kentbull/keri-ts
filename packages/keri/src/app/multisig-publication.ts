/** Signed group proposal records and concrete Poster delivery, independent of approval policy. */
import { concatBytes } from "cesr-ts";
import type { Operation } from "effection";
import type { Poster } from "./forwarding.ts";
import { uniqueMembers } from "./group-members.ts";
import { type MultisigMessage, multisigProposalSaid } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";

/** Recipient-specific wrapper identity and its shared Multiplexor proposal index key. */
export interface ProposalIdentity {
  recipient: string;
  said: string;
  proposal: string;
}

/** Complete signed proposal ready for local admission or concrete transmission. */
export interface SignedGroupProposal extends ProposalIdentity {
  src: string;
  message: Uint8Array;
}

/** Actual delivery outcome, distinct from group acceptance. */
export interface ProposalDelivery extends ProposalIdentity {
  deliveries: string[];
}

/** Public publication facts for exact selection, without treating transport as approval. */
export interface ProposalPublication {
  proposals: ProposalIdentity[];
  deliveries: string[];
}

/** Select unique remote member AIDs, preserving the supplied member order. */
export function remoteProposalMembers(hby: Habery, member: Hab, recipients: readonly string[]): string[] {
  return uniqueMembers(recipients).filter(recipient => recipient !== member.pre && !hby.habs.has(recipient));
}

/** Sign one prepared wrapper once; callers decide when to admit its exact bytes locally. */
export function signGroupProposal(
  member: Hab,
  recipient: string,
  [serder, attachments]: MultisigMessage,
): SignedGroupProposal {
  const proposal = multisigProposalSaid(serder);
  if (!serder.said || !proposal) throw new Error("Constructed multisig wrapper lacks its proposal identity");
  return {
    src: member.pre,
    recipient,
    said: serder.said,
    proposal,
    message: concatBytes(member.endorse(serder, { pipelined: false }), attachments),
  };
}

/** Send the prepared bytes and await Poster completion; no worker or protocol policy is created here. */
export function* sendGroupProposal(postman: Poster, prepared: SignedGroupProposal): Operation<ProposalDelivery> {
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
    said: prepared.said,
    proposal: prepared.proposal,
    deliveries: [...outcome.deliveries],
  };
}

/** Project successful recipient outcomes into CLI identities and completed target URLs. */
export function proposalPublication(outcomes: readonly ProposalDelivery[]): ProposalPublication {
  return {
    proposals: outcomes.map(({ recipient, said, proposal }) => ({ recipient, said, proposal })),
    deliveries: outcomes.flatMap(outcome => outcome.deliveries),
  };
}
