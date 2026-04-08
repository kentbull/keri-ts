import { action, type Operation } from "npm:effection@^3.6.0";
import { type Cigar, Diger, Ilks, Prefixer, SerderKERI } from "../../../cesr/mod.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { type TransIdxSigGroup } from "../core/dispatch.ts";
import { UnverifiedReplyError, ValidationError } from "../core/errors.ts";
import type { OobiRecord, OobiRecordShape } from "../core/records.ts";
import { type Role, Roles } from "../core/roles.ts";
import type { Habery } from "./habbing.ts";
import { closeResponseBody, fetchResponseHandle } from "./httping.ts";
import { persistResolvedContact } from "./organizing.ts";
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
  role?: Role | string;
  eid?: string;
  said?: string;
  state?: string;
}

type OobiQueueKind = "oobis" | "woobi";

/**
 * Durable OOBI processing component for one `Habery`.
 *
 * KERIpy correspondence:
 * - this is the closest local analogue to `Oobiery`
 *
 * Ownership model:
 * - authoritative queue state lives in `oobis.`, `woobi.`, `coobi.`, `eoobi.`,
 *   and `roobi.`
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

  /** Register `/introduce` on the shared reply router. */
  registerReplyRoutes(router = this.reactor.router): void {
    router.addRoute("/introduce", this);
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
    this.pinQueuedRecord(queueKindFor(url), url, meta);
    this.cues.push({ kin: "oobiQueued", url, alias: meta.alias });
  }

  /**
   * Process one queued durable OOBI record, if any.
   *
   * Behavior:
   * - reads the next queued `oobis.` / `woobi.` record
   * - fetches it under Effection cancellation control
   * - routes any returned KERI bytes through `Reactor`
   * - transitions the durable record into `eoobi.` or `roobi.`
   */
  *processOnce(): Operation<void> {
    const item = this.nextQueued();
    if (item) {
      const [kind, url, record] = item;
      yield* this.processJob(kind, url, record);
      return;
    }

    const multi = this.nextReadyMoobi();
    if (multi) {
      const [url, record] = multi;
      this.completeMultiOobi(url, record);
    }
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
  private nextQueued(): [OobiQueueKind, string, OobiRecord] | null {
    for (const [keys, record] of this.hby.db.oobis.getTopItemIter()) {
      const url = keys[0];
      if (!url) {
        continue;
      }
      return ["oobis", url, record];
    }

    return null;
  }

  /** Return one multi-OOBI parent whose child URLs have all settled. */
  private nextReadyMoobi(): [string, OobiRecord] | null {
    for (const [keys, record] of this.hby.db.moobi.getTopItemIter()) {
      const url = keys[0];
      if (!url) {
        continue;
      }

      const urls = record.urls ?? [];
      if (
        urls.length === 0
        || urls.every((childUrl) => !!this.hby.db.roobi.get(childUrl) || !!this.hby.db.eoobi.get(childUrl))
      ) {
        return [url, record];
      }
    }

    return null;
  }

  /**
   * Resolve one queued OOBI record through fetch -> parse -> route -> persist.
   *
   * Stores touched:
   * - `oobis.` / `woobi.` as the durable queued worklists
   * - `coobi.` while a fetched response is being processed
   * - `eoobi.` on HTTP failure
   * - `roobi.` after parser/routing success
   */
  private *processJob(
    kind: OobiQueueKind,
    url: string,
    record: OobiRecord,
  ): Operation<void> {
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
    this.pinQueueStore(kind, url, queuedRecord);

    const response = yield* fetchOobiResponse(url);
    if (!response.ok) {
      yield* closeResponseBody(response);
      this.remQueueStore(kind, url);
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
    const contentType = response.headers.get("content-type")?.toLowerCase()
      ?? "";
    this.remQueueStore(kind, url);
    this.hby.db.coobi.pin(url, {
      ...queuedRecord,
      date: new Date().toISOString(),
      state: "fetched",
    });

    if (contentType.includes("json")) {
      if (this.processJsonOobiResponse(url, queuedRecord, bytes)) {
        return;
      }
      this.failFetchedOobi(url, queuedRecord, "invalid-json-oobi");
      return;
    }

    this.reactor.ingest(bytes);
    this.reactor.processOnce();

    this.hby.db.coobi.rem(url);
    this.hby.db.roobi.pin(url, {
      ...queuedRecord,
      date: new Date().toISOString(),
      state: "resolved",
    });
    persistResolvedContact(this.hby, meta.cid, {
      alias: queuedRecord.oobialias,
      oobi: url,
    });
    this.cues.push({
      kin: "oobiResolved",
      url,
      cid: meta.cid ?? undefined,
      role: meta.role ?? undefined,
      eid: meta.eid ?? undefined,
    });
  }

  /** Handle JSON OOBI responses that carry reply bodies instead of CESR streams. */
  private processJsonOobiResponse(
    url: string,
    record: OobiRecordShape,
    bytes: Uint8Array,
  ): boolean {
    let serder: SerderKERI;
    try {
      serder = new SerderKERI({ raw: bytes });
    } catch {
      return false;
    }

    if (!serder.verify() || serder.ilk !== Ilks.rpy) {
      return false;
    }

    if (
      serder.route === "/oobi/controller" || serder.route === "/oobi/witness"
    ) {
      this.processMultiOobiReply(url, record, serder);
      return true;
    }

    return false;
  }

  /** Fan one multi-OOBI reply out into child `oobis.` jobs and a parent `moobi.` record. */
  private processMultiOobiReply(
    url: string,
    record: OobiRecordShape,
    serder: SerderKERI,
  ): void {
    const data = serder.ked?.a as Record<string, unknown> | undefined;
    const cid = typeof data?.aid === "string"
      ? new Prefixer({ qb64: data.aid }).qb64
      : null;
    const urls = Array.isArray(data?.urls)
      ? [
        ...new Set(
          data.urls.filter((entry): entry is string => typeof entry === "string"),
        ),
      ]
      : [];

    if (
      !cid || cid !== (record.cid ?? parseOobiUrl(url).cid ?? null)
      || urls.length === 0
    ) {
      this.failFetchedOobi(url, record, "invalid-multi-oobi");
      return;
    }

    for (const childUrl of urls) {
      this.resolve(childUrl, record.oobialias ?? undefined);
    }

    this.hby.db.coobi.rem(url);
    this.hby.db.moobi.pin(url, {
      ...record,
      cid,
      date: new Date().toISOString(),
      state: "pending-multi-oobi",
      urls,
    });
  }

  /** Finalize one parent multi-OOBI after its child URLs all reach terminal state. */
  private completeMultiOobi(url: string, record: OobiRecord): void {
    const urls = record.urls ?? [];
    const date = new Date().toISOString();
    const failed = urls.length === 0
      || urls.some((childUrl) => !!this.hby.db.eoobi.get(childUrl));

    this.hby.db.moobi.rem(url);
    if (failed) {
      this.hby.db.eoobi.pin(url, {
        ...record,
        date,
        state: urls.length === 0 ? "invalid-multi-oobi" : "child-failed",
      });
      this.cues.push({
        kin: "oobiFailed",
        url,
        reason: urls.length === 0 ? "invalid multi-oobi" : "child failed",
      });
      return;
    }

    this.hby.db.roobi.pin(url, {
      ...record,
      date,
      state: "resolved",
    });
    persistResolvedContact(this.hby, record.cid ?? null, {
      alias: record.oobialias,
      oobi: url,
    });
    this.cues.push({
      kin: "oobiResolved",
      url,
      cid: record.cid ?? undefined,
      role: record.role ?? undefined,
      eid: record.eid ?? undefined,
    });
  }

  /** Mark one fetched OOBI as terminal failure and clear its in-flight state. */
  private failFetchedOobi(
    url: string,
    record: OobiRecordShape,
    state: string,
  ): void {
    this.hby.db.coobi.rem(url);
    this.hby.db.eoobi.pin(url, {
      ...record,
      date: new Date().toISOString(),
      state,
    });
    this.cues.push({
      kin: "oobiFailed",
      url,
      reason: state,
    });
  }

  /** Persist one queued record into the selected durable queue. */
  private pinQueueStore(
    kind: OobiQueueKind,
    url: string,
    record: OobiRecordShape,
  ): void {
    const store = kind === "woobi" ? this.hby.db.woobi : this.hby.db.oobis;
    store.pin(url, record);
  }

  /** Remove one queued record from the selected durable queue. */
  private remQueueStore(kind: OobiQueueKind, url: string): void {
    const store = kind === "woobi" ? this.hby.db.woobi : this.hby.db.oobis;
    store.rem(url);
  }

  /** Normalize and persist one new queued OOBI record into the default queue. */
  private pinQueuedRecord(
    kind: OobiQueueKind,
    url: string,
    meta: OobiJob,
  ): void {
    this.pinQueueStore(kind, url, {
      date: new Date().toISOString(),
      state: "queued",
      cid: meta.cid ?? null,
      eid: meta.eid ?? null,
      role: meta.role ?? null,
      oobialias: meta.alias ?? null,
      said: meta.said ?? null,
    });
  }

  /**
   * Process one `/introduce` reply and enqueue the introduced OOBI into the
   * ordinary durable resolver path.
   */
  processReply(args: {
    serder: SerderKERI;
    diger: Diger;
    route: string;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): void {
    if (args.route !== "/introduce") {
      throw new ValidationError(
        `Unsupported route=${args.route} in ${Ilks.rpy} reply.`,
      );
    }

    const data = args.serder.ked?.a as Record<string, unknown> | undefined;
    const cid = typeof data?.cid === "string"
      ? new Prefixer({ qb64: data.cid }).qb64
      : null;
    const oobi = typeof data?.oobi === "string" ? data.oobi : null;
    const dt = typeof args.serder.ked?.dt === "string"
      ? args.serder.ked.dt
      : new Date().toISOString();
    if (!cid || !oobi) {
      throw new ValidationError("Missing cid/oobi in /introduce reply.");
    }

    const parsed = new URL(oobi);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError(
        `Invalid introduced OOBI scheme ${parsed.protocol}.`,
      );
    }

    const accepted = this.reactor.revery.acceptReply({
      serder: args.serder,
      saider: args.diger,
      route: args.route,
      aid: cid,
      osaider: null,
      cigars: args.cigars,
      tsgs: args.tsgs,
    });
    if (!accepted) {
      throw new UnverifiedReplyError(
        `Unverified introduction reply ${args.serder.said ?? "<unknown>"}.`,
      );
    }

    const meta = parseOobiUrl(oobi);
    this.pinQueueStore(queueKindFor(oobi), oobi, {
      date: dt,
      state: "queued",
      cid: cid ?? meta.cid ?? null,
      eid: meta.eid ?? null,
      role: meta.role ?? null,
      oobialias: meta.alias ?? null,
      said: meta.said ?? null,
    });
    this.cues.push({ kin: "oobiQueued", url: oobi });
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
export function parseOobiUrl(url: string, alias?: string): OobiJob {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
  const job: OobiJob = {
    url,
    alias: alias ?? parsed.searchParams.get("name") ?? undefined,
  };

  const wellKnownIndex = findPathSequence(parts, [".well-known", "keri", "oobi"]);
  if (wellKnownIndex >= 0 && wellKnownIndex + 3 < parts.length) {
    job.cid = parts[wellKnownIndex + 3];
    job.role = Roles.controller;
    return job;
  }

  const oobiIndex = parts.lastIndexOf("oobi");
  if (oobiIndex >= 0 && oobiIndex + 2 < parts.length) {
    job.cid = parts[oobiIndex + 1];
    job.role = parts[oobiIndex + 2];
    job.eid = parts[oobiIndex + 3];
  }

  return job;
}

/** Return true when one OOBI URL uses the well-known discovery path. */
export function isWellKnownOobiUrl(url: string): boolean {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
  return findPathSequence(parts, [".well-known", "keri", "oobi"]) >= 0;
}

function findPathSequence(parts: string[], sequence: string[]): number {
  if (sequence.length === 0 || parts.length < sequence.length) {
    return -1;
  }

  outer:
  for (let index = 0; index <= parts.length - sequence.length; index += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (parts[index + offset] !== sequence[offset]) {
        continue outer;
      }
    }
    return index;
  }

  return -1;
}

function queueKindFor(url: string): OobiQueueKind {
  return isWellKnownOobiUrl(url) ? "woobi" : "oobis";
}

/**
 * Fetch one OOBI URL under Effection cancellation control.
 *
 * This is the real promise-adaptation boundary for remote OOBI retrieval. The
 * surrounding runtime stays operation-native.
 */
function* fetchOobiResponse(url: string): Operation<Response> {
  const { response } = yield* fetchResponseHandle(url);
  return response;
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
