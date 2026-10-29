/**
 * Tufa presentation for completed KERI multisig command operations.
 * Library commands return snapshots after their owned resources close; these
 * adapters display them without reopening stores or driving workers. messages
 * identifies recipient-specific coordination EXNs and their shared aggregation
 * keys, while deliveries contains transport destinations. Only accepted reports
 * the command's local acceptance predicate. join --said selects the outer EXN.
 */
import { replicationRequests } from "@keri-ts/multisync/v2";
import { RegistryCustody } from "@keri-ts/wallet";
import type { Operation } from "effection";
import {
  type GroupEventResult,
  multisigInceptCommand as incept,
  multisigInteractCommand as interact,
  multisigJoinCommand as join,
  multisigRotateCommand as rotate,
  multisigRpyCommand as rpy,
  parseBooleanOption,
} from "keri-ts/cli";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { walletStoreArgs } from "../support/wallet.ts";
import { writeGroupEndpointRoleProposal } from "./endpoints.ts";
import { nativeRegistryJoinCommand } from "./native-registry-join.ts";
import { registrySaltCommand } from "./registry-salt.ts";

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
  const result = yield* rotate(args);
  printEvent(result);
  if (!result.accepted) return;
  const alias = String(args.group ?? args.alias);
  yield* provisionRotation(args, alias, result);
}

/** Compose optional application provisioning after the KEL command closes its owners. */
function* provisionRotation(
  args: Record<string, unknown>,
  alias: string,
  result: { accepted: boolean; previousSigningMembers: string[]; signingMembers: string[]; rotation: string },
): Operation<void> {
  const requests = yield* withHabAndAgentRuntime(
    walletStoreArgs(args),
    alias,
    { skipConfig: true },
    function*({ runtime, hby, hab }) {
      if (!runtime.acdc) return [];
      return replicationRequests(new RegistryCustody({ hby, registry: runtime.acdc.store }), hab, result);
    },
  );
  for (const request of requests) {
    // Each reopened command revalidates membership and obtains ordinary reply
    // approvals. Rotation acceptance itself never supplies those signatures.
    yield* registrySaltCommand({
      ...args,
      alias,
      operation: "send",
      registry: request.registry,
      party: request.recipient,
      target: request.target,
      deliver: true,
      essr: true,
      endpoint: undefined,
      output: undefined,
      evidence: [],
    });
  }
}

/** Join the selected outer EXN; sending alone does not report group acceptance. */
export function* multisigJoinCommand(args: Record<string, unknown>): Operation<void> {
  if (parseBooleanOption(args.v2, "v2")) {
    writeJsonLine(yield* nativeRegistryJoinCommand(args));
  } else {
    const result = yield* join(args);
    writeJsonLine(result);
    if (result.rotation) yield* provisionRotation(args, result.rotation.alias, result.rotation);
  }
}

/** Render the endpoint-role proposal's typed identities and delivery outcomes. */
export function* multisigRpyCommand(args: Record<string, unknown>): Operation<void> {
  writeGroupEndpointRoleProposal(yield* rpy(args));
}
