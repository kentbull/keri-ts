/**
 * Finite Tufa owner for local-profile `/registry/root` ESSR root replication,
 * the `kli vc registry root send|receive|newcomers` equivalent.
 *
 * `send` and `newcomers` prepare one signed ESSR `exn` per (recipient,
 * registry) through `RegistryRoot`, each with the verification hint
 * `RegistryRoot.prepare` derives for its own registry unless `--acdc`
 * overrides it, and deliver each to the recipient's mailbox
 * (topic `credential`) through the runtime Poster. `--out` writes the same bytes
 * to a file instead. `receive` ingests copies from the `credential` mailbox
 * (`--listen`) or `--message` files through the ordinary Reactor, KRAM and
 * Exchanger path; the handler retains each verifiable root automatically and
 * escrows the rest for retry. `receive` then adopts stored copies that never
 * reached a handler, drains that escrow once and reports what is retained or
 * still pending, as KERIpy `kli vc registry root receive`. It is an optional
 * convenience: every agent runtime registers the handler, so any command or
 * host that polls the `credential` mailbox already retains copies.
 */
import {
  BlindState,
  BoundState,
  concatBytes,
  isGroupTuple,
  parseBlinder,
  parseBytes,
  Prefixer,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, spawn } from "effection";
import { parseBooleanOption, parseNumberOption, parseStringOption } from "keri-ts/cli";
import {
  type AgentRuntime,
  deliverRegistryRoots,
  type Hab,
  type Habery,
  isLocalGroupHab,
  localGroupMember,
  Organizer,
  type RegistryDisclosure,
  type RegistryRoot,
  RootUnverified,
  runAgentRuntime,
  type RuntimeClock,
  ValidationError,
} from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { walletStoreArgs } from "../support/wallet.ts";

/** One invocation's verb and operator selections. */
export interface RegistryRootOptions {
  verb: "send" | "newcomers" | "receive";
  /** Single selection for send and receive. */
  registry?: string;
  registries: readonly string[];
  recipients: readonly string[];
  holder?: string;
  rotation?: string;
  event?: string;
  acdc?: string;
  out?: string;
  said?: string;
  opening?: string;
  listen: boolean;
  messages: readonly string[];
  timeoutMs: number;
}

