/** Configured-source freshness over ordinary native acceptance; queries never acquire evidence. */
import { type ProtocolHandler, type SourceConfig, sourceRequest, SourceTrust } from "@keri-ts/hosting";
import { Registrar } from "@keri-ts/registrar";
import { concatBytes, Counter, parseBytes, ParserError, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, sleep } from "effection";
import type { RegistryStore } from "keri-ts/db";
import {
  CESR_CONTENT_TYPE,
  envelopeFromFrame,
  type Hab,
  isCesrContentType,
  Kramer,
  type ProtocolProcessor,
  query,
  readCesrRequestBytes,
  TransportError,
  ValidationError,
} from "keri-ts/runtime";
import { ObservationBaser } from "./storing.ts";

/** Only source authority, local age and reader policy belong to the application. */
export interface ObserverOptions {
  sources: readonly SourceConfig[];
  readers: readonly string[];
  maximumAgeMs?: number;
  now?: () => number;
}
/** Finite positive deployment durations, not protocol constants or automatic lifetime caps. */
function duration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError("Observer duration must be finite and positive.");
  }
  return value;
}
/** Signed query attributes must be an object before their named fields are read. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Cache-only HTTP refusal contains no observation credit. */
function unavailable(message: string, status = 503): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain" } });
}

/**
 * Own URL observations and fixed acquisition scheduling, borrowing protocol and storage owners.
 * Source record shape/scope follows kf-observer feec9004; it declares KERIpy 7ea525ba.
 * Current selected KERIpy c4 is a later qualification input, not an implicit service repin.
 */
export class Observer {
  readonly sources: readonly SourceTrust[];
  private readonly readers: ReadonlySet<string>;
  private readonly maximumAgeMs: number;
  private readonly now: () => number;
  private readonly evidence: Registrar;

  constructor(
    readonly processor: ProtocolProcessor,
    readonly store: RegistryStore,
    readonly observations: ObservationBaser,
    options: ObserverOptions,
  ) {
    if (!options.sources.length || !options.readers.length) {
      throw new ValidationError("Observer needs configured sources and readers.");
    }
    this.sources = options.sources.map(source => new SourceTrust(source));
    if (new Set(this.sources.map(source => source.url)).size !== this.sources.length) {
      throw new ValidationError("Duplicate observer source URL.");
    }
    this.readers = new Set(options.readers);
    this.maximumAgeMs = duration(options.maximumAgeMs ?? 15000);
    this.now = options.now ?? Date.now;
    this.evidence = new Registrar(processor, store);
  }

  /** Ignore unresolved sightings only when their exact ordinal already has an accepted event. */
  pendingInScope(registries: Iterable<string>): boolean {
    const scope = new Set(registries);
    for (const table of [this.store.baser.maes, this.store.baser.ooes]) {
      for (const [keys, sn] of table.getTopItemIter()) {
        if (scope.has(keys[0]) && !this.store.seqSaider(keys[0], sn)) return true;
      }
    }
    return false;
  }

  /** Record only a completed authenticated response with its returned/prior source scope intact. */
  private async observe(source: SourceTrust, raw: Uint8Array): Promise<boolean> {
    // The selected source profile, like Python Parser(version=2), fixes attachment genus independently of legacy bodies.
    const result = await this.evidence.ingest(concatBytes(Counter.makeGVC(Vrsn_2_0), raw));
    const previous = this.observations.observations.get([source.url]);
    const heads = result.heads,
      prior = Object.keys(previous?.heads ?? {}),
      scope = new Set([...Object.keys(heads), ...prior]);
    if (
      !Object.keys(result.rejected).length && !Object.keys(result.pending).length && !this.pendingInScope(scope)
      && prior.every(regid => Object.hasOwn(heads, regid))
      && Object.entries(heads).every(([regid, said]) => this.store.head(regid)?.qb64 === said)
    ) {
      this.observations.observations.pin([source.url], { completed: new Date(this.now()).toISOString(), heads });
      return true;
    }
    return false;
  }

