/** IPEX presentation after the KERI command has joined workers and closed owned stores. */
import type { Operation } from "effection";
import {
  ipexAdmitCommand as admit,
  ipexAgreeCommand as agree,
  ipexApplyCommand as apply,
  ipexGrantCommand as grant,
  ipexJoinCommand as join,
  ipexOfferCommand as offer,
  ipexPollCommand as poll,
  type IpexSendResult,
  ipexSpurnCommand as spurn,
} from "keri-ts/cli";
import { writeJsonLine } from "./support/rendering.ts";

/** Completed transport destinations do not establish peer protocol acceptance. */
function printSend({ exn, deliveries, group }: IpexSendResult): void {
  if (!group) writeJsonLine({ said: exn.said, deliveries });
  else {writeJsonLine({
      said: exn.said,
      status: group.complete ? "multisig-complete" : "multisig-pending",
      lead: group.lead,
      messages: group.messages,
      deliveries,
    });}
}

/** Display a completed apply attempt after resource cleanup. */
export function* ipexApplyCommand(args: Record<string, unknown>): Operation<void> {
  printSend(yield* apply(args));
}

/** Display a completed offer attempt after resource cleanup. */
export function* ipexOfferCommand(args: Record<string, unknown>): Operation<void> {
  printSend(yield* offer(args));
}

/** Display a completed agree attempt after resource cleanup. */
export function* ipexAgreeCommand(args: Record<string, unknown>): Operation<void> {
  printSend(yield* agree(args));
}

/** Display a completed spurn attempt after resource cleanup. */
export function* ipexSpurnCommand(args: Record<string, unknown>): Operation<void> {
  printSend(yield* spurn(args));
}

/** Project grant facts, retaining the distinction between pending group evidence and completed business EXNs. */
export function* ipexGrantCommand(args: Record<string, unknown>): Operation<void> {
  const { grant: exn, credential, support, deliveries, group } = yield* grant(args);
  const identity = { said: exn.said, credential, support, deliveries };
  if (!group) {
    writeJsonLine(identity);
  } else if (!group.complete) {
    writeJsonLine({ ...identity, status: "multisig-pending", messages: group.messages });
  } else {
    writeJsonLine({
      ...identity,
      status: "multisig-complete",
      lead: group.lead,
      messages: group.messages,
    });
  }
}

/** Display the admit/grant relationship after cleanup; wallet acceptance remains a protocol fact. */
export function* ipexAdmitCommand(args: Record<string, unknown>): Operation<void> {
  const { admit: exn, grant } = yield* admit(args);
  writeJsonLine({ said: exn.said, grant: grant.said });
}

/** Project settled mailbox records without exposing Serder internals in CLI JSON. */
export function* ipexPollCommand(args: Record<string, unknown>): Operation<void> {
  const { batches, messages, ipex, saved } = yield* poll(args);
  writeJsonLine({
    batches,
    messages,
    ipex: ipex.map(exn => ({ said: exn.said, route: exn.route, sender: exn.ked?.i, prior: exn.ked?.p })),
    saved,
  });
}

/** Display selected coordination identity and approval facts, including poll-discovered outer SAIDs. */
export function* ipexJoinCommand(args: Record<string, unknown>): Operation<void> {
  const { exn, group } = yield* join(args);
  if (!group) {
    writeJsonLine({ said: exn.said, route: exn.route, status: "single-sig" });
    return;
  }
  const identity = {
    said: exn.said,
    route: exn.route,
    embedded: group.embedded.said,
    embeddedRoute: group.embedded.route,
    group: group.embedded.pre,
  };
  if (group.accepted === null) {
    writeJsonLine({ ...identity, status: "multisig-pending" });
  } else {
    writeJsonLine({
      ...identity,
      status: group.accepted ? "multisig-approved" : "multisig-escrowed",
      lead: group.lead,
      messages: group.messages,
      deliveries: group.deliveries,
    });
  }
}
