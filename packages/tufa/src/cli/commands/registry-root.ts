/** Finite encrypted registry-root files; protocol owners retain all authority and cryptography. */
import { selectNewcomerCopies } from "@keri-ts/multisync/v2";
import {
  BlindState,
  BoundState,
  bytesEqual,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  isGroupTuple,
  parseBlinder,
  parseBytes,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "effection";
import { parseStringOption } from "keri-ts/cli";
import {
  type AcdcV2Regery,
  envelopeFromFrame,
  type Hab,
  isLocalGroupHab,
  multisigRpyExn,
  type ProtocolProcessor,
  type RegistryDisclosure,
  RegistrySalt,
  ValidationError,
} from "keri-ts/runtime";
import { join, resolve } from "node:path";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { walletStoreArgs } from "../support/wallet.ts";

/** Explicit file selections; receiver approval is independent from preparation/contribution. */
export type RegistryRootFileOptions =
  & { registry: string; evidence?: readonly string[] }
  & (
    | {
      operation: "prepare";
      recipient: string;
      target: string;
      coordinator?: string;
      output: string;
      proposalOutput?: string;
    }
    | {
      operation: "contribute";
      recipient: string;
      target: string;
      coordinator: string;
      proposal: string;
      output: string;
    }
    | { operation: "receive"; sender: string; event: string; opening: string; messages: readonly string[] }
  );

/** Public completion facts; file creation or contribution never claims recipient acceptance. */
export type RegistryRootFileResult =
  & {
    registry: string;
    recipient: string;
    target: string;
    reply: string;
  }
  & (
    | { operation: "prepare"; output: string; proposalOutput?: string; prepared: true }
    | { operation: "contribute"; output: string; contributed: true }
    | { operation: "receive"; received: true }
  );

/** Decode exact files without dispatching any side effects. */
function frames(raw: Uint8Array): CesrFrame[] {
  return parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), raw));
}

/** Read exactly one counted held BSQ/BSS, preserving each primitive's qualified bytes. */
function heldOpening(raw: Uint8Array): RegistryDisclosure {
  const decoded = parseBlinder(raw, Vrsn_2_0, "txt"), tuple = decoded.items[0];
  if (decoded.consumed !== raw.length || decoded.items.length !== 1 || !isGroupTuple(tuple)) {
    throw new ValidationError("Opening file must contain exactly one counted BSQ or BSS");
  }
  const fields = tuple.map(field => {
    if (isGroupTuple(field) || !("qb64b" in field)) throw new ValidationError("Invalid opening primitive");
    return field.qb64b;
  });
  if (decoded.name.replace(/^Big/, "") === "BlindedStateQuadruples" && fields.length === 4) {
    return BlindState.fromQb64bTuple([fields[0], fields[1], fields[2], fields[3]]);
  }
  if (decoded.name.replace(/^Big/, "") === "BoundStateSextuples" && fields.length === 6) {
    return BoundState.fromQb64bTuple([fields[0], fields[1], fields[2], fields[3], fields[4], fields[5]]);
  }
  throw new ValidationError("Opening file must contain a counted BSQ or BSS");
}

/** Evidence files add public support only; opening consent is a separate explicit file. */
function publicEvidence(raw: Uint8Array): CesrFrame[] {
  const decoded = frames(raw);
  if (!decoded.length) throw new ValidationError("Evidence file is empty");
  for (const frame of decoded) {
    const body = frame.body, envelope = envelopeFromFrame(frame);
    const allowed = body instanceof SerderACDC && ["rip", "bup"].includes(body.ilk!)
      || body instanceof SerderKERI && (["icp", "rot", "ixn", "dip", "drt", "rct"].includes(body.ilk!)
          || body.ilk === "rpy" && (body.route?.startsWith("/loc/scheme") || body.route?.startsWith("/end/role")));
    if (!allowed || frame.nests?.length || envelope.bsqs.length || envelope.bsss.length || envelope.essrs?.length) {
      throw new ValidationError("Evidence files must contain only public KEL/TEL or endpoint support");
    }
  }
  return decoded;
}

/** Resolve the caller-selected accepted coordinator; no latest-event fallback changes consent. */
function coordinator(hab: Hab, said?: string) {
  if (!said) throw new ValidationError("Group root copies require an explicit coordinator event SAID");
  const event = hab.db.getEvtSerder(hab.pre!, said);
  if (!event || hab.db.kels.getLast(hab.pre!, event.sn!) !== said) {
    throw new ValidationError("Coordinator must be an exact accepted group event");
  }
  return { sn: event.sn!, said };
}

