/** KF watcher backend: independent allocations, authenticated introductions and actual witness observations. */
import { createProtocolHandler, type ProtocolHandler, startServer } from "@keri-ts/hosting";
import { parseBytes, ParserError, Prefixer, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, race, run, type Scope, sleep, spawn, suspend, type Task, useScope } from "effection";
import { createHabery } from "keri-ts/db/lmdb";
import {
  type AgentRuntime,
  CESR_DESTINATION_HEADER,
  consoleLogger,
  createAgentRuntime,
  EndpointRoles,
  envelopeFromFrame,
  FetchHttpClient,
  type Hab,
  type Habery,
  queryEnvelopeFromDispatch,
  readRequiredCesrRequestBytes,
  reply,
  runAgentRuntime,
  SeqNoQuerier,
  settleRuntimeIngress,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import { join } from "node:path";
import {
  HostedWatcherBaser,
  type ObservedState,
  WatcherAllocationRecord,
  WitnessObservationRecord,
} from "./hosted-watcher-store.ts";

/** Concrete public and private listeners; the caller explicitly selects observation cadence. */
export interface HostedWatcherOptions {
  name: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  publicUrl: string;
  httpPort: number;
  httpHost: string;
  bootPort: number;
  pollIntervalMs?: number;
}
/** Expected HTTP refusals stay distinct from failed storage or runtime invariants. */
class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
/** Map only malformed client input; unexpected failures retain their actual owner. */
function refusal(error: unknown): Response {
  if (error instanceof RequestError) return new Response(error.message, { status: error.status });
  if (error instanceof ParserError || error instanceof SyntaxError || error instanceof ValidationError) {
    return new Response("Invalid KERI request", { status: 400 });
  }
  throw error;
}
/** One allocated watcher owns its controller policy and joins requests before closing its stores. */
class HostedWatcher {
  private readonly stopping = new AbortController();
  private readonly requests = new Set<Promise<Response>>();
  private readonly publicHandler: ProtocolHandler;
  constructor(
    readonly record: WatcherAllocationRecord,
    readonly hby: Habery,
    readonly hab: Hab,
    readonly runtime: AgentRuntime,
    private readonly db: HostedWatcherBaser,
    private readonly publicUrl: string,
    private readonly pollIntervalMs: number,
  ) {
    this.publicHandler = createProtocolHandler(runtime, { serviceHab: hab, hostedPrefixes: [hab.pre] });
  }
  /** Exact Foundation allocation coordinates. */
  coordinates(): { cid: string; eid: string; oobis: string[] } {
    return { cid: this.record.cid, eid: this.record.eid, oobis: [this.publicUrl + `/oobi/${this.hab.pre}/controller`] };
  }
  /** Track the concrete request until its input work has joined. */
  handle(req: Request): Promise<Response> {
    if (this.stopping.signal.aborted) return Promise.resolve(new Response("Watcher retired", { status: 410 }));
    const request = new Request(req, { signal: AbortSignal.any([req.signal, this.stopping.signal]) });
    const pending = this.respond(request).catch(refusal);
    this.requests.add(pending);
    void pending.then(() => this.requests.delete(pending), () => this.requests.delete(pending));
    return pending;
  }
  /** Public introductions use ordinary verification; controller queries capture their own authenticated response. */
  private async respond(req: Request): Promise<Response> {
    if (req.method !== "POST" && req.method !== "PUT") return await this.publicHandler(req);
    if (new URL(req.url).pathname !== "/") throw new RequestError(404, "Unknown watcher route");
    const bytes = await readRequiredCesrRequestBytes(req);
    if (!bytes) throw new RequestError(406, "CESR content type required");
    const frames = parseBytes(bytes);
    for (const frame of frames) {
      const event = frame.body;
      if (!(event instanceof SerderKERI)) throw new RequestError(422, "KERI evidence required");
      if (event.ilk === "qry") {
        const envelope = queryEnvelopeFromDispatch(envelopeFromFrame(frame));
        const sender = envelope.source?.qb64 ?? envelope.cigars?.[0]?.verfer?.qb64;
        if (sender !== this.record.cid || !["ksn", "logs"].includes(event.route!)) {
          throw new RequestError(403, "Only the allocated controller may query this watcher");
        }
        const query = event.sad!.q as Record<string, unknown>;
        if (query.src !== this.hab.pre) throw new RequestError(403, "Query selects another watcher");
      } else if (event.ilk === "rpy" && event.route?.startsWith("/watcher/")) {
        const data = event.sad!.a as Record<string, unknown>;
        if (
          data.cid !== this.record.cid
          || !["add", "cut"].some(action => event.route === `/watcher/${this.hab.pre}/${action}`)
        ) {
          throw new RequestError(403, "Observed-AID approval belongs to the allocated controller");
        }
      } else if (!["icp", "rot", "ixn", "dip", "drt", "rct", "rpy"].includes(event.ilk!)) {
        throw new RequestError(422, "Unsupported watcher message");
      }
    }
    const runtime = this.runtime, hab = this.hab;
    const task = run(function*() {
      let response: Response | undefined;
      for (const frame of frames) {
        const slot = frame.body.ilk === "qry" ? runtime.protocol.replies.reserve(frame.body.said!) : undefined;
        try {
          const result = yield* runtime.protocol.dispatch(frame, { local: false, escrows: true });
          if (frame.body.ilk === "qry") {
            if (result.decision?.kind !== "accept") {
              throw new RequestError(403, "Query did not authenticate or resolve");
            }
            const cues = slot!.takeAll()?.cues ?? [];
            for (const cue of cues) {
              if (cue.kin === "replay") {
                response = new Response(runtime.replyStreams.open(cue.msgs), {
                  headers: { "Content-Type": "application/cesr" },
                });
              } else if (cue.kin === "reply" && cue.serder) {
                // watcher-hk normalizes KSN query replies to v2 with the actual watcher signer.
                const body = reply(`/ksn/${hab.pre}`, cue.serder.sad!.a as Record<string, unknown>, {
                  pre: hab.pre,
                  pvrsn: Vrsn_2_0,
                  gvrsn: Vrsn_2_0,
                });
                response = new Response(new Uint8Array(hab.endorse(body, { gvrsn: Vrsn_2_0 })), {
                  headers: { "Content-Type": "application/cesr" },
                });
              }
            }
          }
        } finally {
          slot?.close();
        }
      }
      return response ?? new Response(null, { status: 204 });
    });
    const stop = () => {
      void task.halt().catch(() => {});
    };
    req.signal.addEventListener("abort", stop, { once: true });
    if (req.signal.aborted) stop();
    try {
      return await task;
    } finally {
      req.signal.removeEventListener("abort", stop);
      await task.halt();
    }
  }
  /** Poll only this controller and its accepted enabled observations; never make intake wait for polling. */
  *poll(): Operation<void> {
    while (true) {
      const observed = new Set([this.record.cid]);
      for (const [keys, record] of this.hby.db.obvs.getTopItemIter([this.record.cid, this.hab.pre])) {
        if (record.enabled) observed.add(keys[2]);
      }
      for (const aid of observed) {
        const state = this.hby.db.getKever(aid, { refresh: true });
        if (!state) continue;
        for (const witness of state.wits) yield* this.observe(aid, witness);
      }
      yield* sleep(this.pollIntervalMs);
    }
  }
  /** Authenticate this response before recording it; acquire ahead KEL through the normal query owner. */
  private *observe(aid: string, witness: string): Operation<void> {
    const record = new WitnessObservationRecord({
      query_timestamp: new Date().toISOString(),
      response_received: false,
      state: "unresponsive",
      keystate: null,
      sn: null,
      dig: null,
      error: null,
    });
    const controller = new AbortController();
    try {
      const urls = this.hab.fetchUrls(witness), base = urls.https ?? urls.http;
      if (!base) throw new RequestError(404, "Missing witness endpoint");
      const url = new URL(base);
      url.pathname = "/ksn";
      url.search = new URLSearchParams({ pre: aid }).toString();
      const response = yield* call(() =>
        fetch(url, {
          headers: { [CESR_DESTINATION_HEADER]: witness },
          signal: AbortSignal.any([controller.signal, this.stopping.signal, AbortSignal.timeout(10_000)]),
        })
      );
      if (response.status !== 200) {
        yield* call(() => response.body?.cancel());
        throw new RequestError(response.status, "Witness key state unavailable");
      }
      const raw = new Uint8Array(yield* call(() => response.arrayBuffer()));
      const frames = parseBytes(raw), frame = frames[0], event = frame?.body;
      if (
        frames.length !== 1 || !(event instanceof SerderKERI) || event.ilk !== "rpy"
        || event.route !== `/ksn/${witness}`
      ) {
        throw new RequestError(400, "Expected the selected witness key-state reply");
      }
      const state = event.sad!.a as Record<string, unknown>;
      if (state.i !== aid) throw new RequestError(400, "Witness replied about another identifier");
      const result = yield* this.runtime.protocol.dispatch(frame, { local: false, escrows: true });
      const accepted = this.hby.db.knas.get([aid, witness]);
      if (result.decision?.kind !== "accept" || !accepted || accepted.qb64 !== state.d) {
        throw new RequestError(403, "Witness key state did not verify");
      }
      const saved = this.hby.db.ksns.get([accepted.qb64]);
      if (!saved?.s || !saved.d) throw new RequestError(403, "Verified key state is unavailable");
      const local = this.hby.db.getKever(aid, { refresh: true })!;
      const sn = Number.parseInt(saved.s, 16);
      record.response_received = true;
      record.keystate = saved.asDict();
      record.sn = sn;
      record.dig = saved.d;
      record.state = sn > local.sn
        ? "ahead"
        : sn < local.sn
        ? "behind"
        : saved.d === local.said
        ? "even"
        : "duplicitous";
      if (record.state === "ahead") {
        yield* race([
          new SeqNoQuerier(this.hby.db, this.runtime.querying, aid, sn, { signer: this.hab.pre, wits: [witness] })
            .queryDo(),
          (function*() {
            yield* sleep(10_000);
            throw new RequestError(408, "Ahead KEL acquisition timed out");
          })(),
        ]);
      }
    } catch (error) {
      if (this.stopping.signal.aborted) return;
      if (
        !(error instanceof RequestError || error instanceof ParserError || error instanceof ValidationError
          || error instanceof TypeError || error instanceof DOMException)
      ) throw error;
      record.error = error.message;
    } finally {
      controller.abort();
    }
    this.db.observations.pin([this.hab.pre, aid, witness], record);
  }
  /** Foundation status reports completed observations without claiming a globally latest state. */
  status() {
    const emptyStates = (): Record<ObservedState, number> => ({
      even: 0,
      ahead: 0,
      behind: 0,
      duplicitous: 0,
      unresponsive: 0,
    });
    const aids: Record<
      string,
      {
        aid: string;
        witnesses: Record<string, unknown>;
        witness_summary: { total: number; responsive: number; states: Record<ObservedState, number> };
      }
    > = {};
    const summary = {
      total_aids: 0,
      total_witnesses: 0,
      responsive_witnesses: 0,
      last_query_time: null as string | null,
    };
    for (const [keys, row] of this.db.observations.getTopItemIter([this.hab.pre])) {
      const [, aid, witness] = keys;
      const target = aids[aid] ??= {
        aid,
        witnesses: {},
        witness_summary: { total: 0, responsive: 0, states: emptyStates() },
      };
      target.witnesses[witness] = {
        witness_id: witness,
        last_query_timestamp: row.query_timestamp,
        response_received: row.response_received,
        state: row.state,
        keystate: row.keystate,
        sequence_number: row.sn,
        digest: row.dig,
        error: row.error,
      };
      target.witness_summary.total++;
      target.witness_summary.states[row.state]++;
      summary.total_witnesses++;
      if (row.response_received) {
        target.witness_summary.responsive++;
        summary.responsive_witnesses++;
      }
      if (!summary.last_query_time || summary.last_query_time < row.query_timestamp) {
        summary.last_query_time = row.query_timestamp;
      }
    }
    summary.total_aids = Object.keys(aids).length;
    return { watcher_id: this.hab.pre, controller_id: this.record.cid, aids, summary };
  }
  /** Cancel and join input work before runtime-owned stores and the allocated Keeper close. */
  *close(): Operation<void> {
    this.stopping.abort();
    const failures: unknown[] = [];
    for (
      const close of [
        () => call(() => this.publicHandler.close?.()),
        () => call(() => Promise.resolve(this.runtime.replyStreams.close())),
        () => call(() => this.runtime.mailboxDirector.close()),
        () => call(() => Promise.allSettled([...this.requests])),
        () => this.runtime.close(),
        () => this.hby.close(),
      ]
    ) {
      try {
        yield* close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Allocated watcher cleanup failed");
  }
}
/** Concrete allocation owner; one long-lived child task owns each independent watcher. */
export class HostedWatchers {
  private readonly allocations = new Map<string, { watcher: HostedWatcher; task: Task<void> }>();
  private readonly tasks = new Set<Task<void>>();
  private closing?: Promise<void>;

  constructor(
    readonly db: HostedWatcherBaser,
    private readonly options: HostedWatcherOptions,
    private readonly scope: Scope,
  ) {}

  /** Allocation directories belong exclusively to this provider, including during explicit deletion. */
  private directory(name: string): string {
    if (!/^[0-9a-f-]{36}$/.test(name)) throw new ValidationError("Invalid stored watcher directory");
    return join(this.db.path!, "allocations", name);
  }

  /** Reopen retained resources exactly; missing identities are fatal rather than silently replaced. */
  async reload(): Promise<void> {
    for (const [, record] of this.db.watchers.getTopItemIter()) await this.open(record, false);
  }

  /** Own creation/reopen through a persistent task, not the allocating HTTP request's scope. */
  private async open(record: WatcherAllocationRecord, fresh: boolean): Promise<HostedWatcher> {
    if (this.closing) throw new RequestError(503, "Provider is stopping");
    let ready!: (watcher: HostedWatcher) => void, fail!: (error: unknown) => void;
    const opened = new Promise<HostedWatcher>((resolve, reject) => {
      ready = resolve;
      fail = reject;
    });
    const task = this.scope.run(() => this.runAllocation(record, fresh, ready, fail));
    this.tasks.add(task);
    const watcher = await opened;
    this.allocations.set(record.eid, { watcher, task });
    return watcher;
  }

  /** Keep stores and runtime workers alive until the allocation is retired or the provider stops. */
  private *runAllocation(
    record: WatcherAllocationRecord,
    fresh: boolean,
    ready: (watcher: HostedWatcher) => void,
    fail: (error: unknown) => void,
  ): Operation<void> {
    const directory = this.directory(record.name);
    let hby: Habery | undefined,
      hosted: HostedWatcher | undefined,
      worker: Task<void> | undefined,
      polling: Task<void> | undefined;
    try {
      hby = yield* createHabery({
        name: "watcher",
        headDirPath: directory,
        bran: this.options.passcode,
        skipConfig: true,
        skipSignator: true,
      });
      const hab = fresh ? hby.makeHab("watcher", undefined, { transferable: false }) : hby.habByName("watcher");
      if (!hab || (!fresh && hab.pre !== record.eid)) throw new ValidationError("Allocated watcher identity missing");
      record.eid = hab.pre;
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: false,
        registryRoots: "refuse",
        kram: { enabled: true, caches: { "~": [1000, 5000, 5000, 86400000, 5000, 5000, 86400000] } },
      });
      hosted = new HostedWatcher(
        record,
        hby,
        hab,
        runtime,
        this.db,
        this.options.publicUrl,
        this.options.pollIntervalMs ?? 30_000,
      );
      const scheme = new URL(this.options.publicUrl).protocol.slice(0, -1);
      const endpoints = [
        reply("/loc/scheme", { eid: hab.pre, scheme, url: this.options.publicUrl }, {
          pre: hab.pre,
          pvrsn: Vrsn_2_0,
          gvrsn: Vrsn_2_0,
        }),
        reply("/end/role/add", { cid: hab.pre, role: EndpointRoles.controller, eid: hab.pre }, {
          pre: hab.pre,
          pvrsn: Vrsn_2_0,
          gvrsn: Vrsn_2_0,
        }),
      ];
      yield* settleRuntimeIngress(runtime, endpoints.map(event => hab.endorse(event, { gvrsn: Vrsn_2_0 })));
      if (this.closing) throw new RequestError(503, "Provider is stopping");
      this.db.watchers.pin([hab.pre], record);
      // Watcher replies arrive directly; this service does not poll a mailbox.
      worker = yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: false }));
      polling = yield* spawn(() => hosted!.poll());
      ready(hosted);
      yield* suspend();
    } catch (error) {
      fail(error);
      throw error;
    } finally {
      fail(new Error("Watcher startup cancelled"));
      if (polling) yield* polling.halt();
      if (worker) yield* worker.halt();
      if (hosted) yield* hosted.close();
      else if (hby) yield* hby.close();
    }
  }

  /** Private Foundation allocation API. The loopback listener supplies its deployment boundary. */
  readonly administer: ProtocolHandler = async req => {
    try {
      if (this.closing) throw new RequestError(503, "Provider is stopping");
      const path = new URL(req.url).pathname;
      if (path === "/health" && req.method === "GET") return Response.json({ status: "ok" });
      if (path === "/watchers" && req.method === "POST") {
        const body = await req.json();
        if (typeof body?.aid !== "string") throw new RequestError(400, "Controller aid required");
        try {
          if (new Prefixer({ qb64: body.aid }).qb64 !== body.aid) throw new Error("Trailing material");
        } catch {
          throw new RequestError(400, "Invalid controller AID");
        }
        const record = new WatcherAllocationRecord({ name: crypto.randomUUID(), eid: "", cid: body.aid });
        if (body.oobi !== undefined && (typeof body.oobi !== "string" || !/^https?:\/\//.test(body.oobi))) {
          throw new RequestError(400, "Controller OOBI must be HTTP(S)");
        }
        const watcher = await this.open(record, true);
        if (body.oobi) watcher.runtime.oobiery.resolve(body.oobi);
        return Response.json(watcher.coordinates());
      }
      const status = /^\/watchers\/([^/]+)\/status$/.exec(path);
      if (status && req.method === "GET") {
        const allocation = this.allocations.get(status[1]);
        if (!allocation) throw new RequestError(404, "Unknown watcher");
        return Response.json(allocation.watcher.status());
      }
      const match = /^\/watchers\/([^/]+)$/.exec(path);
      if (match && req.method === "DELETE") {
        const allocation = this.allocations.get(match[1]);
        if (!allocation) throw new RequestError(404, "Unknown watcher");
        this.allocations.delete(match[1]);
        await allocation.task.halt();
        this.tasks.delete(allocation.task);
        this.db.watchers.rem([match[1]]);
        for (const [keys] of this.db.observations.getTopItemIter([match[1]])) this.db.observations.rem(keys);
        await Deno.remove(this.directory(allocation.watcher.record.name), { recursive: true });
        return new Response(null, { status: 204 });
      }
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return refusal(error);
    }
  };

  /** Public requests select a real allocation by CESR destination or explicit watcher OOBI. */
  readonly handle: ProtocolHandler = async req => {
    if (this.closing) return new Response("Provider is stopping", { status: 503 });
    const path = new URL(req.url).pathname;
    if (path === "/health" && req.method === "GET") return Response.json({ status: "ok" });
    const oobiPath = /^\/oobi\/([^/]+)(?:\/[^/]+(?:\/([^/]+))?)?\/?$/.exec(path);
    // An account watcher OOBI names the subject first and the serving watcher last.
    const oobi = oobiPath?.[2] ?? oobiPath?.[1];
    const destination = req.headers.get(CESR_DESTINATION_HEADER);
    if (oobi && destination && oobi !== destination) {
      return new Response("Conflicting watcher destination", { status: 400 });
    }
    const selected = oobi ?? destination;
    if (!selected) return new Response("CESR destination required", { status: 400 });
    const allocation = this.allocations.get(selected);
    return allocation ? await allocation.watcher.handle(req) : new Response("Unknown watcher", { status: 404 });
  };

  /** Both listeners may request shutdown; retain allocations while joining each child exactly once. */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      const results = await Promise.allSettled([...this.tasks].map(task => task.halt()));
      this.allocations.clear();
      const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, "Watcher shutdown failed");
    })();
  }
}

/** Run the normal backend command; listeners drain before the resource index closes. */
export function* runHostedWatchers(options: HostedWatcherOptions): Operation<void> {
  const db = new HostedWatcherBaser({ name: options.name, base: options.base, headDirPath: options.headDirPath });
  let provider: HostedWatchers | undefined;
  try {
    if (!(yield* db.reopen())) throw new ValidationError("Watcher allocation store could not open");
    provider = new HostedWatchers(db, options, yield* useScope());
    yield* call(() => provider!.reload());
    const close = function*(): Operation<void> {
      yield* call(() => provider!.close());
    };
    yield* race([
      startServer(options.httpPort, consoleLogger, undefined, {
        hostname: options.httpHost,
        protocolHandler: provider.handle,
      }, close),
      startServer(options.bootPort, consoleLogger, undefined, {
        hostname: "127.0.0.1",
        protocolHandler: provider.administer,
      }, close),
    ]);
  } finally {
    try {
      if (provider) yield* call(() => provider!.close());
    } finally {
      yield* db.close();
    }
  }
}
