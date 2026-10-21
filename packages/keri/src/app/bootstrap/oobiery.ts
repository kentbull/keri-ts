import { type Cigar, Diger, Ilks, Prefixer, SerderKERI } from "cesr-ts";
import { call, type Operation, resource, scoped } from "npm:effection@^3.6.0";
import type { AgentCue, OobiResolvedCue } from "../../core/cues.ts";
import { Deck } from "../../core/deck.ts";
import { type TransIdxSigGroup } from "../../core/dispatch.ts";
import { ValidationError } from "../../core/errors.ts";
import { exchange } from "../../core/exchange/protocol-exchanging.ts";
import type { Kevery } from "../../core/kel/eventing.ts";
import { OOBI_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
import type { OobiRecord, OobiRecordShape } from "../../core/records.ts";
import { type Role, Roles } from "../../core/roles.ts";
import type { Revery } from "../../core/routing.ts";
import { acceptReplyDecision, type ReplyProcessDecision, unverifiedReplyDecision } from "../../core/routing.ts";
import { Schemer } from "../../core/scheming.ts";
import type { Baser } from "../../db/basing.ts";
import type { Exchanger, ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { persistResolvedContact } from "../identity/organizing.ts";
import type { Notifier } from "../notifications/notifying.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { abortable } from "../runtime/abortable.ts";
import { runtimeTurn } from "../runtime/runtime-turn.ts";
import { collectBytes } from "../transport/byte-source.ts";
import type { HttpStreamResponse } from "../transport/http-client.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { processMessages } from "../transport/message-source.ts";

export const OOBI_REQUEST_ROUTE = "/oobis";

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

/**
 * Projection of one requested URL's durable terminal OOBI/authentication row.
 */
export interface OobiTerminalState {
  /**
   * Pending until a terminal row exists; resolved/failed reflects that row.
   */
  status: "pending" | "resolved" | "failed";
  /**
   * Database family supplying the terminal row, or none.
   */
  via: "none" | "roobi" | "eoobi" | "rmfa";
  /**
   * Borrowed terminal row, or null while pending.
   */
  record: OobiRecord | null;
}

/**
 * Return the current terminal state projection for one requested OOBI URL.
 *
 * @param db Borrowed OOBI/authentication records; this read starts no workers or I/O.
 * @param url Exact requested OOBI/well-known URL whose durable state is inspected.
 * @param kind Actual queued family; ordinary CLI resolution infers it from the URL.
 * Configuration may put the same well-known URL in introduction and auth queues.
 * @returns Current durable terminal projection for that family.
 */
export function oobiTerminalState(
  db: Baser,
  url: string,
  kind: OobiQueueKind = queueKindFor(url),
): OobiTerminalState {
  if (kind === "woobi") {
    if (db.woobi.get(url) || db.mfa.get(url)) return { status: "pending", via: "none", record: null };
    const record = db.rmfa.get(url);
    if (!record) {
      return { status: "pending", via: "none", record: null };
    }
    return {
      status: record.state === "resolved" ? "resolved" : "failed",
      via: "rmfa",
      record,
    };
  }

  if (db.oobis.get(url) || db.coobi.get(url) || db.moobi.get(url)) {
    return { status: "pending", via: "none", record: null };
  }
  const failed = db.eoobi.get(url);
  if (failed) {
    return { status: "failed", via: "eoobi", record: failed };
  }

  const resolved = db.roobi.get(url);
  if (resolved) {
    return { status: "resolved", via: "roobi", record: resolved };
  }

  return { status: "pending", via: "none", record: null };
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
  /** Borrowed local identities and durable OOBI job stores. */
  readonly hby: Habery;
  /** Input-specific KEL policy sharing accepted state and the composed reply verifier. */
  readonly kvy: Kevery;
  /** OOBI completion/query observations consumed by the composed application flow. */
  readonly cues: Deck<AgentCue>;
  /** Borrowed HTTP client; no network service is discovered through ingress. */
  readonly http: HttpClient;
  /** Prevent overlapping passes over this owner's durable job queue. */
  private active = false;

  /**
   * Bind byte intake and the actual reply verifier used by OOBI proof persistence.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param protocol Borrowed shared semantic owner; this component owns its fetched byte-input context.
   * @param rvy Actual shared reply verifier used for OOBI reply proof persistence.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param cues Required application result Deck supplied by composition.
   */
  constructor(
    hby: Habery,
    private readonly protocol: ProtocolProcessor,
    /** Borrowed reply verifier; route installation and proof writes share this owner. */
    private readonly rvy: Revery,
    http: HttpClient,
    cues: Deck<AgentCue>,
  ) {
    this.hby = hby;
    this.kvy = protocol.makeKevery();
    if (this.kvy.db !== hby.db || this.kvy.rvy !== rvy) {
      throw new TypeError("Oobiery requires the same accepted-state store and reply verifier");
    }
    this.cues = cues;
    this.http = http;
  }

  /**
   * Register `/introduce` on the shared reply router.
   *
   * @param router Shared reply router on which /introduce is registered.
   */
  registerReplyRoutes(router = this.rvy.rtr): void {
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
    const kind = queueKindFor(url), record = this.queuedRecord(meta);
    const cues: AgentCue[] = [{ kin: "oobiQueued", url, alias: meta.alias }];

    this.pinQueueStore(kind, url, record);
    this.cues.extend(cues);
  }

  /**
   * Process one queued durable OOBI record, if any.
   *
   * Behavior:
   * - reads the next queued `oobis.` record or resumes a surviving `coobi.` row
   * - fetches it under Effection cancellation control
   * - parses fetched KERI bytes through this owner's Kevery and shared semantic handlers
   * - transitions the durable record into `eoobi.` or `roobi.`
   */
  *processOnce(): Operation<void> {
    if (this.active) return;
    const item = this.nextQueued();
    if (item) {
      const [kind, url, record] = item;
      yield* this.processQueued(kind, url, record);
      return;
    }

    const multi = this.nextReadyMoobi();
    if (multi) {
      const [url, record] = multi;
      this.completeMultiOobi(url, record);
    }
  }

  /** Hold job ownership before work so cancellation joins every response/parser owner before retry. */
  private processQueued(kind: OobiQueueKind, url: string, record: OobiRecord): Operation<void> {
    // deno-lint-ignore no-this-alias -- The callback borrows this OOBI worker's durable queue.
    const self = this;
    return call(function*() {
      const started = yield* resource<boolean>(function*(provide) {
        if (self.active) {
          yield* provide(false);
          return;
        }
        self.active = true;
        try {
          yield* provide(true);
        } finally {
          self.active = false;
        }
      });
      if (!started) return;
      // Each finite child joins its body, fetch and parser before the earlier job owner ends.
      yield* call(() => self.processJob(kind, url, record));
    });
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

  /** Select queued work, including a surviving in-flight row whose former process is gone. */
  private nextQueued(): [OobiQueueKind, string, OobiRecord] | null {
    for (const store of [this.hby.db.oobis, this.hby.db.coobi]) {
      for (const [keys, record] of store.getTopItemIter()) {
        const url = keys[0];
        if (url) return ["oobis", url, record];
      }
    }
    return null;
  }

  /** Select a parent only after its current child attempts, including authentication, settle. */
  private nextReadyMoobi(): [string, OobiRecord] | null {
    for (const [keys, record] of this.hby.db.moobi.getTopItemIter()) {
      const url = keys[0];
      if (!url) continue;
      if ((record.urls ?? []).every(child => oobiTerminalState(this.hby.db, child).status !== "pending")) {
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
   *
   * @param kind Durable OOBI queue family identifying the job path.
   * @param url Exact OOBI URL used as the durable job key.
   * @param record Pending durable job; retained through failure and joined cleanup.
   */
  private *processJob(
    kind: OobiQueueKind,
    url: string,
    record: OobiRecord,
  ): Operation<void> {
    const http = this.http;
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
    // A new or resumed attempt supersedes old terminal facts, but keeps its
    // queued row until intake succeeds. Cancellation can therefore retry it.
    this.hby.db.env!.transactionSync(() => {
      this.pinQueueStore(kind, url, queuedRecord);
      this.hby.db.eoobi.rem(url);
      this.hby.db.roobi.rem(url);
    });
    const consume = this.processResponse.bind(this);
    try {
      const refused = yield* scoped(function*() {
        const response = yield* http.open(url);
        if (!response.ok) return response.status;
        yield* consume(kind, url, queuedRecord, meta, response);
        return null;
      });
      if (refused === null) this.remQueueStore(kind, url);
      else {
        // The response has closed before its terminal HTTP outcome is persisted.
        const result = { ...queuedRecord, date: new Date().toISOString(), state: `http-${refused}` };
        this.remQueueStore(kind, url);
        this.hby.db.eoobi.pin(url, result);
        this.cues.push({ kin: "oobiFailed", url, reason: `HTTP ${refused}` });
      }
    } finally {
      this.hby.db.coobi.rem(url);
    }
  }

  /**
   * Consume one owned response; queued ownership ends only after a terminal result is persisted.
   *
   * @param kind Durable OOBI queue family identifying the job path.
   * @param url Exact OOBI URL used as the durable job key.
   * @param queuedRecord Original durable job metadata retained until terminal publication.
   * @param meta Parsed OOBI URL metadata selecting the response interpretation.
   * @param response Borrowed scoped HTTP response; complete processing precedes terminal state.
   */
  private *processResponse(
    kind: OobiQueueKind,
    url: string,
    queuedRecord: OobiRecordShape,
    meta: { cid?: string | null; role?: string | null; eid?: string | null },
    response: HttpStreamResponse,
  ): Operation<void> {
    const type = mediaType(response.headers.get("content-type") ?? "");
    if (isCesrMediaType(type) || !type.includes("json")) {
      // Keep durable retry ownership throughout partial acceptance and joined cancellation.
      yield* this.resolveCesrOobiResponse(kind, url, queuedRecord, meta, response);
      return;
    }
    const bytes = yield* readResponseBytes(response);
    this.hby.db.coobi.pin(url, {
      ...queuedRecord,
      date: new Date().toISOString(),
      state: "fetched",
    });

    if (type === "application/schema+json") {
      if (this.processSchemaOobiResponse(url, queuedRecord, bytes)) {
        return;
      }
      this.failFetchedOobi(url, queuedRecord, "invalid-schema-oobi");
      return;
    }

    if (type.includes("json")) {
      if (this.processSchemaOobiResponse(url, queuedRecord, bytes)) {
        return;
      }
      if (this.processJsonOobiResponse(url, queuedRecord, bytes)) {
        return;
      }
      this.failFetchedOobi(url, queuedRecord, "invalid-json-oobi");
      return;
    }
  }

  /**
   * Mark an OOBI resolved only after its complete CESR response has been dispatched.
   *
   * @param kind Durable OOBI queue family identifying the job path.
   * @param url Exact OOBI URL used as the durable job key.
   * @param queuedRecord Original durable job metadata retained until terminal publication.
   * @param meta Parsed OOBI URL metadata selecting the response interpretation.
   * @param response Borrowed scoped HTTP response; complete processing precedes terminal state.
   */
  private *resolveCesrOobiResponse(
    kind: OobiQueueKind,
    url: string,
    queuedRecord: OobiRecordShape,
    meta: { cid?: string | null; role?: string | null; eid?: string | null },
    response: HttpStreamResponse,
  ): Operation<void> {
    const cue: OobiResolvedCue = {
      kin: "oobiResolved",
      url,
      cid: meta.cid ?? undefined,
      role: meta.role ?? undefined,
      eid: meta.eid ?? undefined,
    };
    this.pinQueueStore(kind, url, queuedRecord);
    this.hby.db.coobi.pin(url, { ...queuedRecord, state: "streaming" });
    yield* processMessages((signal) => response.body(signal), this.protocol, this.kvy);

    this.hby.db.coobi.rem(url);
    this.hby.db.roobi.pin(url, { ...queuedRecord, date: new Date().toISOString(), state: "resolved" });
    persistResolvedContact(this.hby, meta.cid, { alias: queuedRecord.oobialias, oobi: url });
    this.cues.push(cue);
  }

  /** Handle schema data-OOBIs before generic JSON reply handling. */
  private processSchemaOobiResponse(
    url: string,
    record: OobiRecordShape,
    bytes: Uint8Array,
  ): boolean {
    if (!record.said) {
      return false;
    }

    let schemer: Schemer;
    try {
      schemer = new Schemer({ raw: bytes });
    } catch {
      return false;
    }
    if (schemer.said !== record.said) {
      return false;
    }

    const result = { ...record, date: new Date().toISOString(), state: "resolved" };
    const cues: AgentCue[] = [{ kin: "oobiResolved", url }];

    this.hby.db.schema.pin(schemer.said, schemer);
    this.hby.db.coobi.rem(url);
    this.hby.db.roobi.pin(url, result);
    this.cues.extend(cues);

    return true;
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
    const cid = typeof data?.aid === "string" ? new Prefixer({ qb64: data.aid }).qb64 : null;
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

    // Normalize every child before the first queue write; malformed later URLs cannot leave partial fanout.
    const children = urls.map((childUrl) => {
      const meta = parseOobiUrl(childUrl, record.oobialias ?? undefined);
      return { url: childUrl, kind: queueKindFor(childUrl), meta, record: this.queuedRecord(meta) };
    });
    const cues: AgentCue[] = children.map(({ url, meta }) => ({ kin: "oobiQueued", url, alias: meta.alias }));
    const parent = { ...record, cid, date: new Date().toISOString(), state: "pending-multi-oobi", urls };

    for (const child of children) this.pinQueueStore(child.kind, child.url, child.record);
    this.hby.db.coobi.rem(url);
    this.hby.db.moobi.pin(url, parent);
    this.cues.extend(cues);
  }

  /** Finalize one parent multi-OOBI after its child URLs all reach terminal state. */
  private completeMultiOobi(url: string, record: OobiRecord): void {
    const urls = record.urls ?? [];
    const date = new Date().toISOString();
    const failed = urls.length === 0
      || urls.some(childUrl => oobiTerminalState(this.hby.db, childUrl).status === "failed");

    const state = failed ? (urls.length === 0 ? "invalid-multi-oobi" : "child-failed") : "resolved";
    const result = { ...record, date, state };
    const cues: AgentCue[] = failed
      ? [{
        kin: "oobiFailed",
        url,
        reason: urls.length === 0 ? "invalid multi-oobi" : "child failed",
      }]
      : [{
        kin: "oobiResolved",
        url,
        cid: record.cid ?? undefined,
        role: record.role ?? undefined,
        eid: record.eid ?? undefined,
      }];

    this.hby.db.moobi.rem(url);
    if (failed) this.hby.db.eoobi.pin(url, result);
    else {
      this.hby.db.roobi.pin(url, result);
      persistResolvedContact(this.hby, record.cid ?? null, { alias: record.oobialias, oobi: url });
    }
    this.cues.extend(cues);
  }

  /** Mark one fetched OOBI as terminal failure and clear its in-flight state. */
  private failFetchedOobi(
    url: string,
    record: OobiRecordShape,
    state: string,
  ): void {
    const result = { ...record, date: new Date().toISOString(), state };
    const cues: AgentCue[] = [{ kin: "oobiFailed", url, reason: state }];

    this.hby.db.coobi.rem(url);
    this.hby.db.eoobi.pin(url, result);
    this.cues.extend(cues);
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

  /** Stage one normalized queue record without durable effects. */
  private queuedRecord(meta: OobiJob): OobiRecordShape {
    return {
      date: new Date().toISOString(),
      state: "queued",
      cid: meta.cid ?? null,
      eid: meta.eid ?? null,
      role: meta.role ?? null,
      oobialias: meta.alias ?? null,
      said: meta.said ?? null,
    };
  }

  /**
   * Process one `/introduce` reply and enqueue the introduced OOBI into the
   * ordinary durable resolver path.
   *
   * @param args Verified reply route input and signature evidence used to persist introduction results.
   */
  processReply(args: {
    serder: SerderKERI;
    diger: Diger;
    route: string;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): ReplyProcessDecision {
    if (args.route !== "/introduce") {
      throw new ValidationError(
        `Unsupported route=${args.route} in ${Ilks.rpy} reply.`,
      );
    }

    const data = args.serder.ked?.a as Record<string, unknown> | undefined;
    const cid = typeof data?.cid === "string" ? new Prefixer({ qb64: data.cid }).qb64 : null;
    const oobi = typeof data?.oobi === "string" ? data.oobi : null;
    const dt = typeof args.serder.ked?.dt === "string" ? args.serder.ked.dt : new Date().toISOString();
    if (!cid || !oobi) {
      throw new ValidationError("Missing cid/oobi in /introduce reply.");
    }

    const parsed = new URL(oobi);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError(
        `Invalid introduced OOBI scheme ${parsed.protocol}.`,
      );
    }

    const proof = this.rvy.decideReply({
      serder: args.serder,
      saider: args.diger,
      route: args.route,
      aid: cid,
      osaider: null,
      cigars: args.cigars,
      tsgs: args.tsgs,
    });
    const queryCues = this.rvy.cues;

    if (proof.kind === "unverified") {
      this.rvy.writeReply(proof);
      if (proof.cues.length) queryCues.extend(proof.cues);
      return unverifiedReplyDecision(`Unverified introduction reply ${args.serder.said ?? "<unknown>"}.`);
    }
    const meta = parseOobiUrl(oobi), kind = queueKindFor(oobi);
    const record = {
      date: dt,
      state: "queued",
      cid: cid ?? meta.cid ?? null,
      eid: meta.eid ?? null,
      role: meta.role ?? null,
      oobialias: meta.alias ?? null,
      said: meta.said ?? null,
    };
    const cues: AgentCue[] = [{ kin: "oobiQueued", url: oobi }];

    this.rvy.writeReply(proof);
    this.pinQueueStore(kind, oobi, record);
    if (proof.cues.length) queryCues.extend(proof.cues);
    this.cues.extend(cues);
    return acceptReplyDecision();
  }
}

export function loadOobiHandlers(
  hby: Habery,
  exchanger: Exchanger,
  notifier: Notifier | null = null,
): void {
  exchanger.addHandler(new OobiRequestHandler(hby, notifier));
}

/**
 * Peer-to-peer OOBI request handler for `/oobis` exchange messages.
 *
 * KERIpy correspondence:
 * - this is the local analogue of `keri.app.oobiing.OobiRequestHandler`
 * - the Python handler does two things only: accept an EXN carrying an OOBI
 *   URL, and convert that request into local controller-visible state
 * - specifically, it pins an `oobis.` record so the resolver can fetch it
 *   later, and it emits a notifier entry so operator-facing surfaces can show
 *   that someone asked us to resolve or inspect an OOBI
 *
 * Local `keri-ts` adaptation:
 * - verification stays lightweight and route-local: we only require a string
 *   `oobi` payload with an `http:` or `https:` scheme
 * - durable follow-on work still belongs to `Oobiery` itself; this handler is
 *   just the exchange ingress seam that translates an EXN into queued resolver
 *   state
 * - unlike KERIpy's DoDoer-centric runtime, the queued record is later
 *   advanced by the shared `AgentRuntime` turn that owns OOBI processing
 */
export class OobiRequestHandler implements ExchangeRouteHandler {
  static readonly resource = OOBI_REQUEST_ROUTE;
  readonly resource = OobiRequestHandler.resource;
  readonly hby: Habery;
  readonly notifier: Notifier | null;

  constructor(
    hby: Habery,
    notifier: Notifier | null = null,
  ) {
    this.hby = hby;
    this.notifier = notifier;
  }

  verify(args: {
    serder: SerderKERI;
  }): boolean {
    const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
    if (typeof payload?.["oobi"] !== "string") {
      return false;
    }
    try {
      const parsed = new URL(payload.oobi);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  handle(args: {
    serder: SerderKERI;
  }): void {
    const src = args.serder.pre;
    const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
    const oobi = typeof payload?.["oobi"] === "string" ? payload.oobi : null;
    if (!src || !oobi) {
      return;
    }

    const alias = new URL(oobi).searchParams.get("name");
    this.hby.db.oobis.pin(oobi, {
      date: new Date().toISOString(),
      state: "queued",
      oobialias: alias,
    });

    if (!this.notifier) {
      return;
    }

    const attrs: Record<string, unknown> = {
      r: "/oobi",
      src,
      oobi,
    };
    if (alias) {
      attrs["oobialias"] = alias;
    }
    this.notifier.add(attrs);
  }
}

export function oobiRequestExn(
  hab: Hab,
  dest: string,
  oobi: string,
): SerderKERI {
  return exchange(
    OOBI_REQUEST_ROUTE,
    { dest, oobi },
    {
      sender: hab.pre,
    },
  )[0];
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

  const wellKnownIndex = findPathSequence(parts, [
    ".well-known",
    "keri",
    "oobi",
  ]);
  if (wellKnownIndex >= 0 && wellKnownIndex + 3 < parts.length) {
    job.cid = parts[wellKnownIndex + 3];
    job.role = Roles.controller;
    return job;
  }

  const oobiIndex = parts.lastIndexOf("oobi");
  if (oobiIndex >= 0 && oobiIndex + 1 < parts.length) {
    if (oobiIndex + 2 === parts.length) {
      job.said = parts[oobiIndex + 1];
      return job;
    }
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

function mediaType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isCesrMediaType(type: string): boolean {
  return type === "application/cesr" || type === "application/cesr+json" || type.endsWith("+cesr");
}

export { OOBI_MAILBOX_TOPIC };

/**
 * Collect one finite OOBI document and join its reader on cancellation.
 *
 * @param response Borrowed finite OOBI document response.
 * @returns Collected bytes after reader cleanup joins.
 */
function* readResponseBytes(response: HttpStreamResponse): Operation<Uint8Array> {
  return yield* abortable((signal) => collectBytes(response.body(signal)));
}