  /** Pull each fixed URL in sequence; only HTTPS success can reach observation publication. */
  *pullOnce(hab: Hab, { timeoutMs = 5000 }: { timeoutMs?: number } = {}): Operation<number> {
    duration(timeoutMs);
    if (hab.db !== this.processor.kvy.db) {
      throw new ValidationError("Observer requires its actual local signing habitat.");
    }
    let completed = 0;
    for (const source of this.sources) {
      const body = hab.endorse(query("tels/bulk", {}, { pre: hab.pre, version: Vrsn_2_0 }), { gvrsn: Vrsn_2_0 });
      try {
        const response = yield* sourceRequest(source, body, timeoutMs);
        if (response.status !== 200 || !isCesrContentType(response.headers.get("content-type"))) continue;
        if (yield* call(() => this.observe(source, response.body))) completed++;
      } catch (error) {
        if (!(error instanceof TransportError)) throw error;
        // A failed source cannot renew its record or stop independently configured peers.
      }
    }
    return completed;
  }

  /** Fixed scheduled acquisition independent of incoming reader activity; scope cancellation joins I/O. */
  *run(
    hab: Hab,
    { intervalMs = 5000, timeoutMs = 5000 }: { intervalMs?: number; timeoutMs?: number } = {},
  ): Operation<void> {
    duration(intervalMs);
    duration(timeoutMs);
    while (true) {
      const started = performance.now();
      yield* this.pullOnce(hab, { timeoutMs });
      yield* sleep(Math.max(0, intervalMs - (performance.now() - started)));
    }
  }

  /** Authenticate a reader and serve only an exact, sufficiently recent observation of this cache head. */
  readonly handle: ProtocolHandler = async req => {
    const path = new URL(req.url).pathname;
    if (path === "/health" && req.method === "GET") return Response.json({ status: "ok" });
    if (path !== "/" || req.method !== "POST") return unavailable("Not Found", 404);
    if (!isCesrContentType(req.headers.get("content-type"))) {
      await req.body?.cancel();
      return unavailable("Unacceptable content type", 415);
    }
    let frames;
    try {
      frames = parseBytes(await readCesrRequestBytes(req));
    } catch (error) {
      if (!(error instanceof ParserError)) throw error;
      return unavailable("Expected one signed query", 400);
    }
    const frame = frames[0], body = frame?.body;
    if (
      frames.length !== 1 || !(body instanceof SerderKERI) || body.ilk !== "qry"
      || body.pvrsn.major !== 2 || body.pvrsn.minor !== 0
    ) return unavailable("Expected one KERI v2 signed query", 400);
    if (!body.pre || !this.readers.has(body.pre) || !["tels", "tels/head"].includes(body.route ?? "")) {
      return unavailable("Reader or route is not authorized", 403);
    }
    const kramer = this.processor.kvy.kramer;
    if (!(kramer instanceof Kramer)) return unavailable("Request authentication unavailable");
    const authenticated = kramer.intake(envelopeFromFrame(frame));
    if (authenticated.kind !== "ready") return unavailable("KRAM refused query", 401);
    if (!authenticated.receiverTime) return unavailable("Enabled non-exempt request authentication required");
    const q = authenticated.envelope.serder.sad?.q;
    if (
      !record(q) || typeof q.i !== "string" || !q.i || Object.hasOwn(q, "vcid")
    ) return unavailable("q.i must identify one registry", 400);
    const regid = q.i, sn = q.sn ?? 0;
    if (!Number.isSafeInteger(sn) || Number(sn) < 0) return unavailable("sn must be a nonnegative integer", 400);
    if (this.pendingInScope([regid])) return unavailable("Registry dependencies are pending");
    const head = this.store.head(regid);
    if (!head) return unavailable("Unknown registry in local cache", 404);
    const completed = this.sources.map(source => this.observations.observations.get([source.url]))
      .filter(record => record?.heads[regid] === head.qb64).map(record => record!.completed).sort().at(-1);
    if (!completed) return unavailable("No completed source observation for accepted head");
    const age = this.now() - Date.parse(completed);
    if (!Number.isFinite(age) || age < 0 || age > this.maximumAgeMs) return unavailable("Cached observation is stale");
    const rip = this.store.seqEvent(regid, 0)!, issuer = this.processor.kvy.db.getKever(rip.issuer!);
    if (!issuer) return unavailable("Supporting controller evidence unavailable");
    const evidence = concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      ...this.processor.kvy.db.cloneDelegation(issuer, Vrsn_2_0),
      ...this.processor.kvy.db.clonePreIter(rip.issuer!, 0, Vrsn_2_0),
      this.store.cloneTel(regid, Number(sn)),
    );
    return new Response(new Uint8Array(evidence).buffer, {
      headers: {
        "Content-Type": CESR_CONTENT_TYPE,
        "Observer-Observed-At": completed,
        "Observer-Evidence-State": "fresh",
        "Observer-Registry-Head": head.qb64,
      },
    });
  };
}
