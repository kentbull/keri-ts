/**
 * Tufa projection of KERI's typed registry and credential operation results.
 * Await the library command's owned-resource closure before writing final JSON.
 * Group coordination adds message identities and completed transport destinations;
 * accepted/saved/TEL/verifier fields remain separate protocol facts. Formatting
 * here never turns a successful proposal send into credential lifecycle success.
 */
import type { Operation } from "effection";
import { vcCreateCommand as create, vcRegistryInceptCommand as incept, vcRevokeCommand as revoke } from "keri-ts/cli";
import { writeJsonLine } from "./support/rendering.ts";

/** Display the created registry or group proposal, after its owned resources close. */
export function* vcRegistryInceptCommand(args: Record<string, unknown>): Operation<void> {
  const { name, registry, issuer, group, publicationComplete } = yield* incept(args);
  const identity = { name, registry, issuer, publicationComplete };
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
  const { creder, tel, status, group, publicationComplete } = yield* create(args);
  const issued = {
    said: creder.said,
    registry: creder.regid,
    issuer: creder.issuer,
    issuee: creder.issuee,
    schema: creder.schema,
    tel,
    status,
    publicationComplete,
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

/** Render revocation after its host and database owners close; keep proposal sends distinct from delivery. */
export function* vcRevokeCommand(args: Record<string, unknown>): Operation<void> {
  const { said, tel, status, accepted, publicationComplete, deliveries, group } = yield* revoke(args);
  writeJsonLine({
    said,
    tel,
    status,
    accepted,
    publicationComplete,
    deliveries,
    ...(group ? { route: group.route, messages: group.messages, memberDeliveries: group.deliveries } : {}),
  });
}
