/**
 * Poll-and-settle for credential IPEX traffic: what arrived through the mailbox,
 * settling the grants already stored, and waiting for new state to appear.
 *
 * The pieces follow the workflow contract. `settleStoredGrants` is the explicit
 * operation: it replays stored grant artifacts that have not yet saved their
 * credential. `ipexArrivalStatus` is a pure synchronous read of durable state
 * (accepted `exns` and `reger.saved`) against a baseline taken earlier.
 * `waitForIpexArrival` only observes: it starts no worker and returns a
 * {@link WaitResult} instead of throwing on its deadline.
 *
 * How hosts use it:
 * - A wallet's runtime already polls its mailboxes continuously, so it takes a
 *   baseline, then calls `ipexArrivalStatus` from its UI or `waitForIpexArrival`
 *   (passing `settle` bound to `settleStoredGrants` when it wants stored grants
 *   replayed). It runs no workers and no poller of its own.
 * - `tufa ipex poll` has no running runtime, so it runs the workers itself
 *   (`withRuntimeWorkers` plus a mailbox poller whose batches pass through
 *   {@link MailboxIntakeTally.track}) around the same wait.
 *
 * Dependencies are narrow collaborators, not an AgentRuntime (ADR-0013).
 */
import type { SerderKERI, Versionage } from "cesr-ts";
import { type Operation, sleep } from "npm:effection@^3.6.0";
import type { Reger } from "../../db/reger.ts";
import type { Habery } from "../identity/habbing.ts";
import {
  credentialSaidFromGrant,
  processCredentialPresentationArtifacts,
  storedGrantArtifacts,
} from "../ipex/ipex-credentialing.ts";
import { IPEX_GRANT_ROUTE } from "../ipex/ipexing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { type RuntimeClock, systemClock } from "../runtime/runtime-clock.ts";
import type { WaitResult } from "../runtime/workflow-contract.ts";
import type { MailboxPollBatch } from "./mailbox-poller.ts";

/** Stores the status read inspects. A `Habery` and a `Reger` fit. */
export interface IpexArrivalDeps {
  /** Accepted exchange messages. */
  readonly hby: Pick<Habery, "db">;
  /** Saved credential index. */
  readonly reger: Pick<Reger, "saved">;
}

/** Collaborators for replaying stored grants. */
export interface StoredGrantSettleDeps extends IpexArrivalDeps {
  /** Needs the full `Habery`: stored artifacts are rebuilt from its escrow paths. */
  readonly hby: Habery;
  /** Receive processor that accepts the replayed grant artifacts. */
  readonly protocol: ProtocolProcessor;
}

/** Said sets taken before waiting; arrivals are everything beyond them. */
export interface IpexBaseline {
  readonly exns: ReadonlySet<string>;
  readonly saved: ReadonlySet<string>;
}

/**
 * Counts mailbox batches a host has consumed and whether one is still settling.
 * Process-local: it describes this host's intake, so it is not part of any durable
 * status. A wallet that does not track batches simply omits it.
 */
export class MailboxIntakeTally {
  receiving = 0;
  batches = 0;
  messages = 0;

  /** Run the host's settle step for one batch, counting it when settled. */
  *track(batch: MailboxPollBatch, settle: () => Operation<void>): Operation<void> {
    this.receiving++;
    try {
      yield* settle();
      this.batches++;
      this.messages += batch.messages.length;
    } finally {
      this.receiving--;
    }
  }
}

/** What arrived since the baseline. `arrived` once new state exists and no batch is mid-settle. */
export interface IpexArrivalStatus {
  state: "waiting" | "arrived";
  /** New accepted `/ipex/` exchange messages, in store order. */
  ipex: SerderKERI[];
  /** Said of each newly saved credential. */
  saved: string[];
  /** True while the host's tally has a batch mid-settle (state may be partially visible). */
  receiving: boolean;
}

/** Options for {@link waitForIpexArrival}. */
export interface WaitForIpexArrivalOptions {
  /** Wall-clock budget. */
  timeoutMs: number;
  /** Host intake tally; when omitted no batch is ever considered mid-settle. */
  tally?: MailboxIntakeTally;
  /** Elapsed milliseconds between reads. */
  pollMs?: number;
  clock?: RuntimeClock;
}

/** Deps and host hook for {@link waitForIpexArrival}. */
export interface IpexArrivalWaitDeps extends IpexArrivalDeps {
  /** Host-supplied step run before each read, such as `settleStoredGrants`. */
  readonly settle?: () => Operation<void>;
}

function accepted(deps: IpexArrivalDeps): SerderKERI[] {
  return [...deps.hby.db.exns.getTopItemIter()].map(([, exn]) => exn);
}

function savedSaids(deps: IpexArrivalDeps): string[] {
  return [...deps.reger.saved.getTopItemIter()].map(([keys]) => keys[0]).filter((key): key is string => !!key);
}

/** Snapshot the said sets that later arrivals are measured against. */
export function ipexBaseline(deps: IpexArrivalDeps): IpexBaseline {
  return {
    exns: new Set(accepted(deps).map((exn) => exn.said).filter((said): said is string => typeof said === "string")),
    saved: new Set(savedSaids(deps)),
  };
}

/** Pure read of what arrived since `baseline`. Starts nothing and writes nothing. */
export function ipexArrivalStatus(
  deps: IpexArrivalDeps,
  baseline: IpexBaseline,
  tally?: MailboxIntakeTally,
): IpexArrivalStatus {
  const ipex = accepted(deps).filter((exn) =>
    !!exn.said && !baseline.exns.has(exn.said) && (exn.route ?? "").startsWith("/ipex/")
  );
  const saved = [...new Set(savedSaids(deps))].filter((said) => !baseline.saved.has(said));
  const receiving = (tally?.receiving ?? 0) > 0;
  return {
    state: !receiving && (ipex.length > 0 || saved.length > 0) ? "arrived" : "waiting",
    ipex,
    saved,
    receiving,
  };
}

/**
 * Replay accepted grant artifacts whose credential is not yet saved, so a grant
 * stored before the credential arrived settles once its evidence is complete.
 */
export function* settleStoredGrants(deps: StoredGrantSettleDeps, gvrsn?: Versionage): Operation<void> {
  for (const [, grant] of deps.hby.db.exns.getTopItemIter()) {
    if (grant.route !== IPEX_GRANT_ROUTE) continue;
    const credentialSaid = credentialSaidFromGrant(grant);
    if (!credentialSaid || deps.reger.saved.get([credentialSaid])) continue;
    yield* processCredentialPresentationArtifacts(deps.protocol, storedGrantArtifacts(deps.hby, grant, gvrsn));
  }
}

/**
 * Observe until new IPEX state has arrived and settled, or the budget expires.
 * Runs `deps.settle` before each read; starts no worker.
 *
 * @returns `settled` with the arrival, or `timed-out` with the last read (which
 * may already hold arrivals that were still mid-settle).
 */
export function* waitForIpexArrival(
  deps: IpexArrivalWaitDeps,
  baseline: IpexBaseline,
  { timeoutMs, tally, pollMs = 250, clock = systemClock }: WaitForIpexArrivalOptions,
): Operation<WaitResult<IpexArrivalStatus>> {
  const deadline = clock.now() + timeoutMs;
  while (true) {
    if (deps.settle) yield* deps.settle();
    const status = ipexArrivalStatus(deps, baseline, tally);
    if (status.state === "arrived") return { outcome: "settled", status };
    const remaining = deadline - clock.now();
    if (remaining <= 0) return { outcome: "timed-out", status, timeoutMs };
    yield* sleep(Math.min(pollMs, remaining));
  }
}