/** Fail before cryptographic work if any output already exists; createNew remains the final race guard. */
function* unusedOutputs(paths: readonly string[]): Operation<void> {
  for (const path of paths) {
    try {
      yield* call(() => Deno.lstat(path));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    throw new ValidationError(`Output already exists: ${path}`);
  }
}

/**
 * Execute one explicit file operation over borrowed concrete owners. No workers or
 * remote delivery are started. Receive temporarily owns only /registry/salt file
 * dispatch, restores earlier routes and always abandons this invocation's consent.
 */
export function* registryRootFile(
  { hab, rgy, protocol }: { hab: Hab; rgy: AcdcV2Regery; protocol: ProtocolProcessor },
  options: RegistryRootFileOptions,
): Operation<RegistryRootFileResult> {
  if (hab.db !== protocol.kvy.db || rgy.hby.db !== hab.db || protocol.registry?.store !== rgy.store) {
    throw new ValidationError("Root files require the habitat's actual registry and protocol owners");
  }
  const owner = new RegistrySalt({ hab, rgy });
  const support: CesrFrame[] = [];
  for (const path of options.evidence ?? []) support.push(...publicEvidence(yield* call(() => Deno.readFile(path))));
  for (const frame of support) yield* protocol.dispatch(frame);
  yield* protocol.processEscrowsOnce();
  if (options.operation !== "receive") {
    const group = isLocalGroupHab(rgy.hby, hab);
    const selected = group ? coordinator(hab, options.coordinator) : undefined;
    if (!group && (options.coordinator || options.operation === "contribute")) {
      throw new ValidationError("Group proposal options require a local group signer");
    }
    const proposalOutput = options.operation === "prepare" ? options.proposalOutput : undefined;
    if (group && options.operation === "prepare" && !proposalOutput) {
      throw new ValidationError("Group preparation requires a separate proposal output file");
    }
    if (!group && proposalOutput) throw new ValidationError("Proposal output requires a local group signer");
    if (proposalOutput && resolve(proposalOutput) === resolve(options.output)) {
      throw new ValidationError("Reply and proposal outputs must be distinct");
    }
    yield* unusedOutputs([options.output, ...proposalOutput ? [proposalOutput] : []]);
    const wire = options.operation === "prepare"
      ? owner.prepare(options.registry, options.recipient, options.target, { coordinator: selected })
      : owner.contribute(yield* call(() => Deno.readFile(options.proposal)), {
        registry: options.registry,
        recipient: options.recipient,
        target: options.target,
        coordinator: selected!,
      });
    if (proposalOutput) {
      const member = owner.target;
      const [wrapper, children] = yield* multisigRpyExn(hab, member, wire, { version: Vrsn_2_0 });
      const endorsed = frames(member.endorse(wrapper, { gvrsn: Vrsn_2_0 }))[0];
      endorsed.nests = frames(concatBytes(Counter.makeGVC(Vrsn_2_0), children));
      const proposal = yield* call(() => collectPayload(framePayload(endorsed)));
      yield* call(() => Deno.writeFile(proposalOutput, proposal, { createNew: true, mode: 0o600 }));
    }
    yield* call(() => Deno.writeFile(options.output, wire, { createNew: true, mode: 0o600 }));
    const facts = {
      registry: options.registry,
      recipient: options.recipient,
      target: options.target,
      reply: frames(wire)[0].body.said!,
      output: options.output,
    };
    return options.operation === "prepare"
      ? { ...facts, operation: "prepare", proposalOutput, prepared: true }
      : { ...facts, operation: "contribute", contributed: true };
  }
  if (!options.messages.length) throw new ValidationError("Receive requires at least one encrypted reply file");
  const opening = heldOpening(yield* call(() => Deno.readFile(options.opening))), messages: CesrFrame[] = [];
  for (const path of options.messages) {
    const input = frames(yield* call(() => Deno.readFile(path)));
    if (
      input.length !== 1 || input[0].body.ilk !== "rpy" || input[0].body.ked?.r !== RegistrySalt.Route
      || messages.length && !bytesEqual(messages[0].body.raw, input[0].body.raw)
    ) {
      throw new ValidationError("Message files must contribute to one exact encrypted registry reply");
    }
    messages.push(input[0]);
  }
  let received: string | null = null;
  const receipt = {
    processReply(args: Parameters<RegistrySalt["processReply"]>[0]) {
      const decision = owner.processReply(args);
      if (decision.kind === "accept") received = args.serder.said!;
      return decision;
    },
  };
  const router = protocol.rvy.rtr;
  let route: (typeof router.routes)[number] | undefined;
  try {
    owner.approve(options.registry, options.sender, { event: options.event, opening });
    router.addRoute(RegistrySalt.Route, receipt);
    route = router.routes.pop()!;
    router.routes.unshift(route);
    for (const frame of messages) yield* protocol.dispatch(frame);
    if (!received) throw new ValidationError("Selected encrypted reply was not successfully received");
    return {
      registry: options.registry,
      recipient: hab.pre!,
      target: owner.target.pre!,
      reply: received,
      received: true,
      operation: "receive",
    };
  } finally {
    const index = route ? router.routes.indexOf(route) : -1;
    if (index >= 0) router.routes.splice(index, 1);
    owner.abandon(options.registry, options.sender);
  }
}

/** Require explicit nonempty command identifiers before acquiring stores. */
function required(value: unknown, label: string): string {
  const text = parseStringOption(value, label);
  if (!text) throw new ValidationError(`--${label} is required`);
  return text;
}

/** Normalize repeated file options without inventing discovery or implicit paths. */
function paths(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) {
    throw new ValidationError(`--${label} requires file paths`);
  }
  return [...value];
}

