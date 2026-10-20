/** Credential authoring presentation; KERI workflows return typed issuance and registry facts. */
import type { Operation } from "effection";
import { vcCreateCommand as create, vcRegistryInceptCommand as incept } from "keri-ts/cli";
import { writeJsonLine } from "./support/rendering.ts";

/** Display the created registry or group proposal, after its owned resources close. */
export function* vcRegistryInceptCommand(args: Record<string, unknown>): Operation<void> {
  const { name, registry, issuer, group } = yield* incept(args);
  const identity = { name, registry, issuer };
  if (group) {
    writeJsonLine({
      ...identity,
      route: group.route,
      status: group.status,
      accepted: group.accepted,
      messages: group.messages,
      deliveries: group.deliveries,
    });
  } else {
    writeJsonLine(identity);
  }
}

/** Project credential identity and typed issuance outcomes into the CLI JSON record. */
export function* vcCreateCommand(args: Record<string, unknown>): Operation<void> {
  const { creder, tel, status, group } = yield* create(args);
  const issued = {
    said: creder.said,
    registry: creder.regid,
    issuer: creder.issuer,
    issuee: creder.issuee,
    schema: creder.schema,
    tel,
    status,
  };
  if (group) {
    writeJsonLine({
      ...issued,
      route: group.route,
      telStatus: group.telStatus,
      saved: group.saved,
      messages: group.messages,
      deliveries: group.deliveries,
    });
  } else {
    writeJsonLine(issued);
  }
}
