/**
 * Library entry points for resolving one OOBI URL.
 *
 * `tufa oobi resolve` and a browser wallet share this: queue the URL with the
 * durable Oobiery, then observe the Oobiery's own records until the URL reaches
 * a terminal row. Everything observable lives in `oobis.`, `coobi.`, `moobi.`,
 * `eoobi.` and `roobi.`, so a caller can begin, return to its UI and read the
 * status later without a handle.
 *
 * These functions never start runtime workers. Something must already be running
 * the Oobiery (a wallet's own runtime, or the CLI's `withRuntimeWorkers`) for a
 * queued job to progress; see `app/runtime/workflow-contract.ts`.
 */
import type { Operation } from "effection";
import type { OobiRecord } from "../../core/records.ts";
import type { Baser } from "../../db/basing.ts";
import { type ChangeSink, observeUntil } from "../runtime/workflow-contract.ts";
import { type Oobiery, oobiTerminalState } from "./oobiery.ts";

/** Default wall-clock budget for one blocking resolution. */
export const OOBI_RESOLVE_TIMEOUT_MS = 30_000;

/** Collaborator for the pure status read: the OOBI record stores. A `Habery` fits. */
export interface OobiStatusDeps {
  readonly db: Baser;
}

/** Collaborators for queueing a URL. */
export interface OobiBeginDeps {
  /** Durable job owner; only its queueing entry is used. */
  readonly oobiery: Pick<Oobiery, "resolve">;
  /** Optional sink told `{kind:"oobi", id:url}` after the job is queued. */
  readonly changes?: ChangeSink;
}

/** Collaborators for the observe-only wait. */
export interface OobiWaitDeps extends OobiStatusDeps {
  /**
   * Extra host predicate that OOBI-dependent ingress has settled, evaluated
   * after the terminal row exists. Omitted: the terminal row alone ends the wait.
   */
  readonly settled?: () => boolean;
  /** Optional sink told `{kind:"oobi", id:url}` when the wait ends in a terminal state. */
  readonly changes?: ChangeSink;
}

/** Everything `resolveOobi` needs. */
export interface OobiResolveDeps extends OobiBeginDeps, OobiWaitDeps {}

/** Optional controls for beginning a resolution. */
export interface BeginOobiOptions {
  /** Contact alias recorded when the OOBI resolves. */
  alias?: string;
}

/** Optional controls for a wait. */
export interface WaitForOobiOptions {
  /** Wall-clock budget; defaults to {@link OOBI_RESOLVE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Optional controls for a blocking resolution. */
export interface ResolveOobiOptions extends BeginOobiOptions, WaitForOobiOptions {}

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

/** Outcome of a wait: terminal Oobiery state, or the budget expiring first. */
export type OobiResolveResult =
  | Exclude<OobiStatus, { status: "pending" }>
  | { status: "timed-out"; timeoutMs: number };

/**
 * Queue one URL with the durable Oobiery. Returns after the job is queued.
 *
 * @param url Exact OOBI or well-known URL; it is also the key of the status record.
 */
export function beginOobi(deps: OobiBeginDeps, url: string, options: BeginOobiOptions = {}): void {
  deps.oobiery.resolve(url, options.alias);
  deps.changes?.push({ kind: "oobi", id: url });
}

/** Read the durable status of one requested URL. Pure: no worker, no I/O beyond the Baser. */
export function oobiStatus(deps: OobiStatusDeps, url: string): OobiStatus {
  const terminal = oobiTerminalState(deps.db, url);
  if (terminal.status === "pending" || !terminal.record) return { status: "pending" };
  if (terminal.status === "resolved") return { status: "resolved", record: terminal.record };
  return { status: "failed", reason: terminal.record.state ?? "failed", record: terminal.record };
}

/**
 * Observe a queued URL until it is terminal (and `deps.settled`, when given) or
 * the budget expires. Starts no worker.
 *
 * @returns `resolved`, `failed` with the recorded reason, or `timed-out`.
 */
export function* waitForOobi(
  deps: OobiWaitDeps,
  url: string,
  { timeoutMs = OOBI_RESOLVE_TIMEOUT_MS }: WaitForOobiOptions = {},
): Operation<OobiResolveResult> {
  const done = yield* observeUntil(
    () => oobiStatus(deps, url).status !== "pending" && (deps.settled?.() ?? true),
    { timeoutMs },
  );
  const status = done ? oobiStatus(deps, url) : { status: "pending" as const };
  if (status.status === "pending") return { status: "timed-out", timeoutMs };
  deps.changes?.push({ kind: "oobi", id: url });
  return status;
}

/** `beginOobi` then `waitForOobi`. The host must be running the Oobiery for the wait to end in a terminal state. */
export function* resolveOobi(
  deps: OobiResolveDeps,
  url: string,
  options: ResolveOobiOptions = {},
): Operation<OobiResolveResult> {
  beginOobi(deps, url, options);
  return yield* waitForOobi(deps, url, options);
}