/** Own command resource lifetimes; print public results only after all owners close. */
export function* registryRootCommand(args: Record<string, unknown>): Operation<void> {
  const operation = required(args.operation, "operation"), registry = required(args.registry, "registry");
  const alias = required(args.alias, "alias"), evidence = paths(args.evidence, "evidence");
  let options: RegistryRootFileOptions;
  if (operation === "receive") {
    options = {
      operation,
      registry,
      evidence,
      sender: required(args.sender, "sender"),
      event: required(args.event, "event"),
      opening: required(args.opening, "opening"),
      messages: paths(args.message, "message"),
    };
  } else if (operation === "prepare" || operation === "contribute") {
    const common = {
      registry,
      evidence,
      recipient: required(args.recipient, "recipient"),
      target: required(args.target, "target"),
      output: required(args.output, "output"),
    };
    options = operation === "prepare"
      ? {
        ...common,
        operation,
        coordinator: parseStringOption(args.coordinator, "coordinator"),
        proposalOutput: parseStringOption(args.proposalOutput, "proposal-output"),
      }
      : {
        ...common,
        operation,
        coordinator: required(args.coordinator, "coordinator"),
        proposal: required(args.proposal, "proposal"),
      };
  } else throw new ValidationError("Root file operation must be prepare, contribute or receive");
  const result = yield* withHabAndAgentRuntime(
    walletStoreArgs(args),
    alias,
    { skipConfig: false },
    function*({ hab, runtime }) {
      if (!runtime.acdc) throw new ValidationError("ACDC v2 registry processing is unavailable");
      return yield* registryRootFile({ hab, rgy: runtime.acdc, protocol: runtime.protocol }, options);
    },
  );
  writeJsonLine(result);
}

/** Explicit application selections for copies after one accepted current group rotation. */
export interface NewcomerRootOptions {
  rotation: string;
  previousSigningMembers: readonly string[];
  registries: readonly string[];
  outputDirectory: string;
}

/** Prepared files still require ordinary group contributions and independent recipient approval. */
export interface NewcomerRootResult {
  operation: "newcomers";
  rotation: string;
  copies: Extract<RegistryRootFileResult, { operation: "prepare" }>[];
}

/** Prepare existing-root files for selected newcomers using the ordinary finite file owner. */
export function* prepareNewcomerRoots(
  context: { hab: Hab; rgy: AcdcV2Regery; protocol: ProtocolProcessor },
  options: NewcomerRootOptions,
): Operation<NewcomerRootResult> {
  const selections = selectNewcomerCopies({
    hby: context.rgy.hby,
    group: context.hab,
    rotation: options.rotation,
    previousSigningMembers: options.previousSigningMembers,
    registries: options.registries,
  });
  const directory = resolve(options.outputDirectory);
  if (!(yield* call(() => Deno.stat(directory))).isDirectory) {
    throw new ValidationError("Output directory must already exist");
  }
  const requests = selections.map(selection => ({
    ...selection,
    operation: "prepare" as const,
    output: join(directory, `${selection.registry}.${selection.target}.reply.cesr`),
    proposalOutput: join(directory, `${selection.registry}.${selection.target}.proposal.cesr`),
  }));
  yield* unusedOutputs(requests.flatMap(request => [request.output, request.proposalOutput]));
  const copies: NewcomerRootResult["copies"] = [];
  for (const request of requests) {
    const result = yield* registryRootFile(context, request);
    if (result.operation !== "prepare") throw new Error("Expected prepared root files");
    copies.push(result);
  }
  return { operation: "newcomers", rotation: options.rotation, copies };
}

/** Own the same finite runtime as individual root-file commands; never start fresh DH. */
export function* registryRootNewcomersCommand(args: Record<string, unknown>): Operation<void> {
  const alias = required(args.alias, "alias");
  const options: NewcomerRootOptions = {
    rotation: required(args.rotation, "rotation"),
    previousSigningMembers: paths(args.previousMember, "previous-member"),
    registries: paths(args.registry, "registry"),
    outputDirectory: required(args.outputDir, "output-dir"),
  };
  const result = yield* withHabAndAgentRuntime(
    walletStoreArgs(args),
    alias,
    { skipConfig: false },
    function*({ hab, runtime }) {
      if (!runtime.acdc) throw new ValidationError("ACDC v2 registry processing is unavailable");
      return yield* prepareNewcomerRoots({ hab, rgy: runtime.acdc, protocol: runtime.protocol }, options);
    },
  );
  writeJsonLine(result);
}