/** Wait using the runtime's timer owner; cancellation releases the timer. */
function* wait(clock: RuntimeClock, milliseconds: number): Operation<void> {
  yield* action<void>(resolve => {
    const timer = clock.setTimeout(resolve, milliseconds);
    return () => clock.clearTimeout(timer);
  });
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

/** Resolve a local/contact alias or require one complete canonical AID. */
function recipient(hby: Habery, value: string): string {
  try {
    const literal = new Prefixer({ qb64: value });
    if (literal.qb64 !== value) throw new ValidationError("recipient must be one complete canonical AID");
    return value;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
  }
  return hby.habByName(value)?.pre ?? new Organizer(hby.db, hby.signator).resolveRecipient(value);
}

/** Root replication context: the alias, its signing member and the route owner. */
interface Replication {
  runtime: AgentRuntime;
  hab: Hab;
  member: Hab;
  group: boolean;
  root: RegistryRoot;
  deadline: number;
}

/** Fail the whole operation once its elapsed deadline passes. */
function check(context: Replication): void {
  if (context.runtime.clock.now() >= context.deadline) {
    throw new ValidationError("registry root replication did not complete before --timeout");
  }
}

/** Return [recipient, gid, registry] selections, plus newcomer facts for `newcomers`. */
function copies(context: Replication, options: RegistryRootOptions) {
  const { hab, member, group, root, runtime } = context;
  if (options.verb === "newcomers") {
    if (!group) throw new ValidationError("newcomers requires a local group alias");
    const recipients = root.newcomers(hab, options.rotation!);
    const registries = options.registries.length ? options.registries : root.held(hab.pre!);
    return {
      elected: root.witnesser(hab, options.rotation!),
      selected: recipients.flatMap(aid => registries.map(registry => [aid, hab.pre!, registry] as const)),
    };
  }
  const gid = options.holder ? recipient(runtime.hby, options.holder) : group ? hab.pre! : null;
  let recipients: string[];
  if (options.recipients.length) recipients = options.recipients.map(value => recipient(runtime.hby, value));
  else if (group && gid === hab.pre) recipients = root.members(gid!).filter(aid => aid !== member.pre);
  else throw new ValidationError("send requires --recipient unless a group alias sends to its members");
  return {
    elected: null,
    selected: recipients.flatMap(aid => options.registries.map(registry => [aid, gid ?? aid, registry] as const)),
  };
}

/** Prepare, then deliver by mailbox or write the exclusive output file. */
function* send(context: Replication, options: RegistryRootOptions): Operation<void> {
  const { runtime, member, root } = context;
  const { elected, selected } = copies(context, options);
  const prepared = selected.map(([aid, gid, registry]) => {
    check(context);
    const wire = root.prepare(member, aid, gid, registry, { event: options.event, td: options.acdc });
    const exchange = parseBytes(wire)[0].body.said!;
    return { result: { registry, sender: member.pre!, recipient: aid, gid, exchange }, recipient: aid, wire };
  });
  if (options.verb === "newcomers") {
    writeJsonLine({
      rotation: options.rotation,
      gid: context.hab.pre,
      elected,
      newcomers: [...new Set(selected.map(([aid]) => aid))].sort(),
    });
  }
  if (options.out) {
    const output = options.out, bytes = concatBytes(...prepared.map(({ wire }) => wire));
    yield* call(() => Deno.writeFile(output, bytes, { createNew: true, mode: 0o600 }));
  } else if (prepared.length) {
    const delivering = yield* spawn(() => runtime.postman.deliverDo());
    try {
      // One copy per call keeps the per-copy deadline and stops at the first failure, before any output.
      for (const copy of prepared) {
        check(context);
        const [outcome] = yield* deliverRegistryRoots(runtime.postman, member.pre!, [copy]);
        if (outcome.kin === "failed") throw outcome.error;
      }
    } finally {
      yield* delivering.halt();
    }
  }
  for (const { result } of prepared) {
    writeJsonLine({ ...result, transmitted: !options.out, output: options.out ?? null });
  }
}

/** True when a root is retained for this alias's holder AID and `registry`. */
function retained(context: Replication, registry: string): boolean {
  return context.runtime.hby.mgr.getRegistryRoot(context.hab.pre!, registry) !== null;
}

/** Ingest copies and let the handler retain them; drain the escrow once and report what remains. */
function* receive(context: Replication, options: RegistryRootOptions): Operation<void> {
  const { runtime, root, member, hab } = context;
  if (options.listen && !options.registry) throw new ValidationError("receive --listen requires --registry");
  if ((options.event || options.opening) && !options.said) {
    throw new ValidationError("--event and --opening retry one stored copy; add --said");
  }
  const proof = options.opening ? heldOpening(yield* call(() => Deno.readFile(options.opening!))) : undefined;
  if (options.messages.length) {
    for (const path of options.messages) yield* runtime.reactor.processBytes(yield* call(() => Deno.readFile(path)));
  } else if (options.listen) {
    const host = yield* spawn(() => runAgentRuntime(runtime, { hab: member, pollMailbox: true }));
    try {
      writeJsonLine({ registry: options.registry, phase: "listening" });
      while (!retained(context, options.registry!)) {
        check(context);
        yield* wait(runtime.clock, 50);
      }
    } finally {
      yield* host.halt();
    }
  }
  // Drain: adopt stored copies no handler escrowed, then retry every escrowed copy.
  root.reconcile();
  root.processEscrows();
  if (options.said) {
    try {
      root.receive(options.said, { event: options.event, opening: proof });
    } catch (error) {
      if (error instanceof RootUnverified) throw new ValidationError(`${error.message}; the copy stays pending`);
      throw error;
    }
  }
  for (const item of root.pending()) {
    if (item.recipient === member.pre && item.gid === hab.pre) writeJsonLine({ ...item, retained: false });
  }
  if (options.registry) {
    if (!retained(context, options.registry)) {
      throw new ValidationError("no registry root is retained for this registry");
    }
    writeJsonLine({ gid: hab.pre, registry: options.registry, retained: true });
  }
}

/** Run one verb over the alias's actual runtime and registry owners. */
export function* registryRoot(
  runtime: AgentRuntime,
  hab: Hab,
  options: RegistryRootOptions,
): Operation<void> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new ValidationError("--timeout must be finite and positive");
  }
  if (options.out) {
    try {
      yield* call(() => Deno.lstat(options.out!));
      throw new ValidationError("output already exists");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  const root = runtime.registryRoot;
  if (!root) throw new ValidationError("ACDC v2 registry processing is unavailable");
  const group = isLocalGroupHab(runtime.hby, hab);
  const member = group ? localGroupMember(runtime.hby, hab.pre!) : hab;
  if (!hab.kever || !member.kever) {
    throw new ValidationError("registry root replication requires an accepted local signer");
  }
  member.mgr.requireRegistryRootAccess();
  const context: Replication = {
    runtime,
    hab,
    member,
    group,
    root,
    deadline: runtime.clock.now() + options.timeoutMs,
  };
  if (options.verb === "receive") yield* receive(context, options);
  else yield* send(context, options);
}

/** Normalize repeated options without inventing discovery or implicit paths. */
function list(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) {
    throw new ValidationError(`--${label} requires values`);
  }
  return [...value];
}

