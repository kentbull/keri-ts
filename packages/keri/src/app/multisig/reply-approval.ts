/** Exact retained group replies, separated from the application's approval policy. */
import {
  type AttachmentGroup,
  type CesrFrame,
  concatBytes,
  Counter,
  Ilks,
  isCounterGroupLike,
  parseBytes,
  SerderKERI,
  type Versionage,
} from "cesr-ts";
import { ValidationError } from "../../core/errors.ts";
import { serializeMessage } from "../../core/protocol-serialization.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import { groupSigningMembers, localGroupMember } from "./group-members.ts";
import { groupEndorseReply } from "./group-signing.ts";
import { MULTISIG_RPY_ROUTE, multisigChild } from "./grouping.ts";
import { multisigPayloadSaid } from "./multisig-messaging.ts";

/** Domain policy must raise or return false on refusal; it runs before consent and signing. */
export type ReplyValidator = (reply: SerderKERI) => void | boolean;

/** Inspected retained evidence, without local approval or any newly created signatures. */
export interface ReplyProposal {
  readonly wrapper: SerderKERI;
  readonly member: Hab;
  readonly child: CesrFrame;
  readonly genus: Versionage;
}

/** Use the existing local group and its member configuration, without a separate roster snapshot. */
function requireGroup(hby: Habery, group: string): void {
  const member = localGroupMember(hby, group);
  if (!hby.habs.has(group) || !hby.db.getKever(group) || !groupSigningMembers(hby, group).includes(member.pre)) {
    throw new ValidationError("Reply approval requires an accepted local signing group.");
  }
}

/** Admit signature families and their ordinary enclosure only, without ignoring other factors. */
function signatureOnly(group: AttachmentGroup): boolean {
  switch (group.name) {
    case "AttachmentGroup":
    case "BigAttachmentGroup":
      return group.items.every(item => isCounterGroupLike(item) && signatureOnly(item));
    case "TransIdxSigGroups":
    case "BigTransIdxSigGroups":
    case "NonTransReceiptCouples":
    case "BigNonTransReceiptCouples":
      return true;
    default:
      return false;
  }
}

/** Check reply attribution and the complete proof enclosure before invoking application policy. */
function validateReply(child: CesrFrame, group: string, validate: ReplyValidator): SerderKERI {
  const reply = child.body;
  if (
    typeof validate !== "function" || !(reply instanceof SerderKERI) || reply.ilk !== Ilks.rpy || !reply.verify()
    || (reply.pvrsn.major >= 2 && reply.pre !== group) || child.nests?.length || child.essrs?.length
    || child.attachments.some(attachment => !signatureOnly(attachment))
  ) throw new ValidationError("Reply approval requires one group reply with signature attachments.");
  if (validate(reply) === false) throw new ValidationError("Reply approval domain policy declined the body.");
  return reply;
}

/** Reopen precisely one retained reply; v1 retains its existing named-child wire boundary. */
function retainedReply(hby: Habery, wrapper: SerderKERI): { child: CesrFrame; genus: Versionage } {
  if (wrapper.pvrsn.major >= 2) {
    const nests = loadNests(hby.db, wrapper.said!);
    if (nests.length !== 1) throw new ValidationError("Reply proposal requires exactly one retained child.");
    return { child: nests[0], genus: nests[0].gvrsn ?? nests[0].body.gvrsn ?? nests[0].body.pvrsn };
  }
  const embedded = wrapper.ked?.e;
  if (
    !embedded || typeof embedded !== "object" || Array.isArray(embedded)
    || Object.keys(embedded).some(key => key !== "rpy" && key !== "d")
  ) throw new ValidationError("Reply proposal requires exactly one retained reply.");
  const stored = multisigChild(hby, wrapper, "rpy");
  if (!stored) throw new ValidationError("Reply proposal requires exactly one retained reply.");
  const frames = parseBytes(concatBytes(Counter.makeGVC(stored.genus), stored.event.raw, stored.attachment));
  if (frames.length !== 1) throw new ValidationError("Reply proposal requires exactly one retained reply.");
  return { child: frames[0], genus: stored.genus };
}

/**
 * Inspect authenticated retained evidence without signing, prompting or recording consent.
 * The application supplies the local group and required domain policy. A partial
 * child proof remains partial; its wrapper never supplies group reply authority.
 */
export function inspectReplyProposal(
  hby: Habery,
  exc: Exchanger,
  said: string,
  { group, validate }: { group: string; validate: ReplyValidator },
): ReplyProposal {
  requireGroup(hby, group);
  const wrapper = hby.db.exns.get([said]);
  const attrs = wrapper?.ked?.a;
  if (
    !wrapper || wrapper.route !== MULTISIG_RPY_ROUTE || !attrs || typeof attrs !== "object"
    || !("gid" in attrs) || attrs.gid !== group
    || !groupSigningMembers(hby, group).includes(wrapper.pre ?? "") || !exc.verifyAccepted(said, MULTISIG_RPY_ROUTE)
  ) throw new ValidationError("Reply proposal requires an authenticated current group member wrapper.");
  const { child, genus } = retainedReply(hby, wrapper);
  const reply = validateReply(child, group, validate);
  if (wrapper.pvrsn.major >= 2 && multisigPayloadSaid(wrapper) !== reply.said) {
    throw new ValidationError("Reply proposal does not commit to its exact child.");
  }
  requireGroup(hby, group);
  return { wrapper, member: localGroupMember(hby, group), child, genus };
}

/** Recheck policy and the local group, then add local signatures without mutating retained proofs. */
export function endorseReply(
  hby: Habery,
  child: CesrFrame,
  { group, validate }: { group: string; validate: ReplyValidator },
): Uint8Array {
  requireGroup(hby, group);
  const reply = validateReply(child, group, validate);
  requireGroup(hby, group);
  const retained = envelopeFromFrame(child);
  const genus = child.gvrsn ?? child.body.gvrsn ?? child.body.pvrsn;
  const local = envelopeFromFrame(
    parseBytes(concatBytes(
      Counter.makeGVC(genus),
      groupEndorseReply(hby, group, reply, genus),
    ))[0],
  );
  return serializeMessage(reply, {
    tsgs: [...retained.tsgs, ...local.tsgs],
    cigars: [...retained.cigars, ...local.cigars],
    gvrsn: genus,
    pipelined: true,
  });
}

/** Reuse the exact already inspected child bytes on resume, including its retained proof factors. */
export function replyContribution(proposal: ReplyProposal): Uint8Array {
  const proof = envelopeFromFrame(proposal.child);
  return serializeMessage(proof.serder, {
    tsgs: proof.tsgs,
    cigars: proof.cigars,
    gvrsn: proposal.genus,
    pipelined: true,
  });
}
