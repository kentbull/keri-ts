/** Tufa presentation for typed multisig command results; KERI owns signing and acceptance. */
import type { Operation } from "effection";
import {
  type GroupEventResult,
  multisigInceptCommand as incept,
  multisigInteractCommand as interact,
  multisigJoinCommand as join,
  multisigRotateCommand as rotate,
  multisigRpyCommand as rpy,
} from "keri-ts/cli";
import { writeGroupEndpointRoleProposal } from "./endpoints.ts";
import { writeJsonLine } from "./support/rendering.ts";

/** Display the captured key state, then the exact coordination-message send result. */
function printEvent(result: GroupEventResult): void {
  console.log(`Prefix  ${result.group}`);
  console.log(`New Sequence No.  ${result.state?.s ?? ""}`);
  for (const [index, key] of (result.state?.k ?? []).entries()) {
    console.log(`\tPublic key ${index + 1}:  ${key}`);
  }
  if (result.delegationPhase) console.log(`Delegation status  ${result.delegationPhase}`);
  writeJsonLine({
    route: result.route,
    group: result.group,
    accepted: result.accepted,
    messages: result.messages,
    deliveries: result.deliveries,
  });
}

/** Propose group inception and display results after owned resources close. */
export function* multisigInceptCommand(args: Record<string, unknown>): Operation<void> {
  printEvent(yield* incept(args));
}

/** Propose a group interaction and display its accepted state separately from sending. */
export function* multisigInteractCommand(args: Record<string, unknown>): Operation<void> {
  printEvent(yield* interact(args));
}

/** Propose group rotation and display captured key/delegation state. */
export function* multisigRotateCommand(args: Record<string, unknown>): Operation<void> {
  printEvent(yield* rotate(args));
}

/** Join the selected outer EXN; sending alone does not report group acceptance. */
export function* multisigJoinCommand(args: Record<string, unknown>): Operation<void> {
  writeJsonLine(yield* join(args));
}

/** Render the endpoint-role proposal's typed identities and delivery outcomes. */
export function* multisigRpyCommand(args: Record<string, unknown>): Operation<void> {
  writeGroupEndpointRoleProposal(yield* rpy(args));
}
