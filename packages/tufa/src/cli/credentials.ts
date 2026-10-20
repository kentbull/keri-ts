/** Credential authoring presentation; KERI workflows return typed issuance and registry facts. */
import type { Operation } from "effection";
import { vcCreateCommand as create, vcRegistryInceptCommand as incept } from "keri-ts/cli";
import { writeJsonLine } from "./support/rendering.ts";

/** Display the created registry or group proposal, after its owned resources close. */
export function* vcRegistryInceptCommand(args: Record<string, unknown>): Operation<void> {
  writeJsonLine(yield* incept(args));
}

/** Project credential identity and typed issuance outcomes into the CLI JSON record. */
export function* vcCreateCommand(args: Record<string, unknown>): Operation<void> {
  const { creder, issuance } = yield* create(args);
  writeJsonLine({
    said: creder.said,
    registry: creder.regid,
    issuer: creder.issuer,
    issuee: creder.issuee,
    schema: creder.schema,
    ...issuance,
  });
}
