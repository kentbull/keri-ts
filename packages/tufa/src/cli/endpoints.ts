/**
 * Tufa presentation for endpoint authorization commands, shared with group adapters.
 * KERI returns the accepted-state predicate and coordination send facts after
 * owned resources close. Project those into JSON without serializing signed rpy
 * bytes, inferring approval from delivery, or adding presentation callbacks to
 * the library's workflow dependencies.
 */
import type { Operation } from "effection";
import { endsAddCommand as addEndpointRole } from "keri-ts/cli";
import type { GroupRoleResult } from "keri-ts/runtime";
import { writeJsonLine } from "./support/rendering.ts";

/** Project protocol/transport facts without serializing the internal signed reply bytes. */
export function writeGroupEndpointRoleProposal(result: GroupRoleResult): void {
  writeJsonLine({
    route: result.route,
    messages: result.messages,
    group: result.group,
    accepted: result.accepted,
    deliveries: result.deliveries,
  });
}

/** Report successful completion only after the endpoint operation finishes closing its resources. */
export function* endsAddCommand(args: Record<string, unknown>): Operation<void> {
  const result = yield* addEndpointRole(args);
  if ("messages" in result) writeGroupEndpointRoleProposal(result);
  else console.log(`${result.role} ${result.eid}`);
}
