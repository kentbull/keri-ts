/**
 * Library entry points for resolving one OOBI URL.
 *
 * `tufa oobi resolve` and a browser wallet share this orchestration: queue the
 * URL with the durable Oobiery, run the runtime workers until the URL's terminal
 * row exists and the dependent ingress settles, then report what the Oobiery
 * recorded. Everything observable about a resolution lives in the existing
 * `oobis.`, `coobi.`, `moobi.`, `eoobi.` and `roobi.` records, so a caller can
 * begin a resolution, return to its UI, and read the status later (even from a
 * different runtime over the same stores) without a handle.
 */
import type { Operation } from "effection";
import type { OobiRecord } from "../../core/records.ts";
import {
  type AgentRuntime,
  runAgentRuntimeWithin,
  runtimeOobiConverged,
} from "../runtime/agent-runtime.ts";
import { oobiTerminalState } from "./oobiery.ts";

/** Default wall-clock budget for one blocking resolution. */
export const OOBI_RESOLVE_TIMEOUT_MS = 30_000;

/** Collaborators needed to queue and observe a resolution; no workers are required. */
export type OobiResolutionDeps = Pick<AgentRuntime, "hby" | "oobiery">;

/** Optional controls for beginning a resolution. */
export interface BeginOobiOptions {
  /** Contact alias recorded when the OOBI resolves. */
  alias?: string;
}

/** Optional controls for a blocking resolution. */
export interface ResolveOobiOptions extends BeginOobiOptions {
  /** Wall-clock budget; defaults to {@link OOBI_RESOLVE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Durable state of one requested URL. `pending` covers queued, in flight and unknown URLs. */
export type OobiStatus =
  | { status: "pending" }
  | { status: "resolved"; record: OobiRecord }
  | {
    status: "failed";
    /** The state the Oobiery recorded, or `"failed"` when it recorded none. */
    reason: string;
    record: OobiRecord;
  };

/** Outcome of a blocking resolution: terminal Oobiery state, or the budget expiring first. */
export type OobiResolveResult =
  | Exclude<OobiStatus, { status: "pending" }>
  | { status: "timed-out"; timeoutMs: number };

/**
 * Queue one URL with the durable Oobiery without running any worker.
 *
 * The queued job survives restarts; some runtime must run (for example through
 * `runAgentRuntime`) for it to progress. Read progress with {@link oobiStatus}.
 *
 * @param deps Borrowed runtime parts; the caller owns store and worker lifetime.
 * @param url Exact OOBI or well-known URL; it is also the key of the status record.
 */
export function beginOobi(deps: OobiResolutionDeps, url: string, options: BeginOobiOptions = {}): void {
  deps.oobiery.resolve(url, options.alias);
}

/**
 * Read the durable status of one requested URL. Starts no worker and does I/O only on the Baser.
 *
 * @param deps Borrowed runtime parts.
 * @param url Exact URL passed to {@link beginOobi}.
 */
export function oobiStatus(deps: Pick<AgentRuntime, "hby">, url: string): OobiStatus {
  const terminal = oobiTerminalState(deps.hby.db, url);
  if (terminal.status === "pending" || !terminal.record) return { status: "pending" };
  if (terminal.status === "resolved") return { status: "resolved", record: terminal.record };
  return { status: "failed", reason: terminal.record.state ?? "failed", record: terminal.record };
}

/**
 * Queue a URL, run the runtime workers until the resolution converges, and report its outcome.
 *
 * Convergence means the terminal row exists and OOBI-dependent cues, escrows and
 * queries have settled, so fetched KEL and reply material is already accepted.
 * Workers are halted and joined before this returns, on every outcome.
 *
 * @param runtime Borrowed composed runtime; the caller owns store lifetime.
 * @param url Exact OOBI or well-known URL.
 * @returns `resolved`, `failed` with the recorded reason, or `timed-out`. Worker
 * or cleanup failures propagate as exceptions.
 */
export function* resolveOobi(
  runtime: AgentRuntime,
  url: string,
  options: ResolveOobiOptions = {},
): Operation<OobiResolveResult> {
  const timeoutMs = options.timeoutMs ?? OOBI_RESOLVE_TIMEOUT_MS;
  beginOobi(runtime, url, options);
  const converged = yield* runAgentRuntimeWithin(
    runtime,
    () => runtimeOobiConverged(runtime, url),
    { timeoutMs, pollMailbox: false },
  );
  const status = converged ? oobiStatus(runtime, url) : { status: "pending" as const };
  return status.status === "pending" ? { status: "timed-out", timeoutMs } : status;
}
