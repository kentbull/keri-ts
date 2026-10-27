/**
 * Tufa projection of KERI's typed registry and credential operation results.
 * Await the library command's owned-resource closure before writing final JSON.
 * Group coordination adds message identities and completed transport destinations;
 * accepted/saved/TEL/verifier fields remain separate protocol facts. Formatting
 * here never turns a successful proposal send into credential lifecycle success.
 */
import { call, type Operation, scoped } from "effection";
import { vcCreateCommand as create, vcRegistryInceptCommand as incept, vcRevokeCommand as revoke } from "keri-ts/cli";
import { parseBooleanOption, parseStringOption } from "keri-ts/cli";
import { ValidationError } from "keri-ts/runtime";
import { withAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";
import { acdcV2AuthorCommand } from "./acdc-v2-authoring.ts";

/** List explicit ACDC v2 inventory references, separately from legacy verifier-saved credentials. */
export function* walletListCommand(args: Record<string, unknown>): Operation<void> {
  const inventory = yield* withAgentRuntime(walletStoreArgs(args), { skipConfig: true }, function*({ hby, runtime }) {
    return yield* scoped(function*() {
      if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
      const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
      return wallet.inventory();
    });
  });
  writeJsonLine(inventory);
}

/** Read one admitted Grant's exact disclosed credential without merging fuller local material. */
export function* walletReadCommand(args: Record<string, unknown>): Operation<void> {
  const grant = parseStringOption(args.grant, "grant");
  if (!grant) throw new ValidationError("Admitted Grant --grant is required.");
  const held = yield* withAgentRuntime(walletStoreArgs(args), { skipConfig: true }, function*({ hby, runtime }) {
    return yield* scoped(function*() {
      if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
      const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
      const record = yield* call(() => wallet.heldCredential(grant));
      return { grant: record.grant.said, admit: record.admit, credential: record.credential.sad };
    });
  });
  writeJsonLine(held);
}

/** Display the created registry or group proposal, after its owned resources close. */
export function* vcRegistryInceptCommand(args: Record<string, unknown>): Operation<void> {
  if (parseBooleanOption(args.acdcV2, "acdc-v2")) {
    yield* acdcV2AuthorCommand(args, "incept");
    return;
  }
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
  if (parseBooleanOption(args.acdcV2, "acdc-v2")) {
    yield* acdcV2AuthorCommand(args, "issue");
    return;
  }
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
  if (parseBooleanOption(args.acdcV2, "acdc-v2")) {
    yield* acdcV2AuthorCommand(args, "revoke");
    return;
  }
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
