/** Finite live presentation proof acquisition/release; original Grant authority and Admit remain separate. */
import { startServer } from "@keri-ts/hosting";
import { bytesEqual, type CesrFrame, collectPayload, framePayload, parseBytes, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { action, call, type Operation, race, scoped, spawn } from "effection";
import { parseIntegerOption, parseNumberOption, parseStringOption, withRuntimeWorkers } from "keri-ts/cli";
import {
  abandonUnblinding,
  type AgentRuntime,
  consoleLogger,
  createAgentRuntime,
  envelopeFromFrame,
  type ExchangeRouteHandler,
  groupSigningMembers,
  type Hab,
  isLocalGroupHab,
  type KramConfig,
  localGroupMember,
  MemoryUnblindingOperationStore,
  multisigExnBody,
  posterDelivery,
  requestUnblind,
  runAgentRuntime,
  systemClock,
  timestampMicros,
  Unblind,
  UnblindingOperations,
  ValidationError,
  waitForUnblinding,
} from "keri-ts/runtime";
import { NodeHttpClient } from "keri-ts/runtime/node";
import { withExistingHab } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { walletStoreArgs } from "../support/wallet.ts";

const QueryRoute = "/multisig/qry" as const, ReplyRoute = "/multisig/rpy" as const;
/** One explicit invocation; the proposer authors bytes and ordinary verified indices elect delivery. */
export interface PresentationUnblindOptions {
  timeoutMs: number;
  proposer?: string;
  listen?: number;
  /** Ordinary-state vocabulary frozen on the approved operation; omitted uses the library default. */
  states?: readonly string[];
}
/** Proof exchange completion does not authorize or create a wallet Admit. */
export interface PresentationUnblindResult {
  grant: string;
  xid: string;
  role: "requester" | "responder";
  completed: true;
  admitted: false;
}
/** Wait on the selected runtime's clock, releasing the timer on cancellation. */
function* wait(runtime: AgentRuntime, milliseconds: number): Operation<void> {
  yield* action<void>(resolve => {
    const timer = runtime.clock.setTimeout(resolve, milliseconds);
    return () => runtime.clock.clearTimeout(timer);
  });
}
/** Preserve public child evidence and opening attachments through normal CESR serialization. */
function* wire(frame: CesrFrame): Operation<Uint8Array> {
  return yield* call(() => collectPayload(framePayload(frame)));
}
/** Acquire optional direct intake before approving the exact live presentation. */
export function* runPresentationUnblind(
  runtime: AgentRuntime,
  grant: string,
  options: PresentationUnblindOptions,
): Operation<PresentationUnblindResult> {
  if (options.listen === undefined) return yield* runUnblind(runtime, grant, options);
  if (!Number.isInteger(options.listen) || options.listen < 1 || options.listen > 65535) {
    throw new ValidationError("--listen must be a port between 1 and 65535");
  }
  const selected = runtime.ipexAuxiliary;
  if (selected?.kind !== "unblind") throw new ValidationError("Live Unblind requires its selected runtime");
  const hab = selected.owner.hab, member = selected.owner.group ? localGroupMember(runtime.hby, hab.pre) : hab;
  return yield* scoped(function*() {
    let ready!: () => void;
    const bound = new Promise<void>(resolve => ready = resolve);
    const listener = yield* spawn(() =>
      startServer(options.listen!, consoleLogger, runtime, {
        hostname: "127.0.0.1",
        serviceHab: member,
        hostedPrefixes: [...new Set([member.pre, hab.pre])],
        onListen: () => ready(),
      })
    );
    try {
      yield* call(() => bound);
      return yield* runUnblind(runtime, grant, options);
    } finally {
      yield* listener.halt();
    }
  });
}

/** Run one exact retained presentation through its selected Unblind owner, without creating an Admit. */
function* runUnblind(
  runtime: AgentRuntime,
  grant: string,
  { timeoutMs, proposer, states }: PresentationUnblindOptions,
): Operation<PresentationUnblindResult> {
  const selected = runtime.ipexAuxiliary;
  if (selected?.kind !== "unblind" || !runtime.acdc || selected.owner.exc !== runtime.exc) {
    throw new ValidationError("Live Unblind requires its selected runtime and registry");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ValidationError("Unblind timeout must be positive");
  const protocol = selected.owner, hab = protocol.hab;
  const member = protocol.group ? localGroupMember(runtime.hby, hab.pre) : hab;
  if (
    protocol.group
      ? !proposer || !groupSigningMembers(runtime.hby, hab.pre).includes(proposer)
      : proposer !== undefined
  ) {
    throw new ValidationError("Group Unblind requires a current signing member proposer; individual Unblind has none");
  }
  const xid = protocol.approve(grant, { states });
  const input = runtime.exc.retainedInput(grant)!;
  const requester = input.serder.sad!.ri === hab.pre;
  const role = requester ? "requester" : "responder";
  const result: PresentationUnblindResult = { grant, xid, role, completed: true, admitted: false };
  const deadline = runtime.exc.exchangeDeadline(input.serder), expiry = deadline ? timestampMicros(deadline) : null;
  const route = requester ? QueryRoute : ReplyRoute, field = requester ? "qry" : "rpy";
  let delegate: ExchangeRouteHandler | undefined;
  let installed = false, frozen: Uint8Array | undefined, contributed = false, finished = false;
  let query: Uint8Array | undefined, nextQuery = 0;
  const pending = new Map<string, { parent: SerderKERI; child: CesrFrame }>(), seen = new Set<string>();
  function check() {
    if (!deadline || expiry === null || expiry === undefined) {
      throw new Error("Missing or corrupt presentation deadline");
    }
    if (runtime.exc.exchangeDeadline(input.serder) !== deadline) {
      throw new ValidationError("Original presentation deadline changed");
    }
    if (BigInt(runtime.clock.now()) * 1000n >= expiry) {
      throw new ValidationError("Original presentation deadline expired");
    }
    if (!finished) protocol.complete(xid); // Rechecks exact live scope and accepted current state; readiness is separate.
  }
  function matches(parent: SerderKERI, children: readonly CesrFrame[] = []): boolean {
    const child = children[0], attrs = parent.sad!.a as Record<string, unknown>;
    if (
      parent.route !== route || parent.pvrsn.major !== 2 || parent.pvrsn.minor !== 0
      || !groupSigningMembers(runtime.hby, hab.pre).includes(parent.pre!)
      || children.length !== 1 || !(child?.body instanceof SerderKERI)
      || !attrs || Object.keys(attrs).length !== 2 || attrs.gid !== hab.pre || attrs[field] !== child.body.said
    ) return false;
    const body = child.body, data = body.sad![requester ? "q" : "a"] as { x?: string };
    if (
      body.pre !== hab.pre || body.ilk !== field || body.route !== Unblind.Route
      || body.pvrsn.major !== 2 || body.pvrsn.minor !== 0 || data?.x !== xid
      || requester && body.sad!.rr !== Unblind.Route || frozen && !bytesEqual(frozen, body.raw)
    ) return false;
    const evidence = envelopeFromFrame(child);
    const allowed = requester
      ? ["TransIdxSigGroups", "TransLastIdxSigGroups"]
      : ["TransIdxSigGroups", "BlindedStateQuadruples", "BoundStateSextuples"];
    return (requester || !child.nests?.length)
      && evidence.attachmentGroups.every(group => allowed.includes(group.name.replace(/^Big/, "")));
  }
  try {
    check();
    // A current authenticated view needs no empty auxiliary query or new proof writes.
    if (requester && runtime.exc.complete(grant)) {
      const current = runtime.exc.verifyGrantProofs(grant, input.nests ?? []);
      if (current === true || typeof current === "object" && current.kind === "accept") return result;
    }
    if (protocol.group) {
      // Unblind children share the core /multisig/qry or /multisig/rpy route (KERIpy Multiplexor.addChildHandler).
      delegate = {
        resource: route,
        acceptsNests: true,
        verify: args => matches(args.serder, args.nests) && !args.attachments.length && !args.essrs?.length,
        handle(args) {
          pending.set(args.serder.said!, { parent: args.serder, child: args.nests![0] });
        },
      };
      runtime.mux.addChildHandler(route, Unblind.Route, delegate);
      installed = true;
    }
    return yield* race([
      call(function*() {
        return yield* scoped(function*() {
          const host = yield* spawn(() => runAgentRuntime(runtime, { hab: member, pollMailbox: true }));
          function* send(msg: Uint8Array, dest: string, topic = "credential"): Operation<void> {
            check();
            const event = runtime.postman.send({ src: member.pre, dest, topic, msg }, { notify: true });
            const outcome = yield* runtime.postman.wait(event);
            if (outcome.kin === "failed") throw outcome.error;
          }
          function* broadcast(raw: Uint8Array): Operation<void> {
            const child = parseBytes(raw)[0];
            if (!(child?.body instanceof SerderKERI) || child.body.ilk !== field) {
              throw new ValidationError("Unexpected local Unblind proposal");
            }
            frozen = child.body.raw;
            contributed = true;
            yield* runtime.protocol.dispatch(child, { local: true });
            const body = multisigExnBody(member.pre, { route, attrs: { gid: hab.pre } }, child.body, {
              version: Vrsn_2_0,
            });
            const parent = parseBytes(member.endorse(body, { gvrsn: Vrsn_2_0 }))[0];
            parent.nests = [child];
            const proposal = yield* wire(parent);
            for (const peer of groupSigningMembers(runtime.hby, hab.pre)) {
              if (peer !== member.pre) yield* send(proposal, peer, "multisig");
            }
          }
          try {
            if (requester && (!protocol.group || member.pre === proposer)) {
              const started = protocol.start(grant);
              if (!protocol.group) query = started;
            }
            while (true) {
              check();
              if (protocol.group) {
                // Accepted wrappers can precede this explicit invocation; intake alone never contributed.
                for (const [, parent] of runtime.hby.db.exns.getTopItemIter()) {
                  if (parent.route !== route || seen.has(parent.said!)) continue;
                  const retained = runtime.exc.retainedInput(parent.said!);
                  if (retained && matches(parent, retained.nests)) {
                    pending.set(parent.said!, { parent, child: retained.nests![0] });
                  }
                }
                if (!requester && member.pre === proposer && !contributed && protocol.hasPeerQuery(xid)) {
                  protocol.respond(xid);
                }
                for (const [said, item] of pending) {
                  if (seen.has(said) || item.parent.pre === member.pre) {
                    pending.delete(said);
                    continue;
                  }
                  if (!frozen && item.parent.pre !== proposer || !requester && !protocol.hasPeerQuery(xid)) continue;
                  if (!matches(item.parent, [item.child])) {
                    pending.delete(said);
                    seen.add(said);
                    continue;
                  }
                  const contribution = protocol.contribute(xid, yield* wire(item.child));
                  yield* runtime.protocol.dispatch(item.child, { local: true });
                  if (!contributed) yield* broadcast(contribution);
                  seen.add(said);
                  pending.delete(said);
                }
              }
              while (protocol.outgoing.length) {
                const message = protocol.outgoing.pull()!;
                if (message.kin === "sign") {
                  if (!contributed) yield* broadcast(message.msg);
                } else if (message.kin === "query") query = message.msg;
                else if (!finished) {
                  yield* protocol.finish(xid); // Validate exact evidence; no issuer-state admission policy here.
                  finished = true;
                  yield* send(message.msg, message.dest);
                }
              }
              if (requester && protocol.complete(xid)) {
                const decision = yield* protocol.finish(xid);
                if (decision.kind !== "accept") throw new ValidationError("Updated presentation proofs did not verify");
                return result;
              }
              if (!requester && (finished || protocol.group && protocol.complete(xid))) {
                if (!finished) yield* protocol.finish(xid);
                return result;
              }
              if (query && runtime.clock.now() >= nextQuery) {
                yield* send(query, input.serder.pre!);
                nextQuery = runtime.clock.now() + 1000;
              }
              yield* wait(runtime, 50);
            }
          } finally {
            yield* host.halt();
          }
        });
      }),
      call(function*(): Operation<never> {
        yield* wait(
          runtime,
          Math.min(timeoutMs, Math.max(0, Number(expiry! - BigInt(runtime.clock.now()) * 1000n) / 1000)),
        );
        throw new ValidationError("Unblind reached its elapsed limit or original Grant deadline without Admit");
      }),
    ]);
  } finally {
    protocol.abandon(xid);
    if (installed) runtime.mux.removeChildHandler(route, Unblind.Route, delegate!);
  }
}

/**
 * One individual Unblind through the library owner: consent, then `processOnce` under the host workers while
 * the wait observes. Only the optional direct listener (`--listen`) is the CLI's own.
 */
function* runIndividualUnblind(
  runtime: AgentRuntime,
  hab: Hab,
  grant: string,
  { timeoutMs, proposer, listen, states }: PresentationUnblindOptions & { states: readonly string[] },
): Operation<PresentationUnblindResult> {
  if (listen !== undefined && (!Number.isInteger(listen) || listen < 1 || listen > 65535)) {
    throw new ValidationError("--listen must be a port between 1 and 65535");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ValidationError("Unblind timeout must be positive");
  if (proposer !== undefined) {
    throw new ValidationError("Group Unblind requires a current signing member proposer; individual Unblind has none");
  }
  const ops = new UnblindingOperations({
    hby: runtime.hby,
    exc: runtime.exc,
    unblinds: runtime.ipex!,
    delivery: posterDelivery(runtime.postman),
    store: new MemoryUnblindingOperationStore(),
    clock: runtime.clock,
  });
  const requester = runtime.exc.retainedInput(grant)?.serder.sad?.ri === hab.pre;
  const run = function*() {
    // The disclosee consents explicitly; the discloser only listens, and the owner answers an authenticated query.
    const begun = requester ? requestUnblind(ops, { hab, grant, states }) : null;
    const outcome = yield* withRuntimeWorkers(runtime, { hab, pollMailbox: true }, function*() {
      const driver = yield* spawn(function*() {
        while (true) {
          yield* ops.processOnce();
          yield* wait(runtime, 50);
        }
      });
      try {
        const stop = runtime.clock.now() + timeoutMs;
        while (!begun && !ops.deps.store.get(grant)) {
          if (runtime.clock.now() >= stop) {
            throw new ValidationError("Unblind reached its elapsed limit or original Grant deadline without Admit");
          }
          yield* wait(runtime, 50);
        }
        return yield* waitForUnblinding(ops, grant, { timeoutMs: Math.max(1, stop - runtime.clock.now()) });
      } finally {
        yield* driver.halt();
      }
    });
    const xid = begun?.xid ?? ops.deps.store.get(grant)!.xid, role = requester ? "requester" : "responder";
    const { status } = outcome;
    if (status.state === "done") return { grant, xid, role, completed: true, admitted: false } as const;
    if (status.state === "active") abandonUnblinding(ops, grant, "Elapsed limit");
    const elapsed = status.state === "active" || status.state === "expired";
    throw new ValidationError(
      elapsed ? "Unblind reached its elapsed limit or original Grant deadline without Admit" : status.reason,
    );
  };
  if (listen === undefined) return yield* run();
  return yield* scoped(function*() {
    let ready!: () => void;
    const bound = new Promise<void>((resolve) => ready = resolve);
    const listener = yield* spawn(() =>
      startServer(listen, consoleLogger, runtime, {
        hostname: "127.0.0.1",
        serviceHab: hab,
        hostedPrefixes: [hab.pre!],
        onListen: () => ready(),
      })
    );
    try {
      yield* call(() => bound);
      return yield* run();
    } finally {
      yield* listener.halt();
    }
  });
}

/** Compose the selected concrete owner and explicit KRAM policy for one live CLI action. */
export function* ipexLiveUnblindCommand(args: Record<string, unknown>): Operation<void> {
  const listen = parseIntegerOption(args.listen, "listen");
  if (listen !== undefined && (listen < 1 || listen > 65535)) {
    throw new ValidationError("--listen must be a port between 1 and 65535");
  }
  if (args.opening || args.said || args.out) {
    throw new ValidationError("--said and --out belong to offline --opening recovery");
  }
  const grant = parseStringOption(args.grant, "grant"), timeout = parseNumberOption(args.timeout, "timeout") ?? 60;
  if (!grant || !Number.isFinite(timeout) || timeout <= 0) {
    throw new ValidationError(
      "Live Unblind requires --grant and a positive timeout; use --opening for offline recovery",
    );
  }
  const states = JSON.parse(parseStringOption(args.states, "states") ?? "[\"issued\",\"revoked\",\"\"]");
  if (!Array.isArray(states) || !states.every(state => typeof state === "string")) {
    throw new ValidationError("--states must be a JSON string array");
  }
  const completed = yield* withExistingHab(walletStoreArgs(args), parseStringOption(args.alias, "alias"), {
    skipConfig: false,
  }, function*({ hby, hab }) {
    // TODO(group proposal API): group Unblind keeps its CLI-owned loop (runPresentationUnblind) until that API.
    const individual = !isLocalGroupHab(hby, hab);
    const runtime = yield* createAgentRuntime(hby, new NodeHttpClient(), systemClock, {
      kram: hby.cf?.get<{ kram?: KramConfig }>().kram,
      ...individual
        ? { ipexOwners: "per-identifier" as const }
        : { ipexAuxiliary: { kind: "unblind" as const, hab } },
    });
    try {
      const input = parseStringOption(args.input, "input");
      if (input) {
        yield* runtime.reactor.processBytes(yield* call(() => Deno.readFile(input)));
        yield* runtime.protocol.processEscrowsOnce();
      }
      const options = {
        timeoutMs: timeout * 1000,
        proposer: parseStringOption(args.proposer, "proposer"),
        listen,
        states,
      };
      return individual
        ? yield* runIndividualUnblind(runtime, hab, grant, { ...options, states })
        : yield* runPresentationUnblind(runtime, grant, options);
    } finally {
      yield* runtime.close();
    }
  });
  writeJsonLine(completed);
}
