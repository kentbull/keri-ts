/**
 * Background loops that sign with a local key meet a missing key when the host has released it
 * (`Manager.release`), which a custodial host does on purpose. That is a condition to wait out, not a failure
 * of the runtime: the loop reports it here, backs off and resumes when a signer is held again
 * (`Manager.hold`), and an application reads the list to tell its user which identifier cannot act.
 */
import { action, type Operation } from "npm:effection@^3.6.0";
import type { RuntimeClock } from "./runtime-clock.ts";

/** One loop that is waiting for a signer the host has not held. */
export interface SignerCondition {
  /** The loop and, where it has one, the subject, such as `mailbox-poller:<pre>/<mailbox>`. */
  readonly source: string;
  /** The qualified public key whose private key is missing. */
  readonly pub: string;
  /** Epoch milliseconds when this source first reported it. */
  readonly since: number;
}

/** The runtime's record of loops waiting for a signer; process-local, rebuilt by the loops themselves. */
export class SignerConditions {
  readonly #conditions = new Map<string, SignerCondition>();
  readonly #waiters = new Set<() => void>();

  /** `source` cannot sign because `pub` is not held; keeps the first time it was reported. */
  report(source: string, pub: string, now: number): void {
    const known = this.#conditions.get(source);
    this.#conditions.set(source, known?.pub === pub ? known : { source, pub, since: now });
  }

  /** `source` no longer waits for a signer. */
  clear(source: string): void {
    this.#conditions.delete(source);
  }

  /** The loops waiting for a signer now. */
  list(): readonly SignerCondition[] {
    return [...this.#conditions.values()];
  }

  /** A signer was held: forget every condition (a loop that still lacks its key reports again) and wake the waiters. */
  held(): void {
    this.#conditions.clear();
    for (const wake of [...this.#waiters]) wake();
  }

  /** Wait up to `ms` on the host clock, or until a signer is held, whichever comes first. */
  *waitForHold(clock: RuntimeClock, ms: number): Operation<void> {
    yield* action<void>((resolve) => {
      const timer = clock.setTimeout(resolve, ms);
      this.#waiters.add(resolve);
      return () => {
        clock.clearTimeout(timer);
        this.#waiters.delete(resolve);
      };
    });
  }
}
