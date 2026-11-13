/** Finite live presentation proof acquisition/release; original Grant authority and Admit remain separate. */
import { startServer } from "@keri-ts/hosting";
import { action, call, type Operation, scoped, spawn } from "effection";
import { parseIntegerOption, parseNumberOption, parseStringOption, withRuntimeWorkers } from "keri-ts/cli";
import {
  abandonUnblinding,
  type AgentRuntime,
  answerUnblind,
  consoleLogger,
  createAgentRuntime,
  type Hab,
  isLocalGroupHab,
  type KramConfig,
  localGroupMember,
  requestUnblind,
  systemClock,
  ValidationError,
  waitForUnblinding,
} from "keri-ts/runtime";
import { NodeHttpClient } from "keri-ts/runtime/node";
import { withExistingHab } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { walletStoreArgs } from "../support/wallet.ts";

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
/**
 * One Unblind, individual or group, through the runtime's owner: consent, then `processOnce` under the host
 * workers while the wait observes. A group member also names the `proposer`, the signing member that authors the
 * query (disclosee) or the reply (discloser). Only the optional direct listener (`--listen`) is the CLI's own.
 */
export function* runUnblind(
  runtime: AgentRuntime,
  hab: Hab,
  grant: string,
  { timeoutMs, proposer, listen, states }: PresentationUnblindOptions,
): Operation<PresentationUnblindResult> {
  if (listen !== undefined && (!Number.isInteger(listen) || listen < 1 || listen > 65535)) {
    throw new ValidationError("--listen must be a port between 1 and 65535");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ValidationError("Unblind timeout must be positive");
  // The runtime's own owner: the host loop under `withRuntimeWorkers` drives it, so a reply the discloser owes is
  // delivered once, not by this command and the loop both.
  const ops = runtime.operations!.unblinding;
  const group = isLocalGroupHab(runtime.hby, hab);
  const member = group ? localGroupMember(runtime.hby, hab.pre!) : hab;
  const requester = runtime.exc.retainedInput(grant)?.serder.sad?.ri === hab.pre;
  const run = function*() {
    // The disclosee consents explicitly; an individual discloser only listens and its owner answers an
    // authenticated query, while each member of a discloser group consents to contribute to the one reply.
    const options = { states, proposer };
    const begun = requester ? requestUnblind(ops, grant, options) : group ? answerUnblind(ops, grant, options) : null;
    const outcome = yield* withRuntimeWorkers(runtime, { hab: member, pollMailbox: true }, function*() {
      const stop = runtime.clock.now() + timeoutMs;
      while (!begun && !ops.liveOf(grant) && !ops.settledOf(grant)) {
        if (runtime.clock.now() >= stop) {
          throw new ValidationError("Unblind reached its elapsed limit or original Grant deadline without Admit");
        }
        yield* wait(runtime, 50);
      }
      return yield* waitForUnblinding(ops, grant, { timeoutMs: Math.max(1, stop - runtime.clock.now()) });
    });
    const exchange = runtime.exc.retainedInput(grant)!.serder;
    const xid = begun?.xid ?? String(exchange.ilk === "xip" ? exchange.said : exchange.sad!.x),
      role = requester ? "requester" : "responder";
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
        serviceHab: member,
        hostedPrefixes: [...new Set([member.pre!, hab.pre!])],
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
    const runtime = yield* createAgentRuntime(hby, new NodeHttpClient(), systemClock, {
      kram: hby.cf?.get<{ kram?: KramConfig }>().kram,
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
      return yield* runUnblind(runtime, hab, grant, options);
    } finally {
      yield* runtime.close();
    }
  });
  writeJsonLine(completed);
}
