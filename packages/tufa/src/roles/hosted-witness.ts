/** KF witness backend: private allocation, public registration and ordinary KERI witness service. */
import { createProtocolHandler, handleWitnessReceiptPost, type ProtocolHandler, startServer } from "@keri-ts/hosting";
import { Encrypter, Matter, MtrDex, parseBytes, ParserError, Prefixer, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, race, run, type Scope, spawn, suspend, type Task, useScope } from "effection";
import { createHabery } from "keri-ts/db/lmdb";
import {
  type AgentRuntime,
  CESR_DESTINATION_HEADER,
  collectBytes,
  consoleLogger,
  createAgentRuntime,
  EndpointRoles,
  type Hab,
  type Habery,
  readRequiredCesrRequestBytes,
  reply,
  requestBytes,
  runAgentRuntime,
  settleRuntimeIngress,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import { NodeHttpClient } from "keri-ts/runtime/node";
import { join } from "node:path";
import { Secret, TOTP } from "npm:otpauth@9.4.1";
import { HostedWitnessBaser, WitnessAllocationRecord } from "./hosted-witness-store.ts";

/** Public service coordinates and private local allocation listener. */
export interface HostedWitnessOptions {
  name: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  publicUrl: string;
  httpPort: number;
  httpHost: string;
  bootPort: number;
}

/** Provider failures are HTTP outcomes, distinct from failed storage or runtime invariants. */
class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Return a public refusal without hiding unexpected infrastructure failures. */
function refusal(error: unknown): Response {
  if (error instanceof RequestError) return new Response(error.message, { status: error.status });
  if (error instanceof ParserError || error instanceof SyntaxError) {
    return new Response("Invalid request encoding", { status: 400 });
  }
  throw error;
}

/**
 * Verify the Foundation OTP/timestamp header with the same ten-minute lower bound.
 * Like witness-hk's `validCode`, an unusable stored secret (a registered non-base32
 * `secret`) is an invalid code, not a server failure.
 */
function validCode(secret: string, authorization: string | null): boolean {
  if (!authorization) return false;
  const parts = authorization.split("#");
  if (parts.length !== 2 || !/^\d{6}$/.test(parts[0])) return false;
  const timestamp = Date.parse(parts[1]);
  if (!Number.isFinite(timestamp) || timestamp < Date.now() - 600_000) return false;
  try {
    return new TOTP({ secret, algorithm: "SHA1", digits: 6, period: 30 })
      .validate({ token: parts[0], timestamp, window: 0 }) !== null;
  } catch {
    return false;
  }
}

/** One allocation owns its controller policy, request lifetime and actual witness runtime. */
class HostedWitness {
  private readonly stopping = new AbortController();
  private readonly requests = new Set<Promise<Response>>();
  private readonly witness: ProtocolHandler;
  private readonly remote: ProtocolHandler;

  constructor(
    readonly record: WitnessAllocationRecord,
    readonly hby: Habery,
    readonly hab: Hab,
    readonly runtime: AgentRuntime,
    private readonly db: HostedWitnessBaser,
    private readonly publicUrl: string,
  ) {
    const policy = { serviceHab: hab, hostedPrefixes: [hab.pre] };
    this.witness = createProtocolHandler(runtime, { ...policy, witnessHab: hab });
    // Unauthenticated public evidence must never receive witness-local authority.
    this.remote = createProtocolHandler(runtime, policy);
  }

  /** Exact Foundation allocation response, shared by new allocation and retained service state. */
  coordinates(): { cid: string; eid: string; oobis: string[] } {
    return { cid: this.record.cid, eid: this.record.eid, oobis: [this.publicUrl + `/oobi/${this.hab.pre}/controller`] };
  }

  /** Admit one request while the allocation exists, then join it before store teardown. */
  handle(req: Request): Promise<Response> {
    if (this.stopping.signal.aborted) return Promise.resolve(new Response("Witness retired", { status: 410 }));
    const request = new Request(req, { signal: AbortSignal.any([req.signal, this.stopping.signal]) });
    const pending = this.respond(request).catch(refusal);
    this.requests.add(pending);
    void pending.then(() => this.requests.delete(pending), () => this.requests.delete(pending));
    return pending;
  }

  /**
   * Dispatch only authorized controller input locally; everything else is ordinary remote input.
   * As in witness-hk, `/receipts` refuses another controller's event (403) and an unregistered
   * controller (412), but an invalid or missing code is not refused: the event is processed
   * non-locally, so a new event waits in misfit escrow (202) and an accepted one is receipted.
   */
  private async respond(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/aids" && req.method === "POST") return await this.register(req);
    if (path === "/log" && req.method === "GET") return this.log(new URL(req.url));
    if (req.method !== "POST" && req.method !== "PUT") return await this.witness(req);
    const bytes = await readRequiredCesrRequestBytes(req);
    if (!bytes) throw new RequestError(406, "CESR content type required");
    const frames = parseBytes(bytes);
    const events = frames.filter(frame =>
      frame.body instanceof SerderKERI
      && ["icp", "rot", "ixn", "dip", "drt"].includes(frame.body.ilk!)
    );
    const own = events.length > 0 && events.every(frame => (frame.body as SerderKERI).pre === this.record.cid);
    let authorized = false;
    if (this.record.code) {
      const plain = this.hab.decrypt(this.record.code);
      const secret = new TextDecoder().decode(new Matter({ qb64b: plain }).raw);
      authorized = validCode(secret, req.headers.get("Authorization"));
    }
    if (path === "/receipts") {
      if (frames.length !== 1) throw new RequestError(400, "Expected one controller event");
      if (!own) throw new RequestError(403, "Event is not from the registered controller");
      if (!this.record.code) throw new RequestError(412, "Controller has not registered with this witness");
    }
    // The reader already appended detached attachments; forward one complete CESR body.
    const headers = new Headers(req.headers);
    headers.set("Content-Type", "application/cesr");
    headers.delete("CESR-ATTACHMENT");
    headers.delete("Content-Length");
    const complete = new Request(req.url, {
      method: req.method,
      headers,
      body: new Uint8Array(bytes),
      signal: req.signal,
    });
    if (path === "/receipts" && !authorized) {
      return await handleWitnessReceiptPost(this.runtime, complete, this.hab, { local: false });
    }
    return await (own && authorized ? this.witness : this.remote)(complete);
  }

  /** Foundation log replay retains first-seen ordering and waits for selected witnessed state. */
  private log(url: URL): Response {
    const pre = url.searchParams.get("pre"), db = this.hby.db;
    const kever = pre ? db.getKever(pre, { refresh: true }) : null;
    if (!pre || !kever) throw new RequestError(404, "Identifier not found");
    const ordinal = (name: string, fallback: number): number => {
      const value = url.searchParams.get(name);
      if (value === null) return fallback;
      if (!/^[0-9a-f]+$/.test(value)) throw new RequestError(400, "Expected hexadecimal log ordinal");
      const number = Number.parseInt(value, 16);
      if (!Number.isSafeInteger(number)) throw new RequestError(400, "Log ordinal exceeds supported range");
      return number;
    };
    const fn = ordinal("fn", 0), sn = ordinal("s", -1), anchor = url.searchParams.get("a");
    if (
      anchor
        ? !db.fetchAllSealingEventByEventSeal(pre, JSON.parse(anchor))
        : sn >= 0 && (kever.sn < sn || !db.fullyWitnessed(kever.serder))
    ) {
      throw new RequestError(404, "Selected witnessed state not found");
    }
    const messages = (function*() {
      yield* db.clonePreIter(pre, fn, Vrsn_2_0);
      yield* db.cloneDelegation(kever, Vrsn_2_0);
    })();
    const first = messages.next();
    if (first.done) throw new RequestError(404, "No events found");
    return new Response(
      this.runtime.replyStreams.open((function*() {
        yield first.value;
        yield* messages;
      })()),
      { headers: { "Content-Type": "application/cesr" } },
    );
  }

  /**
   * Register the allocated controller as witness-hk's `POST /aids` does: the `kel` part is the
   * controller's KEL (KERIpy and Locksmith send the whole KEL), its first event names the subject,
   * and every frame is processed as ordinary remote input with an optional `delkel` first. The
   * parser alone authenticates events; registration succeeds once the controller is accepted.
   * The TOTP secret (generated, or a supplied `secret` used as given) is stored encrypted to this
   * witness's own key and returned encrypted to the controller's current keys.
   */
  private async register(req: Request): Promise<Response> {
    if (!req.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
      throw new RequestError(415, "Multipart controller registration required");
    }
    const body = await collectBytes(requestBytes(req));
    const form = await new Response(body, { headers: { "Content-Type": req.headers.get("Content-Type")! } })
      .formData();
    const kel = form.get("kel"), delegator = form.get("delkel"), supplied = form.get("secret");
    if (kel === null) throw new RequestError(400, "Controller kel part required");
    // Python clients send text fields; file parts carry the same CESR stream.
    const part = async (value: FormDataEntryValue): Promise<Uint8Array> =>
      typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(await value.arrayBuffer());
    const frames = parseBytes(await part(kel));
    const subject = frames[0]?.body;
    if (!(subject instanceof SerderKERI) || subject.pre !== this.record.cid) {
      throw new RequestError(400, "KEL part is not the allocated controller's KEL");
    }
    const delegation = delegator === null ? null : await part(delegator);
    const runtime = this.runtime;
    await run(function*() {
      if (delegation) yield* settleRuntimeIngress(runtime, [delegation]);
      for (const frame of frames) yield* runtime.protocol.dispatch(frame, { local: false, escrows: true });
    });
    const kever = this.hby.db.getKever(this.record.cid, { refresh: true });
    if (!kever) throw new RequestError(400, "KEL part not valid inception event");
    const keys = kever.verfers;
    if (keys.some(key => key.code !== MtrDex.Ed25519 && key.code !== MtrDex.Ed25519N)) {
      throw new RequestError(400, "Registration requires Ed25519 controller keys");
    }
    const secret = supplied === null ? new Secret({ size: 20 }).base32 : new TextDecoder().decode(await part(supplied));
    const plain = new Matter({ raw: new TextEncoder().encode(secret), code: MtrDex.Ed25519_Seed });
    const cipher = new Encrypter({ verkey: this.hab.kever!.verfers[0].qb64 }).encrypt({ ser: plain.qb64b });
    // A repeated registration encrypts to current accepted keys, including after rotation.
    const totps = keys.map(verfer => new Encrypter({ verkey: verfer.qb64 }).encrypt({ ser: plain.qb64b }).qb64);
    this.record.code = cipher.qb64;
    this.db.witnesses.pin([this.hab.pre], this.record);
    return Response.json({ totp: totps[0], oobi: this.coordinates().oobis[0], ...(totps.length > 1 ? { totps } : {}) });
  }

  /** Stop input and response streams, join admitted handlers, then release runtime and key stores. */
  *close(): Operation<void> {
    this.stopping.abort();
    const failures: unknown[] = [];
    for (
      const close of [
        () => call(() => Promise.all([this.witness.close?.(), this.remote.close?.()])),
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
    if (failures.length) throw new AggregateError(failures, "Allocated witness cleanup failed");
  }
}

/** Concrete allocation owner; one long-lived child task owns each independent witness. */
export class HostedWitnesses {
  private readonly allocations = new Map<string, { witness: HostedWitness; task: Task<void> }>();
  private readonly tasks = new Set<Task<void>>();
  private closing?: Promise<void>;

  constructor(
    readonly db: HostedWitnessBaser,
    private readonly options: HostedWitnessOptions,
    private readonly scope: Scope,
  ) {}

  /** Allocation directories belong exclusively to this provider, including during explicit deletion. */
  private directory(name: string): string {
    if (!/^[0-9a-f-]{36}$/.test(name)) throw new ValidationError("Invalid stored witness directory");
    return join(this.db.path!, "allocations", name);
  }

  /** Reopen retained resources exactly; missing identities are fatal rather than silently replaced. */
  async reload(): Promise<void> {
    for (const [, record] of this.db.witnesses.getTopItemIter()) await this.open(record, false);
  }

  /** Own creation/reopen through a persistent task, not the allocating HTTP request's scope. */
  private async open(record: WitnessAllocationRecord, fresh: boolean): Promise<HostedWitness> {
    if (this.closing) throw new RequestError(503, "Provider is stopping");
    let ready!: (witness: HostedWitness) => void, fail!: (error: unknown) => void;
    const opened = new Promise<HostedWitness>((resolve, reject) => {
      ready = resolve;
      fail = reject;
    });
    const task = this.scope.run(() => this.runAllocation(record, fresh, ready, fail));
    this.tasks.add(task);
    const witness = await opened;
    this.allocations.set(record.eid, { witness, task });
    return witness;
  }

  /** Keep stores and runtime workers alive until the allocation is retired or the provider stops. */
  private *runAllocation(
    record: WitnessAllocationRecord,
    fresh: boolean,
    ready: (witness: HostedWitness) => void,
    fail: (error: unknown) => void,
  ): Operation<void> {
    const directory = this.directory(record.name);
    let hby: Habery | undefined, hosted: HostedWitness | undefined, worker: Task<void> | undefined;
    try {
      hby = yield* createHabery({
        name: "witness",
        headDirPath: directory,
        bran: this.options.passcode,
        skipConfig: true,
        skipSignator: true,
      });
      const hab = fresh ? hby.makeHab("witness", undefined, { transferable: false }) : hby.habByName("witness");
      if (!hab || (!fresh && hab.pre !== record.eid)) throw new ValidationError("Allocated witness identity missing");
      record.eid = hab.pre;
      const runtime = yield* createAgentRuntime(hby, new NodeHttpClient(), systemClock, {
        enableMailboxStore: true,
        registryRoots: "refuse",
        kram: { enabled: true, caches: { "~": [1000, 5000, 5000, 86400000, 5000, 5000, 86400000] } },
      });
      hosted = new HostedWitness(record, hby, hab, runtime, this.db, this.options.publicUrl);
      const scheme = new URL(this.options.publicUrl).protocol.slice(0, -1);
      const endpoints = [
        reply("/loc/scheme", { eid: hab.pre, scheme, url: this.options.publicUrl }, {
          pre: hab.pre,
          pvrsn: Vrsn_2_0,
          gvrsn: Vrsn_2_0,
        }),
        ...[EndpointRoles.controller, EndpointRoles.witness, EndpointRoles.mailbox].map(role =>
          reply("/end/role/add", { cid: hab.pre, role, eid: hab.pre }, {
            pre: hab.pre,
            pvrsn: Vrsn_2_0,
            gvrsn: Vrsn_2_0,
          })
        ),
      ];
      yield* settleRuntimeIngress(runtime, endpoints.map(event => hab.endorse(event, { gvrsn: Vrsn_2_0 })));
      if (this.closing) throw new RequestError(503, "Provider is stopping");
      this.db.witnesses.pin([hab.pre], record);
      // This process provides mailboxes; it is not a wallet polling its own listener.
      worker = yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: false }));
      ready(hosted);
      yield* suspend();
    } catch (error) {
      fail(error);
      throw error;
    } finally {
      fail(new Error("Witness startup cancelled"));
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
      if (path === "/witnesses" && req.method === "POST") {
        const body = await req.json();
        if (typeof body?.aid !== "string") throw new RequestError(400, "Controller aid required");
        try {
          if (new Prefixer({ qb64: body.aid }).qb64 !== body.aid) throw new Error("Trailing material");
        } catch {
          throw new RequestError(400, "Invalid controller AID");
        }
        const record = new WitnessAllocationRecord({ name: crypto.randomUUID(), eid: "", cid: body.aid, code: null });
        return Response.json((await this.open(record, true)).coordinates());
      }
      const match = /^\/witnesses\/([^/]+)$/.exec(path);
      if (match && req.method === "DELETE") {
        const allocation = this.allocations.get(match[1]);
        if (!allocation) throw new RequestError(404, "Unknown witness");
        this.allocations.delete(match[1]);
        await allocation.task.halt();
        this.tasks.delete(allocation.task);
        this.db.witnesses.rem([match[1]]);
        await Deno.remove(this.directory(allocation.witness.record.name), { recursive: true });
        return new Response(null, { status: 204 });
      }
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return refusal(error);
    }
  };

  /** Public requests select a real allocation by CESR destination or explicit witness OOBI. */
  readonly handle: ProtocolHandler = async req => {
    if (this.closing) return new Response("Provider is stopping", { status: 503 });
    const path = new URL(req.url).pathname;
    if (path === "/health" && req.method === "GET") return Response.json({ status: "ok" });
    const oobiPath = /^\/oobi\/([^/]+)(?:\/[^/]+(?:\/([^/]+))?)?\/?$/.exec(path);
    // An account witness OOBI names the subject first and the serving witness last.
    const oobi = oobiPath?.[2] ?? oobiPath?.[1];
    const destination = req.headers.get(CESR_DESTINATION_HEADER);
    if (oobi && destination && oobi !== destination) {
      return new Response("Conflicting witness destination", { status: 400 });
    }
    const selected = oobi ?? destination;
    if (!selected) return new Response("CESR destination required", { status: 400 });
    const allocation = this.allocations.get(selected);
    if (allocation) return await allocation.witness.handle(req);
    // witness-hk answers an unknown destination on its registration and receipt routes with 400.
    return new Response("Unknown witness", { status: ["/aids", "/receipts"].includes(path) ? 400 : 404 });
  };

  /** Both listeners may request shutdown; retain allocations while joining each child exactly once. */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      const results = await Promise.allSettled([...this.tasks].map(task => task.halt()));
      this.allocations.clear();
      const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, "Witness shutdown failed");
    })();
  }
}

/** Run the normal backend command; listeners drain before the resource index closes. */
export function* runHostedWitnesses(options: HostedWitnessOptions): Operation<void> {
  const db = new HostedWitnessBaser({ name: options.name, base: options.base, headDirPath: options.headDirPath });
  let provider: HostedWitnesses | undefined;
  try {
    if (!(yield* db.reopen())) throw new ValidationError("Witness allocation store could not open");
    provider = new HostedWitnesses(db, options, yield* useScope());
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
