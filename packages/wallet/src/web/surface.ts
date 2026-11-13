/**
 * What every namespace of the wallet-level API shares: the parts they read and drive, the budgets of the calls that
 * wait, and the one place an app's promise meets the runtime's scope.
 */
import { action, type Operation, race, run } from "effection";
import {
  type AgentRuntime,
  AppError,
  type ChangeSink,
  type Hab,
  type Habery,
  isLocalGroupHab,
  type RuntimeClock,
  ValidationError,
} from "keri-ts/runtime";
import type { WalletBaser } from "../storing.ts";
import type { Wallet } from "../wallet.ts";

/** Thrown by a call made on a wallet that was closed, or whose runtime stopped. */
export class WalletStoppedError extends AppError {
  override readonly name: string = "WalletStoppedError";
}

/** Default wall-clock budgets, in milliseconds, of the calls that wait. */
export const WALLET_TIMEOUTS = Object.freeze({
  oobi: 30_000,
  mailbox: 15_000,
  delegation: 120_000,
  registry: 60_000,
  receive: 90_000,
  issue: 120_000,
  delivery: 30_000,
  present: 30_000,
  unblind: 60_000,
  group: 120_000,
});

/** What the surface reads and drives; built by `openWebWallet`. */
export interface WalletApiParts {
  readonly hby: Habery;
  readonly runtime: AgentRuntime;
  readonly wallet: Wallet;
  readonly inventory: WalletBaser;
  /** The sink the runtime's owners publish to; the surface publishes event and OOBI changes to it too. */
  readonly changes: ChangeSink;
  /** Issuances this wallet will record when they finish, by Grant SAID; see {@link walletChangeSink}. */
  readonly tracked: TrackedIssuances;
  /** Throws {@link WalletStoppedError} unless the wallet is open and its runtime is running. */
  assertRunning(): void;
}

/** Recorders of issuances in flight: a recorder returns true once the issuance is over and recorded. */
export type TrackedIssuances = Map<string, () => boolean>;

/** A workflow an app-level call runs: no arguments, one result. */
export type Work<T> = () => Operation<T>;

/** What {@link within} returns: the work's value, or the news that the budget expired first. */
export type TimedResult<T> = { done: true; value: T } | { done: false };

/** The only choice many calls offer: how long to wait, in milliseconds, before returning `timed-out`. */
export interface TimeoutOptions {
  timeoutMs?: number;
}

/** The result of racing `op` against `ms` on the host clock; the loser is cancelled. */
export function* within<T>(clock: RuntimeClock, ms: number, op: Work<T>): Operation<TimedResult<T>> {
  const timer = function*() {
    yield* action<void>((resolve) => {
      const handle = clock.setTimeout(resolve, ms);
      return () => clock.clearTimeout(handle);
    });
    return { done: false as const };
  };
  const work = function*() {
    return { done: true as const, value: yield* op() };
  };
  return yield* race([work(), timer()]);
}

/** Run a delivery within `ms`; a failure or an expired budget reads `undelivered` with its reason. */
export function* delivered(clock: RuntimeClock, ms: number, send: Work<string[]>): Operation<AdmitDelivery> {
  try {
    const sent = yield* within(clock, ms, send);
    return sent.done
      ? { state: "delivered", to: sent.value }
      : { state: "undelivered", reason: `Delivery did not finish within ${ms} ms.` };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { state: "undelivered", reason: error.message };
  }
}

/**
 * What every namespace of the wallet-level API holds instead of inheriting: the wallet's collaborators, and the
 * one place an app's promise meets the runtime's scope. Built once by `createWalletApi`.
 */
export class WalletScope {
  constructor(readonly parts: WalletApiParts) {}

  /** Run one workflow to its result in its own Effection root. */
  go<T>(op: Work<T>): Promise<T> {
    this.parts.assertRunning();
    return run(op);
  }

  /** The local identifier `pre`, a single-signature one or a group, or a caller-contract failure. */
  hab(pre: string): Hab {
    const hab = this.parts.hby.habs.get(pre);
    if (!hab) throw new ValidationError(`${pre} is not a local identifier of this wallet.`);
    return hab;
  }

  /** The local group identifier `pre` (prefix or alias), or a caller-contract failure. */
  group(pre: string): Hab {
    const hab = this.parts.hby.habs.get(pre) ?? this.parts.hby.habByName(pre);
    if (!hab || !isLocalGroupHab(this.parts.hby, hab)) {
      throw new ValidationError(`${pre} is not a local group identifier of this wallet.`);
    }
    return hab;
  }

  /** The local single-signature identifier `pre`: a group is refused. */
  individual(pre: string): Hab {
    const hab = this.hab(pre);
    if (isLocalGroupHab(this.parts.hby, hab)) {
      throw new ValidationError("Group identifiers are not covered by this call.");
    }
    return hab;
  }
}

/** Whether the Admit reached the issuer. The Admit is accepted and recorded locally either way. */
export type AdmitDelivery =
  | { state: "delivered"; to: string[] }
  | { state: "undelivered"; reason: string }
  /** A group's Admit is delivered by its elected lead member, not by this one. */
  | { state: "by-lead" };
