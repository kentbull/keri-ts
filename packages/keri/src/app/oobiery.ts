import { action, type Operation } from "npm:effection@^3.6.0";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { OobiRecord } from "../core/records.ts";
import type { EndpointRole } from "../core/roles.ts";
import type { Habery } from "./habbing.ts";
import type { Reactor } from "./reactor.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/**
 * Runtime-tracked OOBI resolution job.
 *
 * The OOBI component enriches this shape as soon as a URL is parsed, then uses
 * the same record to write `oobis.`, `coobi.`, `eoobi.`, and `roobi.` state
 * transitions during resolution.
 */
export interface OobiJob {
  url: string;
  alias?: string;
  cid?: string;
  role?: EndpointRole | string;
  eid?: string;
  said?: string;
  state?: string;
}

/**
 * Durable OOBI processing component for one `Habery`.
 *
 * KERIpy correspondence:
 * - this is the closest local analogue to `Oobiery`
 *
 * Ownership model:
 * - authoritative queue state lives in `oobis.`, `coobi.`, `eoobi.`, and
 *   `roobi.`
 * - this component owns the fetch/parse/persist flow for those records
 * - transient in-memory state stays local to the fetch operation and does not
 *   leak back to the `AgentRuntime` root
 */
export class Oobiery {
  readonly hby: Habery;
  readonly reactor: Reactor;
  readonly cues: Deck<AgentCue>;

  constructor(
    hby: Habery,
    reactor: Reactor,
    { cues }: { cues?: Deck<AgentCue> } = {},
  ) {
    this.hby = hby;
    this.reactor = reactor;
    this.cues = cues ?? new Deck();
  }

  /**
   * Queue one OOBI for durable later processing.
   *
   * Current `keri-ts` rule:
   * - like KERIpy, the durable queue is the DB record in `oobis.`
   * - unlike the older bootstrap runtime, there is no root in-memory OOBI deck
   */
  resolve(url: string, alias?: string): void {
    const meta = parseOobiUrl(url, alias);
    this.hby.db.oobis.pin(url, {
      date: new Date().toISOString(),
      state: "queued",
      cid: meta.cid ?? null,
      eid: meta.eid ?? null,
      role: meta.role ?? null,
      oobialias: meta.alias ?? null,
      said: meta.said ?? null,
    });
    this.cues.push({ kin: "oobiQueued", url, alias: meta.alias });
  }

  /**
   * Process one queued durable OOBI record, if any.
   *
   * Behavior:
   * - reads the next `oobis.` record
   * - fetches it under Effection cancellation control
   * - routes any returned KERI bytes through `Reactor`
   * - transitions the durable record into `eoobi.` or `roobi.`
   *
   * Current limitation:
   * - this Gate E bootstrap slice only handles `oobis.`, not the richer
   *   KERIpy `woobi.` / MFA continuation paths yet
   */
  *processOnce(): Operation<void> {
    const item = this.nextQueued();
    if (!item) {
      return;
    }
    const [url, record] = item;
    yield* this.processJob(url, record);
  }

  /**
   * Continuous OOBI doer for the long-lived runtime host.
   *
   * This mirrors the KERIpy model where OOBI resolution is its own long-running
   * doer rather than root-owned queue plumbing.
   */
  *oobiDo(): Operation<never> {
    while (true) {
      yield* this.processOnce();
      yield* runtimeTurn();
    }
  }

  /** Return the next queued durable OOBI record, if any. */
  private nextQueued(): [string, OobiRecord] | null {
    for (const [keys, record] of this.hby.db.oobis.getTopItemIter()) {
      const url = keys[0];
      if (!url) {
        continue;
      }
      return [url, record];
    }
    return null;
  }

  /**
   * Resolve one queued OOBI record through fetch -> parse -> route -> persist.
   *
   * Stores touched:
   * - `oobis.` as the durable queued worklist
   * - `coobi.` while a fetched response is being processed
   * - `eoobi.` on HTTP failure
   * - `roobi.` after parser/routing success
   */
  private *processJob(url: string, record: OobiRecord): Operation<void> {
    const meta = {
      ...parseOobiUrl(url, record.oobialias ?? undefined),
      ...record,
      url,
    };
    const queuedRecord = {
      ...record,
      date: new Date().toISOString(),
      state: "queued",
      cid: meta.cid ?? null,
      eid: meta.eid ?? null,
      role: meta.role ?? null,
      oobialias: meta.alias ?? meta.oobialias ?? null,
      said: meta.said ?? null,
    };
    this.hby.db.oobis.pin(url, queuedRecord);

    const response = yield* fetchOobiResponse(url);
    if (!response.ok) {
      this.hby.db.oobis.rem(url);
      this.hby.db.eoobi.pin(url, {
        ...queuedRecord,
        date: new Date().toISOString(),
        state: `http-${response.status}`,
      });
      this.cues.push({
        kin: "oobiFailed",
        url,
        reason: `HTTP ${response.status}`,
      });
      return;
    }

    const bytes = yield* readResponseBytes(response);
    this.hby.db.oobis.rem(url);
    this.hby.db.coobi.pin(url, {
      ...queuedRecord,
      date: new Date().toISOString(),
      state: "fetched",
    });

    this.reactor.ingest(bytes);
    this.reactor.processOnce();

    this.hby.db.coobi.rem(url);
    this.hby.db.roobi.pin(url, {
      ...queuedRecord,
      date: new Date().toISOString(),
      state: "resolved",
    });
    this.cues.push({
      kin: "oobiResolved",
      url,
      cid: meta.cid ?? undefined,
      role: meta.role ?? undefined,
      eid: meta.eid ?? undefined,
    });
  }
}

/**
 * Parse one OOBI URL into its role/cid/eid metadata projection.
 *
 * Current scope:
 * - `/.well-known/keri/oobi/{cid}` -> controller role
 * - `/oobi/{cid}/{role}/{eid?}`
 *
 * The parser is intentionally permissive about unknown roles because the
 * runtime persists what it sees even before the broader ecosystem role matrix
 * is complete.
 */
function parseOobiUrl(url: string, alias?: string): OobiJob {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
  const job: OobiJob = {
    url,
    alias: alias ?? parsed.searchParams.get("name") ?? undefined,
  };

  if (
    parts.length >= 4
    && parts[0] === ".well-known"
    && parts[1] === "keri"
    && parts[2] === "oobi"
  ) {
    job.cid = parts[3];
    job.role = "controller";
    return job;
  }

  if (parts[0] === "oobi") {
    job.cid = parts[1];
    job.role = parts[2];
    job.eid = parts[3];
  }

  return job;
}

/**
 * Fetch one OOBI URL under Effection cancellation control.
 *
 * This is the real promise-adaptation boundary for remote OOBI retrieval. The
 * surrounding runtime stays operation-native.
 */
function* fetchOobiResponse(url: string): Operation<Response> {
  return yield* action((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    fetch(url, { signal: controller.signal }).then((response) => {
      settled = true;
      resolve(response);
    }).catch(reject);
    return () => {
      if (!settled) {
        controller.abort();
      }
    };
  });
}

/**
 * Read one HTTP response body into a byte array under Effection control.
 *
 * Like `fetchOobiResponse()`, this keeps raw Web API promise handling at the
 * edge instead of promoting it to the runtime-turn API.
 */
function* readResponseBytes(response: Response): Operation<Uint8Array> {
  return yield* action((resolve, reject) => {
    response.arrayBuffer()
      .then((buffer) => resolve(new Uint8Array(buffer)))
      .catch(reject);
    return () => {};
  });
}