/** Parse one command's flags before acquiring stores. */
function commandOptions(args: Record<string, unknown>, verb: RegistryRootOptions["verb"]) {
  const timeout = parseNumberOption(args.timeout, "timeout") ?? 60;
  const registry = args.registry;
  return {
    verb,
    registry: typeof registry === "string" ? registry : undefined,
    registries: typeof registry === "string" ? [registry] : list(registry, "registry"),
    recipients: list(args.recipient, "recipient"),
    holder: parseStringOption(args.holder, "holder"),
    rotation: parseStringOption(args.rotation, "rotation"),
    event: parseStringOption(args.event, "event"),
    acdc: parseStringOption(args.acdc, "acdc"),
    out: parseStringOption(args.out, "out"),
    said: parseStringOption(args.said, "said"),
    opening: parseStringOption(args.opening, "opening"),
    listen: parseBooleanOption(args.listen, "listen") ?? false,
    messages: list(args.message, "message"),
    timeoutMs: timeout * 1000,
  };
}

/** Own command resource lifetimes for one verb. */
function* command(args: Record<string, unknown>, verb: RegistryRootOptions["verb"]): Operation<void> {
  const options = commandOptions(args, verb);
  if (options.listen && options.messages.length) throw new ValidationError("--listen and --message are exclusive");
  yield* withHabAndAgentRuntime(
    walletStoreArgs(args),
    parseStringOption(args.alias, "alias"),
    { skipConfig: false },
    function*({ hab, runtime }) {
      yield* registryRoot(runtime, hab, options);
    },
  );
}

/** `tufa vc registry root send`. */
export function* registryRootSendCommand(args: Record<string, unknown>): Operation<void> {
  yield* command(args, "send");
}

/** `tufa vc registry root newcomers`. */
export function* registryRootNewcomersCommand(args: Record<string, unknown>): Operation<void> {
  yield* command(args, "newcomers");
}

/** `tufa vc registry root receive`. */
export function* registryRootReceiveCommand(args: Record<string, unknown>): Operation<void> {
  yield* command(args, "receive");
}
