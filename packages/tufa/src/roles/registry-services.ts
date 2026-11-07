/** Normal Registrar/Observer hosts with private account enrollment and explicit resource lifetimes. */
import { createProtocolHandler, type ProtocolHandler, type SourceConfig, startServer } from "@keri-ts/hosting";
import { createObservationBaser, type ObservationBaser, Observer } from "@keri-ts/observer";
import { Registrar } from "@keri-ts/registrar";
import { b, parseBytes, ParserError, Prefixer, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, race, spawn, type Task } from "effection";
import {
  type AgentRuntime,
  collectBytes,
  consoleLogger,
  createAgentRuntime,
  createHabery,
  EndpointRoles,
  FetchHttpClient,
  type Hab,
  type Habery,
  reply,
  requestBytes,
  runAgentRuntime,
  settleRuntimeIngress,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import { RegistryServiceAccessBaser, type RegistryServiceRole } from "./registry-service-access.ts";

/** Select an existing service habitat; public TLS and private loopback listeners have separate ports. */
export interface RegistryServiceOptions {
  name: string;
  alias: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  publicUrl: string;
  httpPort: number;
  httpHost: string;
  bootPort: number;
  tls: { key: string; cert: string };
  /** Explicit public KEL bootstrap, including configured source-service identities. */
  initialEvidence?: readonly Uint8Array[];
}
/** Operator-selected source observers remain authorized when a dynamic account is removed. */
export interface RegistrarServiceOptions extends RegistryServiceOptions {
  observers?: readonly string[];
}
/** Source acquisition stays scheduled independently of reader activation and incoming queries. */
export interface ObserverServiceOptions extends RegistryServiceOptions {
  /** Fixed operator readers remain independent of revocable account enrollment. */
  readers?: readonly string[];
  sources: readonly SourceConfig[];
  pollIntervalMs?: number;
  timeoutMs?: number;
  maximumAgeMs?: number;
}
/** Expected private API refusals do not mask storage or service failures. */
class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
/** Reject malformed client input while letting infrastructure failures retain their owner. */
function refusal(error: unknown): Response {
  if (error instanceof RequestError) return new Response(error.message, { status: error.status });
  if (error instanceof ParserError || error instanceof ValidationError || error instanceof SyntaxError) {
    return new Response("Invalid account enrollment", { status: 400 });
  }
  throw error;
}
/** Enrollment imports public KEL only; neither credential state nor new local habitats are created. */
async function introduce(evidence: Registrar, raw: Uint8Array, signal?: AbortSignal): Promise<void> {
  const frames = parseBytes(raw);
  if (
    !frames.length
    || frames.some(({ body }) =>
      !(body instanceof SerderKERI) || !["icp", "dip", "rot", "drt", "ixn", "rct"].includes(body.ilk ?? "")
    )
  ) throw new RequestError(400, "Enrollment requires public KEL evidence only");
  const result = await evidence.ingest(raw, signal);
  if (Object.keys(result.rejected).length || Object.keys(result.pending).length) {
    throw new RequestError(409, "Public KEL evidence is refused or incomplete");
  }
}
/** One concrete service owns its handlers and live permissions; protocol owners retain all authentication. */
class RegistryService {
  private readonly stopping = new AbortController();
  private readonly requests = new Set<Promise<Response>>();
  private readonly introductions: ProtocolHandler;
  private closing?: Promise<void>;

  constructor(
    readonly runtime: AgentRuntime,
    readonly hab: Hab,
    readonly access: RegistryServiceAccessBaser,
    readonly service: Registrar | Observer,
    readonly evidence: Registrar,
    readonly staticObservers: ReadonlySet<string>,
    readonly staticReaders: ReadonlySet<string>,
  ) {
    this.introductions = createProtocolHandler(runtime, { serviceHab: hab, hostedPrefixes: [hab.pre] });
  }
  /** Restore committed permissions before either listener can accept requests. */
  reload(): void {
    for (const [keys, record] of this.access.accounts.getTopItemIter()) {
      if (keys[0] !== record.aid || !this.runtime.hby.db.getKever(record.aid)) {
        throw new ValidationError("Service activation lacks its accepted account identity");
      }
      this.validateRoles(record.roles);
      this.apply(record.aid, record.roles);
    }
  }
  /** Keep fixed source-service permissions separate from revocable tenant roles. */
  private apply(aid: string, roles: readonly RegistryServiceRole[]): void {
    if (this.service instanceof Registrar) {
      this.service.setPublisher(aid, roles.includes("publisher"));
      this.service.setObserver(aid, this.staticObservers.has(aid) || roles.includes("observer"));
    } else this.service.setReader(aid, this.staticReaders.has(aid) || roles.includes("reader"));
  }
  /** Only the named service's concrete role vocabulary can be activated. */
  private validateRoles(value: unknown): asserts value is RegistryServiceRole[] {
    const allowed = this.service instanceof Registrar ? ["publisher", "observer"] : ["reader"];
    if (
      !Array.isArray(value) || !value.length || !value.every(role => typeof role === "string" && allowed.includes(role))
      || new Set(value).size !== value.length
    ) throw new RequestError(400, "Invalid service roles");
  }
  /** Join every admitted request before closing stores, including disconnected clients. */
  private track(req: Request, handler: ProtocolHandler): Promise<Response> {
    if (this.stopping.signal.aborted) return Promise.resolve(new Response("Service is stopping", { status: 503 }));
    const request = new Request(req, { signal: AbortSignal.any([req.signal, this.stopping.signal]) });
    const pending = handler(request).catch(refusal);
    this.requests.add(pending);
    void pending.then(() => this.requests.delete(pending), () => this.requests.delete(pending));
    return pending;
  }
  /** Only health/OOBI introductions bypass the service's signed public query handlers. */
  readonly handle: ProtocolHandler = req =>
    this.track(req, async request => {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && (path === "/health" || path.startsWith("/oobi/"))) {
        return await this.introductions(request);
      }
      return await this.service.handle(request);
    });
  /** Trusted private boot administration replaces or revokes one explicit account activation. */
  readonly administer: ProtocolHandler = req =>
    this.track(req, async request => {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/health") return Response.json({ status: "ok" });
      const match = /^\/accounts\/([^/]+)$/.exec(path);
      if (!match) throw new RequestError(404, "Unknown account route");
      const aid = match[1];
      if (new Prefixer({ qb64: aid }).qb64 !== aid) throw new RequestError(400, "Invalid account AID");
      if (request.method === "GET") {
        const record = this.access.accounts.get([aid]);
        if (!record) throw new RequestError(404, "Account is not enrolled");
        return Response.json({ aid, roles: record.roles, service: this.hab.pre });
      }
      if (request.method === "DELETE") {
        this.access.accounts.rem([aid]);
        this.apply(aid, []);
        return new Response(null, { status: 204 });
      }
      if (request.method !== "PUT") throw new RequestError(405, "Use PUT, GET or DELETE");
      const body = JSON.parse(new TextDecoder().decode(await collectBytes(requestBytes(request))));
      if (
        !body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some(key => !["roles", "kel"].includes(key))
        || typeof body.kel !== "string" || !body.kel
      ) throw new RequestError(400, "Roles and public KEL are required");
      this.validateRoles(body.roles);
      await introduce(this.evidence, b(body.kel), request.signal);
      request.signal.throwIfAborted();
      if (!this.runtime.hby.db.getKever(aid, { refresh: true })) {
        throw new RequestError(409, "Account KEL is not accepted");
      }
      this.access.accounts.pin([aid], { aid, roles: body.roles });
      this.apply(aid, body.roles);
      return Response.json({ aid, roles: body.roles, service: this.hab.pre });
    });
  /** Stop new work, cancel existing requests and join their use of the shared protocol owners. */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.stopping.abort();
      await Promise.allSettled([...this.requests]);
      await this.introductions.close?.();
    })();
  }
}
/** Validate concrete listener configuration before opening stores or binding sockets. */
function validate(options: RegistryServiceOptions): void {
  const url = new URL(options.publicUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new ValidationError("Registry service public URL must be an HTTPS origin");
  }
  if (!options.name || !options.alias || !options.tls?.key || !options.tls.cert) {
    throw new ValidationError("Existing service name, alias and explicit TLS identity are required");
  }
  if (
    ![options.httpPort, options.bootPort].every(port => Number.isSafeInteger(port) && port > 0 && port <= 65535)
    || options.httpPort === options.bootPort
  ) throw new ValidationError("Service listeners require distinct valid ports");
}
type Selection = { kind: "registrar"; options: RegistrarServiceOptions } | {
  kind: "observer";
  options: ObserverServiceOptions;
};
/** Open the selected concrete service, then close requests/workers before its independent stores. */
function* runService(selection: Selection): Operation<void> {
  const { options } = selection;
  validate(options);
  let hby: Habery | undefined, runtime: AgentRuntime | undefined, owner: RegistryService | undefined;
  let worker: Task<void> | undefined, polling: Task<void> | undefined, observations: ObservationBaser | undefined;
  const access = new RegistryServiceAccessBaser({
    name: options.name,
    base: options.base,
    headDirPath: options.headDirPath,
  });
  /** Attempt every owned cleanup in dependency order, including during scope cancellation. */
  function* closeResources(): Operation<void> {
    const failures: unknown[] = [];
    const cleanup = [
      function*() {
        if (owner) yield* call(() => owner!.close());
      },
      function*() {
        if (polling) yield* call(() => polling!.halt());
      },
      function*() {
        if (worker) yield* call(() => worker!.halt());
      },
      function*() {
        if (runtime) yield* runtime.close();
      },
      function*() {
        if (observations) yield* observations.close();
      },
      function*() {
        yield* access.close();
      },
      function*() {
        if (hby) yield* hby.close();
      },
    ];
    for (const close of cleanup) {
      try {
        yield* close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Registry service cleanup failed");
  }
  try {
    hby = yield* createHabery({
      name: options.name,
      base: options.base,
      headDirPath: options.headDirPath,
      bran: options.passcode,
      skipConfig: true,
      skipSignator: true,
    });
    const hab = hby.habByName(options.alias);
    if (!hab) throw new ValidationError("Initialize the selected service identity before starting it");
    runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      enableMailboxStore: false,
      registryRoots: "refuse",
      kram: { enabled: true, denials: [], caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
    });
    if (!(yield* access.reopen())) throw new ValidationError("Service access store could not open");
    const staticObservers = new Set(selection.kind === "registrar" ? selection.options.observers : []);
    const staticReaders = new Set(selection.kind === "observer" ? selection.options.readers : []);
    const evidence = new Registrar(runtime.protocol, runtime.acdc!.store, {
      observers: [...staticObservers],
      fullEvidence: true,
    });
    let service: Registrar | Observer = evidence;
    if (selection.kind === "observer") {
      observations = yield* createObservationBaser({
        name: options.name,
        base: options.base,
        headDirPath: options.headDirPath,
      });
      service = new Observer(runtime.protocol, runtime.acdc!.store, observations, {
        sources: selection.options.sources,
        readers: [...staticReaders],
        maximumAgeMs: selection.options.maximumAgeMs,
      });
    }
    owner = new RegistryService(runtime, hab, access, service, evidence, staticObservers, staticReaders);
    for (const raw of options.initialEvidence ?? []) yield* call(() => introduce(evidence, raw));
    owner.reload();
    const endpoints = [
      reply("/loc/scheme", { eid: hab.pre, scheme: "https", url: options.publicUrl }, {
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
    const active = runtime;
    worker = yield* spawn(() => runAgentRuntime(active, { hab, pollMailbox: false }));
    if (service instanceof Observer && selection.kind === "observer") {
      const observer = service, settings = selection.options;
      polling = yield* spawn(() =>
        observer.run(hab, { intervalMs: settings.pollIntervalMs, timeoutMs: settings.timeoutMs })
      );
    }
    const close = function*(): Operation<void> {
      yield* call(() => owner!.close());
    };
    yield* race([
      startServer(options.httpPort, consoleLogger, undefined, {
        hostname: options.httpHost,
        tls: options.tls,
        protocolHandler: owner.handle,
      }, close),
      startServer(options.bootPort, consoleLogger, undefined, {
        hostname: "127.0.0.1",
        protocolHandler: owner.administer,
      }, close),
    ]);
  } finally {
    yield* closeResources();
  }
}
/** Serve authenticated foreign publication and source reads using an existing Registrar identity. */
export function* runRegistrar(options: RegistrarServiceOptions): Operation<void> {
  yield* runService({ kind: "registrar", options });
}
/** Serve enrolled readers from independently acquired source evidence using an existing Observer identity. */
export function* runObserver(options: ObserverServiceOptions): Operation<void> {
  yield* runService({ kind: "observer", options });
}
