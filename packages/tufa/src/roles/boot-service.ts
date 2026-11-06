/**
 * KF boot service: public discovery, CESR-over-HTTP onboarding/account surfaces and the
 * asynchronous provisioning worker that allocates hosted witnesses and a watcher.
 *
 * Port of upstream kf-boot (`app.py`, `onboarding.py`, `boot_exchanger.py`,
 * `provisioning.py`, `operating.py`). Wire surfaces match it exactly so Locksmith and Tufa
 * cannot tell the implementations apart: discovery JSON, the transport status table
 * (406/400/412/404/401/409/204/200), signed v2 `exn` replies prefixed by the boot server's
 * KEL, route payloads and operation records. The service drives witness, watcher,
 * registrar and observer backends only through their private admin APIs
 * (`operator/kfboot/service-admin.ts`), so Python and TypeScript backends mix freely.
 *
 * Python-only by justification (no local, Locksmith or Tufa consumer): per-IP admission
 * and quotas, account tiers beyond the default trial/org mapping, the cleanup sweeper and
 * its CLI, capacity counters. Their `KF_BOOT_*` variables are accepted and ignored.
 * Sessions and accounts expire on access only.
 */
import { startServer } from "@keri-ts/hosting";
import { type ProtocolHandler } from "@keri-ts/hosting";
import { concatBytes, parseBytes, ParserError, Prefixer, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run, sleep, spawn, type Task } from "effection";
import {
  acceptedEventReplayMessage,
  type AgentRuntime,
  collectBytes,
  consoleLogger,
  createAgentRuntime,
  createHabery,
  exchange,
  FetchHttpClient,
  type Hab,
  type Habery,
  type HttpClient,
  requestBytes,
  runAgentRuntime,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import { readFileSync } from "node:fs";
import { blake2b } from "npm:@noble/hashes@1.8.0/blake2";
import {
  BootApiError,
  RegistryAdmin,
  type ServiceAllocation,
  WatcherAdmin,
  WitnessAdmin,
} from "../operator/kfboot/service-admin.ts";
import {
  AccountRecord,
  AccountStates,
  type BootOperationRecord,
  BootServiceBaser,
  BootServiceStore,
  makeResource,
  nowIso,
  OperationKinds,
  OperationStates,
  ResourceRecord,
  resourceToApi,
  type SessionRecord,
  SessionStates,
  TERMINAL_SESSION_STATES,
} from "./boot-service-store.ts";

// ---------------------------------------------------------------------------
// Configuration (`config.py`)

/** Onboarding-surface routes (`config.ONBOARDING_ROUTES`). */
export const ONBOARDING_ROUTES: ReadonlySet<string> = new Set([
  "/operations/status",
  "/onboarding/session/start",
  "/onboarding/session/status",
  "/onboarding/account/create",
  "/onboarding/complete",
  "/onboarding/cancel",
]);

/** Account-surface routes (`config.ACCOUNT_ROUTES`). */
export const ACCOUNT_ROUTES: ReadonlySet<string> = new Set([
  "/account/services",
  "/operations/status",
  "/account/witnesses",
  "/account/watchers",
  "/account/watchers/status",
  "/account/delete",
  "/account/witnesses/delete",
  "/account/watchers/delete",
]);

/** Advertised profiles and their (witness_count, toad); only these codes are ever offered. */
const FROZEN_ACCOUNT_OPTIONS: Record<string, [number, number]> = { "1-of-1": [1, 1], "3-of-4": [4, 3] };

/** One configured witness provider. */
export interface WitnessBackend {
  id: string;
  bootUrl: string;
  publicUrl: string;
}

/** One fixed registry service with loopback administration and public HTTPS trust. */
export interface RegistryBackend {
  bootUrl: string;
  publicUrl: string;
  serviceAid: string;
  /** Certificates only, as returned to wallets in `ca_pem`; empty when no CA file is configured. */
  caPem: string;
}

/** Validated boot service configuration; every field has a `KF_BOOT_*` variable. */
export interface BootServiceConfig {
  host: string;
  port: number;
  bootHabName: string;
  onboardingPath: string;
  accountPath: string;
  onboardingPublicUrl: string;
  accountPublicUrl: string;
  regionId: string;
  regionName: string;
  witnessBackends: WitnessBackend[];
  watcherBootUrl: string;
  watcherPublicUrl: string;
  /** Advertised profile codes after filtering by the configured witness backends. */
  accountOptions: string[];
  watcherRequired: boolean;
  sessionTtlSeconds: number;
  accountTtlSeconds: number;
  bootApiTimeoutSeconds: number;
  operationFailureMaxAttempts: number;
  registrar: RegistryBackend | null;
  observer: RegistryBackend | null;
}

/** Strip trailing slashes as `_normalize_url` does. */
function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

/** `_parse_bool`: empty uses the default, otherwise only 1/true/yes/on are true. */
function parseBool(value: string, fallback: boolean): boolean {
  return value ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()) : fallback;
}

/** Integer setting; rejects anything Python's `int()` would. */
function parseInteger(name: string, value: string): number {
  const number = Number(value.trim());
  if (!/^\s*[+-]?\d+\s*$/.test(value) || !Number.isSafeInteger(number)) {
    throw new ValidationError(`KF_BOOT_${name} must be an integer.`);
  }
  return number;
}

/** Float setting; rejects anything Python's `float()` would. */
function parseNumber(name: string, value: string): number {
  const number = Number(value.trim());
  if (!value.trim() || !Number.isFinite(number)) throw new ValidationError(`KF_BOOT_${name} must be a number.`);
  return number;
}

/** `_parse_witness_backends`: `<id>|<boot_url>|<public_url>,…`. */
export function parseWitnessBackends(value: string): WitnessBackend[] {
  return value.split(",").map(item => item.trim()).filter(Boolean).map(item => {
    const parts = item.split("|").map(part => part.trim());
    if (parts.length !== 3 || !parts.every(Boolean)) {
      throw new ValidationError(
        "KF_BOOT_WITNESS_BACKENDS entries must be formatted as '<id>|<boot_url>|<public_url>'",
      );
    }
    return { id: parts[0], bootUrl: normalizeUrl(parts[1]), publicUrl: normalizeUrl(parts[2]) };
  });
}

/** `RegistryBackend.__post_init__`: loopback HTTP boot URL, HTTPS public URL, one AID, certificate PEM. */
export function registryBackend(
  bootUrl: string,
  publicUrl: string,
  serviceAid: string,
  caPem = "",
): RegistryBackend {
  const boot = bootUrl.trim(), pub = publicUrl.trim();
  let bootParsed: URL, publicParsed: URL;
  try {
    bootParsed = new URL(boot);
    publicParsed = new URL(pub);
  } catch {
    throw new ValidationError("Invalid registry backend URL: Registry service URLs require a host.");
  }
  for (const [raw, url] of [[boot, bootParsed], [pub, publicParsed]] as const) {
    if (!url.hostname || url.username || url.password || /[?#\\\s]/.test(raw)) {
      throw new ValidationError(
        "Invalid registry backend URL: Registry service URLs require a host and no credentials, query or fragment.",
      );
    }
  }
  const host = bootParsed.hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || /^127\./.test(host) || host === "::1";
  if (bootParsed.protocol !== "http:" || !loopback) {
    throw new ValidationError("Invalid registry backend URL: Registry boot_url must use loopback HTTP.");
  }
  if (publicParsed.protocol !== "https:") {
    throw new ValidationError("Invalid registry backend URL: Registry public_url must use HTTPS.");
  }
  try {
    if (new Prefixer({ qb64: serviceAid }).qb64 !== serviceAid) throw new Error("Trailing material");
  } catch {
    throw new ValidationError("Registry service_aid must be one complete AID.");
  }
  let certificates = "";
  if (caPem) {
    const blocks = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!blocks) throw new ValidationError("Registry CA PEM must contain a certificate.");
    certificates = blocks.join("\n") + "\n";
    try {
      Deno.createHttpClient({ caCerts: [certificates] }).close();
    } catch {
      throw new ValidationError("Registry CA PEM is invalid.");
    }
  }
  return { bootUrl: normalizeUrl(boot), publicUrl: normalizeUrl(pub), serviceAid, caPem: certificates };
}

/** `_registry_backend_from_env`: all of BOOT_URL, PUBLIC_URL and SERVICE_AID, or none. */
function registryFromEnv(service: string, get: (name: string, fallback: string) => string): RegistryBackend | null {
  const boot = get(`${service}_BOOT_URL`, "").trim(), pub = get(`${service}_PUBLIC_URL`, "").trim();
  const aid = get(`${service}_SERVICE_AID`, "").trim(), caFile = get(`${service}_CA_FILE`, "").trim();
  if (!boot && !pub && !aid && !caFile) return null;
  if (!boot || !pub || !aid) {
    throw new ValidationError(`KF_BOOT_${service} requires BOOT_URL, PUBLIC_URL and SERVICE_AID together.`);
  }
  const path = caFile.startsWith("~/") ? (Deno.env.get("HOME") ?? "") + caFile.slice(1) : caFile;
  return registryBackend(boot, pub, aid, caFile ? readFileSync(path, "utf8") : "");
}

/**
 * Build the configuration from `KF_BOOT_*` values (`Config.from_env` plus `__post_init__`).
 *
 * @param values Variables keyed without the `KF_BOOT_` prefix; absent keys use kf-boot defaults.
 */
export function bootServiceConfig(values: Readonly<Record<string, string | undefined>>): BootServiceConfig {
  const get = (name: string, fallback?: string): string => {
    const value = values[name];
    if (value !== undefined) return value;
    if (fallback === undefined) throw new ValidationError(`Missing environment variable KF_BOOT_${name}`);
    return fallback;
  };
  const host = get("HOST", "127.0.0.1");
  const port = parseInteger("PORT", get("PORT", "9723"));
  const onboardingPath = normalizeUrl(get("ONBOARDING_PATH", "/onboarding")) || "/onboarding";
  const accountPath = normalizeUrl(get("ACCOUNT_PATH", "/account")) || "/account";
  let witnessBackends = parseWitnessBackends(values.WITNESS_BACKENDS ?? "");
  if (!witnessBackends.length) {
    const boot = normalizeUrl(get("WIT_BOOT_URL")), pub = normalizeUrl(get("WIT_PUBLIC_URL"));
    if (!boot || !pub) throw new ValidationError("At least one witness backend must be configured.");
    witnessBackends = [{ id: "wit-1", bootUrl: boot, publicUrl: pub }];
  }
  const ids = new Set<string>(), boots = new Set<string>();
  for (const backend of witnessBackends) {
    if (ids.has(backend.id)) throw new ValidationError(`Duplicate witness backend id '${backend.id}'.`);
    if (boots.has(backend.bootUrl)) {
      throw new ValidationError(`Duplicate witness backend boot_url '${backend.bootUrl}'.`);
    }
    ids.add(backend.id);
    boots.add(backend.bootUrl);
  }
  const accountOptions: string[] = [];
  for (const raw of get("BOOTSTRAP_ACCOUNT_OPTIONS", "1-of-1,3-of-4").split(",")) {
    const code = raw.trim().toLowerCase();
    const option = FROZEN_ACCOUNT_OPTIONS[code];
    if (option && !accountOptions.includes(code) && option[0] <= witnessBackends.length) accountOptions.push(code);
  }
  if (!accountOptions.length) {
    throw new ValidationError("No bootstrap account options are supported by the configured witness backends.");
  }
  const config: BootServiceConfig = {
    host,
    port,
    bootHabName: get("BOOT_HAB_NAME", "boot-server"),
    onboardingPath,
    accountPath,
    onboardingPublicUrl: normalizeUrl(get("ONBOARDING_PUBLIC_URL", `http://${host}:${port}${onboardingPath}`)),
    accountPublicUrl: normalizeUrl(get("ACCOUNT_PUBLIC_URL", `http://${host}:${port}${accountPath}`)),
    regionId: get("REGION_ID", "nyc"),
    regionName: get("REGION_NAME", "New York"),
    witnessBackends,
    watcherBootUrl: normalizeUrl(get("WAT_BOOT_URL")),
    watcherPublicUrl: normalizeUrl(get("WAT_PUBLIC_URL")),
    accountOptions,
    watcherRequired: parseBool(get("BOOTSTRAP_WATCHER_REQUIRED", "true"), true),
    sessionTtlSeconds: parseInteger("SESSION_TTL_SECONDS", get("SESSION_TTL_SECONDS", "300")),
    accountTtlSeconds: parseNumber("ACCOUNT_TTL_SECONDS", get("ACCOUNT_TTL_SECONDS", "172800")),
    bootApiTimeoutSeconds: parseNumber("BOOT_API_TIMEOUT_SECONDS", get("BOOT_API_TIMEOUT_SECONDS", "10")),
    operationFailureMaxAttempts: parseInteger(
      "OPERATION_FAILURE_MAX_ATTEMPTS",
      get("OPERATION_FAILURE_MAX_ATTEMPTS", "10"),
    ),
    registrar: registryFromEnv("REGISTRAR", get),
    observer: registryFromEnv("OBSERVER", get),
  };
  if (config.sessionTtlSeconds <= 0) throw new ValidationError("session_ttl_seconds must be greater than 0.");
  if (config.bootApiTimeoutSeconds <= 0) {
    throw new ValidationError("boot_api_timeout_seconds must be greater than 0.");
  }
  if (config.accountTtlSeconds < 0) {
    throw new ValidationError("account_ttl_seconds must be greater than or equal to 0.");
  }
  if (config.operationFailureMaxAttempts <= 0) {
    throw new ValidationError("operation_failure_max_attempts must be greater than 0.");
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new ValidationError("Invalid KF_BOOT_PORT.");
  return config;
}

/** `_account_option`: `<toad>-of-<witness_count>`. */
function accountOption(code: string): { code: string; witness_count: number; toad: number } {
  const [witnessCount, toad] = FROZEN_ACCOUNT_OPTIONS[code];
  return { code, witness_count: witnessCount, toad };
}

/** Default tier mapping (`_default_account_profiles`). */
function accountTier(witnessCount: number): string {
  return witnessCount === 1 ? "trial" : "org";
}

// ---------------------------------------------------------------------------
// HTTP refusals (Falcon errors)

const STATUS_TITLES: Record<number, string> = {
  400: "400 Bad Request",
  401: "401 Unauthorized",
  404: "404 Not Found",
  405: "405 Method Not Allowed",
  406: "406 Not Acceptable",
  409: "409 Conflict",
  410: "410 Gone",
  412: "412 Precondition Failed",
  500: "500 Internal Server Error",
  503: "503 Service Unavailable",
};

/** An HTTP refusal with Falcon's JSON shape `{"title","description"}`. */
export class BootRefusal extends Error {
  constructor(
    readonly status: number,
    readonly title = STATUS_TITLES[status] ?? `${status}`,
    readonly description?: string,
  ) {
    super(description ?? title);
    this.name = "BootRefusal";
  }

  /** Falcon's error representation, which Locksmith formats for users. */
  response(): Response {
    const body: Record<string, string> = { title: this.title };
    if (this.description !== undefined) body.description = this.description;
    return Response.json(body, { status: this.status });
  }
}

/** `utils.optionalStr`. */
function optionalStr(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

/** `utils.requiredStr`. */
function requiredStr(payload: Record<string, unknown>, key: string): string {
  const value = optionalStr(payload, key);
  if (!value) throw new BootRefusal(400, "Invalid request payload", `${key} is required.`);
  return value;
}

/** Python `datetime` comparison of an ISO deadline against now; corrupt metadata fails closed. */
function pastDue(expiresAt: string): boolean {
  if (!expiresAt) return false;
  const deadline = Date.parse(expiresAt);
  return Number.isNaN(deadline) || deadline <= Date.now();
}

// ---------------------------------------------------------------------------
// Service

const EVENT_ILKS: ReadonlySet<string> = new Set(["icp", "rot", "ixn", "dip", "drt"]);
const CESR_MEDIA_TYPES: ReadonlySet<string> = new Set(["application/cesr", "application/cesr+json"]);

/** Route handler: authenticated exn sender and its `a` payload. */
type RouteHandler = (sender: string, payload: Record<string, unknown>) => void;

/** Reply or refusal recorded by a route for the surface request that delivered its exn. */
type RouteOutcome = { reply: Uint8Array } | { error: BootRefusal };

/** Signals a retryable or terminal backend failure to the operation worker. */
function bootError(message: string, status: number | null): BootApiError {
  return new BootApiError(message, status);
}

/** Store, protocol owners and backends of one running boot service. */
export class BootService {
  readonly store: BootServiceStore;
  private readonly routes = new Map<string, RouteHandler>();
  private readonly outcomes = new Map<string, RouteOutcome>();
  private readonly witnessAdmins = new Map<string, WitnessAdmin>();
  readonly watcherAdmin: WatcherAdmin;

  constructor(
    readonly config: BootServiceConfig,
    readonly hby: Habery,
    readonly hab: Hab,
    readonly runtime: AgentRuntime,
    db: BootServiceBaser,
    readonly http: HttpClient,
  ) {
    this.store = new BootServiceStore(db, config.sessionTtlSeconds, config.accountTtlSeconds);
    const timeout = config.bootApiTimeoutSeconds * 1000;
    for (const backend of config.witnessBackends) {
      this.witnessAdmins.set(backend.id, new WitnessAdmin(backend.bootUrl, http, timeout));
    }
    this.watcherAdmin = new WatcherAdmin(config.watcherBootUrl, http, timeout);
    this.addRoute("/onboarding/session/start", (sender, payload) => this.sessionStart(sender, payload));
    this.addRoute("/onboarding/session/status", (sender, payload) => this.sessionStatus(sender, payload));
    this.addRoute("/onboarding/cancel", (sender, payload) => this.cancel(sender, payload));
    this.addRoute("/operations/status", (sender, payload) => this.operationStatus(sender, payload));
    this.addRoute("/onboarding/account/create", (sender, payload) => this.accountCreate(sender, payload));
    this.addRoute("/onboarding/complete", (sender, payload) => this.complete(sender, payload));
    this.addRoute("/account/services", (sender, payload) => this.accountServices(sender, payload));
    this.addRoute("/account/witnesses", (sender, payload) => this.accountResources("witness", sender, payload));
    this.addRoute("/account/watchers", (sender, payload) => this.accountResources("watcher", sender, payload));
    this.addRoute("/account/watchers/status", (sender, payload) => this.watcherStatus(sender, payload));
    this.addRoute("/account/witnesses/delete", (sender, payload) => this.resourceDelete("witness", sender, payload));
    this.addRoute("/account/watchers/delete", (sender, payload) => this.resourceDelete("watcher", sender, payload));
    this.addRoute("/account/delete", (sender, payload) => this.accountDelete(sender, payload));
  }

  /** Register one exn route with the shared Exchanger; its outcome is keyed by the exn SAID. */
  protected addRoute(route: string, handler: RouteHandler): void {
    this.routes.set(route, handler);
    this.runtime.protocol.exc.addHandler({
      resource: route,
      handle: ({ serder }) => {
        const payload = serder.sad!.a;
        // Route handlers are synchronous, so the exn being handled is exactly this one.
        this.replying = serder.said!;
        try {
          handler(
            serder.pre!,
            payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {},
          );
        } catch (error) {
          if (!(error instanceof BootRefusal)) throw error;
          this.outcomes.set(serder.said!, { error });
        } finally {
          this.replying = undefined;
        }
      },
    });
  }

  /** SAID of the exn whose synchronous route handler is running. */
  private replying?: string;

  /** `queueReply`: boot KEL replay sn 0..n followed by one signed v2 `exn` to the requester. */
  private reply(route: string, receiver: string, payload: Record<string, unknown>): void {
    const parts: Uint8Array[] = [];
    for (let sn = 0; sn <= this.hab.kever!.sn; sn++) {
      parts.push(acceptedEventReplayMessage(this.hby, this.hab.pre, sn, Vrsn_2_0).message);
    }
    const [message] = exchange(route, payload, {
      sender: this.hab.pre,
      recipient: receiver,
      version: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
    });
    parts.push(this.hab.endorse(message, { gvrsn: Vrsn_2_0 }));
    this.outcomes.set(this.replying!, { reply: concatBytes(...parts) });
  }

  // Public listener

  /** Discovery, health and the two CESR surfaces on one public listener. */
  readonly handle: ProtocolHandler = async req => {
    const path = new URL(req.url).pathname;
    try {
      if (path === "/health" && req.method === "GET") {
        // kf-boot reports its cleanup runner; this service has none (expiry is on access only).
        return Response.json({ status: "ok", cleanup: { configured: false, expected_running: false, running: false } });
      }
      if (path === "/bootstrap/config" && req.method === "GET") return Response.json(this.discovery());
      const surface = path === this.config.onboardingPath
        ? "onboarding"
        : path === this.config.accountPath
        ? "account"
        : null;
      if (!surface) throw new BootRefusal(404);
      if (req.method === "OPTIONS") return new Response(null, { status: 200 });
      if (req.method !== "POST") throw new BootRefusal(405);
      return await this.surface(req, surface);
    } catch (error) {
      if (error instanceof BootRefusal) return error.response();
      throw error;
    }
  };

  /** `BootstrapConfigEnd`. */
  discovery(): Record<string, unknown> {
    return {
      bootstrap: {
        account_options: this.config.accountOptions.map(accountOption),
        watcher_required: this.config.watcherRequired,
      },
      region: { id: this.config.regionId, name: this.config.regionName },
      surfaces: {
        onboarding: { path: this.config.onboardingPath, url: this.config.onboardingPublicUrl },
        account: { path: this.config.accountPath, url: this.config.accountPublicUrl },
      },
    };
  }

  /** `CesrSurfaceEnd.on_post`: transport checks, ingestion and the reply or refusal. */
  private async surface(req: Request, surface: "onboarding" | "account"): Promise<Response> {
    const media = (req.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!CESR_MEDIA_TYPES.has(media)) throw new BootRefusal(406, "Content type error", "Unacceptable content type.");
    const genus = req.headers.get("CESR-Genus");
    if (genus !== null && genus !== "1" && genus !== "2") {
      throw new BootRefusal(400, undefined, "CESR-Genus must be 1 or 2");
    }
    const body = new Uint8Array(await req.arrayBuffer());
    try {
      JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new BootRefusal(400, "Malformed JSON", "Could not decode the request body. The JSON was incorrect.");
    }
    if (!req.headers.has("CESR-ATTACHMENT")) {
      throw new BootRefusal(412, "Attachment error", "Missing required attachment header.");
    }
    let serder: SerderKERI;
    try {
      serder = new SerderKERI({ raw: body });
    } catch {
      throw new BootRefusal(400, "Invalid CESR message", "The request body is not a KERI message.");
    }
    const route = serder.route ?? "";
    if (!EVENT_ILKS.has(serder.ilk ?? "")) {
      if (serder.ilk !== "exn") {
        throw new BootRefusal(
          400,
          "Unsupported message type",
          `${serder.ilk} is not supported on the ${surface} surface.`,
        );
      }
      const allowed = surface === "onboarding" ? ONBOARDING_ROUTES : ACCOUNT_ROUTES;
      if (!allowed.has(route) || !this.routes.has(route)) {
        throw new BootRefusal(
          404,
          "Unknown route",
          `${route || "<missing>"} is not available on the ${surface} surface.`,
        );
      }
      if (!this.hby.db.getKever(serder.pre!, { refresh: true })) {
        throw new BootRefusal(
          401,
          "Unknown sender key state",
          "The authenticated sender must send or precede the first business message with inception or keystate material.",
        );
      }
    }
    let frames;
    try {
      const complete = new Request(req.url, { method: "POST", headers: req.headers, body });
      frames = parseBytes(await collectBytes(requestBytes(complete)));
    } catch (error) {
      if (error instanceof ParserError || error instanceof ValidationError || error instanceof SyntaxError) {
        throw new BootRefusal(400, "Invalid CESR message", (error as Error).message);
      }
      throw error;
    }
    if (frames.length !== 1) throw new BootRefusal(400, "Invalid CESR message", "Expected one KERI message.");
    const said = frames[0].body.said!;
    try {
      await run(() => this.runtime.protocol.dispatch(frames[0], { local: false }));
    } catch (error) {
      this.outcomes.delete(said);
      if (error instanceof ValidationError) throw new BootRefusal(400, "Invalid CESR message", error.message);
      throw error;
    }
    if (EVENT_ILKS.has(serder.ilk!)) this.requireAcceptedKeystate(serder);
    const outcome = this.outcomes.get(said);
    this.outcomes.delete(said);
    if (outcome && "reply" in outcome) {
      return new Response(new Uint8Array(outcome.reply), {
        status: 200,
        headers: { "Content-Type": "application/cesr", "Cache-Control": "no-cache" },
      });
    }
    if (outcome) throw outcome.error;
    if (EVENT_ILKS.has(serder.ilk!)) {
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-cache" } });
    }
    throw new BootRefusal(401, "Request rejected", "The authenticated request was not accepted by the boot service.");
  }

  /** `_requireAcceptedKeystate`: events are usable only once accepted (fully witnessed). */
  private requireAcceptedKeystate(serder: SerderKERI): void {
    const kever = this.hby.db.getKever(serder.pre!, { refresh: true });
    const sn = Number(serder.sn ?? 0);
    if (!kever || kever.sn < sn) {
      throw new BootRefusal(
        409,
        "Key state pending",
        "The boot service has not accepted this key event yet. Submit the fully replayed event message, including required witness receipts, before sending authenticated requests.",
      );
    }
    if (kever.sn === sn && kever.serder.said !== serder.said) {
      throw new BootRefusal(
        409,
        "Key state superseded",
        "The submitted key event does not match the boot service's accepted key state.",
      );
    }
  }

  // Shared guards (`BootExchanger`)

  /** `accountOption`: only advertised profiles may start a session. */
  private option(code: unknown): { code: string; witness_count: number; toad: number } {
    const target = typeof code === "string" ? code.trim().toLowerCase() : "";
    if (!this.config.accountOptions.includes(target)) {
      throw new BootRefusal(400, "Unsupported witness profile", `Unknown account profile '${code ?? ""}'.`);
    }
    return accountOption(target);
  }

  /** `requireSession`. */
  protected requireSession(id: string): SessionRecord {
    const session = this.store.getSession(id);
    if (!session) throw new BootRefusal(404, "Session not found", `No onboarding session exists for '${id}'.`);
    return session;
  }

  /** `requireOnboardingPrincipal`: the ephemeral signer or the bound account. */
  protected requireOnboardingPrincipal(sender: string, session: SessionRecord): void {
    if (sender === session.ephemeral_aid || sender === session.account_aid) return;
    throw new BootRefusal(
      401,
      "Wrong principal",
      "The authenticated sender does not match the onboarding session principal.",
    );
  }

  /** `requireEphemeralPrincipal`. */
  protected requireEphemeralPrincipal(sender: string, session: SessionRecord): void {
    if (sender && sender === session.ephemeral_aid) return;
    throw new BootRefusal(
      401,
      "Wrong onboarding principal",
      "The authenticated sender must be the session's hidden onboarding AID.",
    );
  }

  /** `markSessionExpired`. */
  protected markSessionExpired(session: SessionRecord): void {
    const current = nowIso();
    session.state = SessionStates.expired;
    session.updated_at = current;
    session.expired_at ||= current;
    this.store.saveSession(session);
  }

  /** `requireOpenSession`: closed sessions refuse progress; completed only when allowed. */
  protected requireOpenSession(session: SessionRecord, allowCompleted = false): void {
    if (!TERMINAL_SESSION_STATES.has(session.state) && pastDue(session.expires_at)) {
      this.markSessionExpired(session);
      throw new BootRefusal(410, "Session expired");
    }
    if (session.state === SessionStates.expired) throw new BootRefusal(410, "Session expired");
    if (session.state === SessionStates.failed) {
      throw new BootRefusal(
        409,
        "Session failed",
        session.failure_reason || "The onboarding session is in a failed state.",
      );
    }
    if (session.state === SessionStates.cancelled) throw new BootRefusal(409, "Session cancelled");
    if (session.state === SessionStates.completed && !allowCompleted) throw new BootRefusal(409, "Session completed");
  }

  /** Latest provisioning operation for a session. */
  protected latestProvision(session: SessionRecord): BootOperationRecord | null {
    return this.store.listOperations({ kind: OperationKinds.sessionProvision, subject: session.session_id })[0] ?? null;
  }

  /** `sessionPayload`: the session fields, a `session` copy, allocations with boot URLs and the provision op. */
  protected sessionPayload(session: SessionRecord): Record<string, unknown> {
    const witnesses = this.store.getResources("witness", session.witness_eids).map(row => resourceToApi(row, true));
    const watcherRow = session.watcher_eid ? this.store.getResources("watcher", [session.watcher_eid])[0] : undefined;
    const payload = this.store.sessionPayload(session);
    payload.session = { ...payload };
    payload.witnesses = witnesses;
    payload.watcher = watcherRow ? resourceToApi(watcherRow, true) : null;
    payload.witness_count = session.witness_count || witnesses.length;
    payload.toad = session.toad;
    payload.region_id = session.region_id;
    payload.region_name = session.region_name;
    if (session.account_aid) payload.account_aid = session.account_aid;
    const operation = this.latestProvision(session);
    if (operation) payload.session_provision_operation = this.store.operationPayload(operation);
    return payload;
  }

  /** `replySession`. */
  protected replySession(route: string, receiver: string, session: SessionRecord): void {
    this.reply(route, receiver, this.sessionPayload(session));
  }

  /** `replyAccount`: the session payload plus its bound account. */
  protected replyAccount(route: string, receiver: string, session: SessionRecord): void {
    const payload = this.sessionPayload(session);
    const account = session.account_aid ? this.store.getAccount(session.account_aid) : null;
    if (account) payload.account = this.store.accountPayload(account);
    this.reply(route, receiver, payload);
  }

  /** Signed reply for the exn being handled. */
  protected queueReply(route: string, receiver: string, payload: Record<string, unknown>): void {
    this.reply(route, receiver, payload);
  }

  /** `ensureSessionProvisionOperation`: provisioning work until witnesses (and watcher) exist. */
  private ensureSessionProvision(session: SessionRecord, requester: string, route: string): void {
    if (session.witness_eids.length && (!session.watcher_required || session.watcher_eid)) return;
    this.store.ensureOperation({
      kind: OperationKinds.sessionProvision,
      subject: session.session_id,
      requester,
      route,
      payload: {
        session_id: session.session_id,
        account_aid: session.account_aid,
        witness_count: session.witness_count,
        watcher_required: session.watcher_required,
      },
    });
  }

  /** `findCleanupBlockingSession`: a closed session whose allocations were never reclaimed. */
  private cleanupBlockingSession(sender: string, accountAid: string): SessionRecord | null {
    const seen = new Set<string>();
    for (
      const candidate of [this.store.findSessionForAccount(accountAid), this.store.findSessionForEphemeral(sender)]
    ) {
      if (!candidate || seen.has(candidate.session_id)) continue;
      seen.add(candidate.session_id);
      if (
        [SessionStates.expired, SessionStates.failed, SessionStates.cancelled].includes(candidate.state as never)
        && !candidate.resources_cleaned_at
      ) return candidate;
    }
    return null;
  }

  /** `Admitter.reconcileExistingStartSession`: a reused session must match the request. */
  private reconcileStart(
    session: SessionRecord,
    accountAid: string,
    alias: string,
    code: string,
    regionId: string,
    watcherRequired: boolean,
  ): void {
    const mismatch = (description: string) => new BootRefusal(409, "Session parameter mismatch", description);
    if (session.state === SessionStates.failed) {
      throw new BootRefusal(
        409,
        "Session failed",
        session.failure_reason || "Blind retry would duplicate hosted resources.",
      );
    }
    if (session.state === SessionStates.cancelled || session.state === SessionStates.expired) {
      throw new BootRefusal(409, "Session closed", "The onboarding session is no longer active.");
    }
    if (session.account_aid && session.account_aid !== accountAid) {
      throw mismatch("The existing onboarding session was started with a different permanent account AID.");
    }
    if (alias && session.account_alias && session.account_alias !== alias) {
      throw mismatch("The existing onboarding session was started with a different account alias.");
    }
    if (session.chosen_profile_code && session.chosen_profile_code !== code) {
      throw mismatch("The existing onboarding session uses a different witness profile.");
    }
    if (session.region_id && session.region_id !== regionId) {
      throw mismatch("The existing onboarding session uses a different region.");
    }
    if (session.watcher_required !== watcherRequired) {
      throw mismatch("The existing onboarding session uses a different watcher requirement.");
    }
  }

  // Onboarding routes

  /** `/onboarding/session/start`: start or reuse the one active session for this account. */
  private sessionStart(sender: string, payload: Record<string, unknown>): void {
    const route = "/onboarding/session/start";
    const option = this.option(payload.chosen_profile_code ?? "");
    const accountAid = requiredStr(payload, "account_aid");
    const alias = optionalStr(payload, "account_alias");
    const regionId = optionalStr(payload, "region_id") || this.config.regionId;
    const watcherRequired = "watcher_required" in payload
      ? Boolean(payload.watcher_required)
      : this.config.watcherRequired;
    if (this.config.watcherRequired && !watcherRequired) {
      throw new BootRefusal(
        400,
        "Watcher required",
        "This boot service requires one hosted watcher per onboarded account.",
      );
    }
    const account = this.store.getAccount(accountAid);
    if (account?.status === AccountStates.onboarded) {
      throw new BootRefusal(
        409,
        "Account already onboarded",
        "The permanent account AID already completed onboarding.",
      );
    }
    let session: SessionRecord | null = null;
    let existing: SessionRecord | null = null;
    const expired = new Set<string>();
    let forAccount = this.store.findSessionForAccount(accountAid);
    if (forAccount && !TERMINAL_SESSION_STATES.has(forAccount.state) && pastDue(forAccount.expires_at)) {
      this.markSessionExpired(forAccount);
      expired.add(forAccount.session_id);
      forAccount = null;
    }
    if (forAccount && !TERMINAL_SESSION_STATES.has(forAccount.state)) {
      if (forAccount.ephemeral_aid !== sender) {
        throw new BootRefusal(
          409,
          "Account session already active",
          "A different onboarding principal already owns the active session for this account AID.",
        );
      }
      session = forAccount;
    } else {
      existing = this.store.findSessionForEphemeral(sender);
      if (existing && !TERMINAL_SESSION_STATES.has(existing.state) && pastDue(existing.expires_at)) {
        this.markSessionExpired(existing);
        existing = null;
      } else if (existing && expired.has(existing.session_id)) {
        existing = null;
      } else if (
        existing
        && [SessionStates.expired, SessionStates.failed, SessionStates.cancelled].includes(existing.state as never)
        && existing.resources_cleaned_at
      ) {
        // A closed session whose cleanup finished no longer shadows a fresh start.
        existing = null;
      }
    }
    if (existing) session = existing;
    if (!session) {
      const blocking = this.cleanupBlockingSession(sender, accountAid);
      if (blocking) {
        throw new BootRefusal(
          409,
          "Session cleanup pending",
          "The previous onboarding session is closed but its hosted resources are still being reclaimed. Retry after cleanup completes.",
        );
      }
    }
    if (session) {
      this.reconcileStart(session, accountAid, alias, option.code, regionId, watcherRequired);
    } else {
      session = this.store.createSession({
        ephemeral_aid: sender,
        account_aid: accountAid,
        account_alias: alias,
        chosen_profile_code: option.code,
        client_ip: "",
        region_id: regionId,
        region_name: this.config.regionName,
        watcher_required: watcherRequired,
        witness_count: option.witness_count,
        toad: option.toad,
        account_tier: accountTier(option.witness_count),
      });
    }
    this.ensureSessionProvision(session, sender, route);
    this.store.refreshSessionLease(session);
    this.replySession(route, sender, session);
  }

  /** `/onboarding/session/status`: readable by the ephemeral signer and the bound account. */
  private sessionStatus(sender: string, payload: Record<string, unknown>): void {
    const session = this.requireSession(requiredStr(payload, "session_id"));
    this.requireOnboardingPrincipal(sender, session);
    if (!TERMINAL_SESSION_STATES.has(session.state)) {
      if (pastDue(session.expires_at)) this.markSessionExpired(session);
      else this.store.refreshSessionLease(session);
    }
    this.replySession("/onboarding/session/status", sender, session);
  }

  /** `/onboarding/cancel`: the ephemeral signer closes an uncompleted session. */
  private cancel(sender: string, payload: Record<string, unknown>): void {
    const session = this.requireSession(requiredStr(payload, "session_id"));
    this.requireEphemeralPrincipal(sender, session);
    if (session.state === SessionStates.completed) {
      throw new BootRefusal(409, "Session completed", "A completed onboarding session cannot be cancelled.");
    }
    if (session.state !== SessionStates.cancelled) {
      const account = session.account_aid ? this.store.getAccount(session.account_aid) : null;
      session.state = SessionStates.cancelled;
      session.updated_at = nowIso();
      this.store.saveSession(session);
      if (account) {
        account.status = AccountStates.failed;
        this.store.saveAccount(account);
      }
    }
    this.replySession("/onboarding/cancel", sender, session);
  }

  /** `/operations/status`: the requester or a principal of the operation's subject may read it. */
  private operationStatus(sender: string, payload: Record<string, unknown>): void {
    const id = requiredStr(payload, "operation_id");
    const operation = this.store.getOperation(id);
    if (!operation) throw new BootRefusal(404, "Operation not found", `No boot operation exists for '${id}'.`);
    const data = operation.payload ?? {};
    let allowed = !!sender && sender === operation.requester;
    let session: SessionRecord | null = null;
    if (operation.kind === OperationKinds.sessionProvision) {
      session = this.store.getSession(String(data.session_id || operation.subject));
      allowed ||= !!session && (sender === session.ephemeral_aid || sender === session.account_aid);
    } else if (!allowed && operation.kind === OperationKinds.watcherStatusQuery) {
      const resource = this.store.getResource("watcher", String(data.watcher_id ?? ""));
      allowed = !!resource && (sender === resource.principal || sender === resource.cid);
    } else if (!allowed && operation.kind === OperationKinds.resourceDelete) {
      const resource = this.store.getResource(String(data.resource_kind ?? ""), String(data.resource_id ?? ""));
      allowed = !!resource && (sender === resource.principal || sender === resource.cid);
    } else if (!allowed && operation.kind === OperationKinds.accountDelete) {
      allowed = sender === String(data.account_aid ?? "");
    } else if (!allowed) {
      allowed = operation.subject === sender;
    }
    if (!allowed) {
      throw new BootRefusal(
        401,
        "Wrong operation principal",
        "The authenticated sender is not allowed to read this operation.",
      );
    }
    if (session && !TERMINAL_SESSION_STATES.has(session.state)) {
      this.requireOpenSession(session);
      this.store.refreshSessionLease(session);
    }
    this.queueReply("/operations/status", sender, { operation: this.store.operationPayload(operation) });
  }

  // Account creation and completion

  /** `requireSessionProvisioned`: account creation waits for the provision operation. */
  private requireSessionProvisioned(session: SessionRecord): void {
    const operation = this.latestProvision(session);
    if (operation && (operation.state === OperationStates.pending || operation.state === OperationStates.running)) {
      throw new BootRefusal(
        409,
        "Session provisioning pending",
        "Hosted resource provisioning is still in progress for this session.",
      );
    }
    if (operation?.state === OperationStates.failed) {
      throw new BootRefusal(
        409,
        "Session provisioning failed",
        operation.last_error || "Hosted resource provisioning failed for this session.",
      );
    }
  }

  /** `/onboarding/account/create`: bind the provisioned allocations to the permanent account. */
  private accountCreate(sender: string, payload: Record<string, unknown>): void {
    const route = "/onboarding/account/create";
    const session = this.requireSession(requiredStr(payload, "session_id"));
    this.requireOpenSession(session);
    this.requireEphemeralPrincipal(sender, session);
    const accountAid = requiredStr(payload, "account_aid");
    if (session.account_aid && session.account_aid !== accountAid) {
      throw new BootRefusal(
        409,
        "Session already bound",
        "This onboarding session is already bound to a different account AID.",
      );
    }
    this.requireSessionProvisioned(session);
    if (!session.witness_eids.length || (session.watcher_required && !session.watcher_eid)) {
      throw new BootRefusal(409, "Resources missing", "Witness or watcher allocation is incomplete for this session.");
    }
    let account = this.store.getAccount(accountAid);
    if (account?.status === AccountStates.expired) {
      throw new BootRefusal(
        409,
        "Account not available",
        "The permanent account AID is currently expired and cannot be reused for onboarding.",
      );
    }
    if (account && account.session_id !== "" && account.session_id !== session.session_id) {
      throw new BootRefusal(
        409,
        "Account already exists",
        "The permanent account AID is already bound to a different onboarding session.",
      );
    }
    if (
      (session.state === SessionStates.accountCreated || session.state === SessionStates.completed)
      && session.account_aid === accountAid
    ) {
      this.replyAccount(route, sender, session);
      return;
    }
    const alias = optionalStr(payload, "account_alias");
    if (!account) {
      account = new AccountRecord({
        account_aid: accountAid,
        account_alias: alias || session.account_alias,
        status: AccountStates.pendingOnboarding,
        created_at: nowIso(),
        onboarded_at: "",
        witness_profile_code: session.chosen_profile_code,
        witness_count: session.witness_count,
        toad: session.toad,
        watcher_required: session.watcher_required,
        region_id: session.region_id,
        region_name: session.region_name,
        session_id: session.session_id,
        witness_eids: [...session.witness_eids],
        watcher_eid: session.watcher_eid,
        tier: session.account_tier,
        expires_at: "",
        expired_at: "",
        resources_cleaned_at: "",
      });
    } else {
      Object.assign(account, {
        account_alias: alias || account.account_alias,
        status: AccountStates.pendingOnboarding,
        witness_eids: [...session.witness_eids],
        watcher_eid: session.watcher_eid,
        session_id: session.session_id,
        onboarded_at: "",
        expired_at: "",
        resources_cleaned_at: "",
        expires_at: "",
      });
    }
    session.account_aid = accountAid;
    session.state = SessionStates.accountCreated;
    session.updated_at = nowIso();
    this.store.saveAccount(account);
    this.store.bindResourcesToAccount(session, accountAid);
    this.store.refreshSessionLease(session);
    this.replyAccount(route, sender, session);
  }

  /** `/onboarding/complete`: idempotent, including on an already completed session (recovery). */
  private complete(sender: string, payload: Record<string, unknown>): void {
    const route = "/onboarding/complete";
    const session = this.requireSession(requiredStr(payload, "session_id"));
    this.requireOpenSession(session, true);
    this.requireEphemeralPrincipal(sender, session);
    const accountAid = requiredStr(payload, "account_aid");
    if (session.account_aid && session.account_aid !== accountAid) {
      throw new BootRefusal(
        409,
        "Session already bound",
        "This onboarding session is already bound to a different account AID.",
      );
    }
    const account = this.store.getAccount(accountAid);
    if (!account) {
      throw new BootRefusal(
        404,
        "Account not found",
        "No account record exists for the requested permanent account AID.",
      );
    }
    if (session.state === SessionStates.completed && account.status === AccountStates.onboarded) {
      this.store.refreshAccountLease(account);
      this.replyAccount(route, sender, session);
      return;
    }
    if (session.watcher_required && !session.watcher_eid) {
      Object.assign(session, {
        state: SessionStates.failed,
        updated_at: nowIso(),
        failure_reason: "Hosted watcher is required before onboarding can complete.",
      });
      this.store.saveSession(session);
      if (account.status !== AccountStates.onboarded) {
        account.status = AccountStates.failed;
        this.store.saveAccount(account);
      }
      throw new BootRefusal(
        409,
        "Watcher missing",
        "This boot service requires one hosted watcher before onboarding completes.",
      );
    }
    session.state = SessionStates.completed;
    session.updated_at = nowIso();
    account.status = AccountStates.onboarded;
    account.onboarded_at = nowIso();
    this.store.saveSession(session);
    this.store.saveAccount(account);
    this.store.refreshAccountLease(account, account.onboarded_at);
    this.replyAccount(route, sender, session);
  }

  // Account surface

  /** `requireOnboardedAccount`: the sender is an onboarded, unexpired account (expiry on access). */
  private requireOnboardedAccount(sender: string, payload: Record<string, unknown>): AccountRecord {
    const aid = optionalStr(payload, "account_aid");
    if (aid && aid !== sender) {
      throw new BootRefusal(401, "Account principal mismatch", "The authenticated sender must match account_aid.");
    }
    const account = this.store.getAccount(sender);
    if (!account) {
      throw new BootRefusal(404, "Account not found", "No account exists for the authenticated sender.");
    }
    const expired = () =>
      new BootRefusal(
        409,
        "Account expired",
        "This account has expired and must be renewed or deleted before accessing account routes.",
      );
    if (account.status === AccountStates.expired) throw expired();
    if (pastDue(account.expires_at)) {
      account.status = AccountStates.expired;
      account.expired_at ||= nowIso();
      this.store.saveAccount(account);
      throw expired();
    }
    if (account.status !== AccountStates.onboarded) {
      throw new BootRefusal(
        409,
        "Account not onboarded",
        "Approved-account routes require an onboarded account principal.",
      );
    }
    return account;
  }

  /** Pending or running deletion of this account. */
  private activeAccountDelete(aid: string): BootOperationRecord | null {
    return this.store.findActiveOperation(OperationKinds.accountDelete, `account:${aid}`, aid);
  }

  /** `requireNoAccountDeletePending`. */
  private requireNoAccountDeletePending(aid: string): void {
    if (this.activeAccountDelete(aid)) {
      throw new BootRefusal(409, "Account deletion pending", "Account deletion is already pending for this account.");
    }
  }

  /** `/account/services`: the account authorizes its own registrar/observer enrollment. */
  private accountServices(sender: string, payload: Record<string, unknown>): void {
    if (Object.keys(payload).some(key => key !== "account_aid")) {
      throw new BootRefusal(400, undefined, "services enroll only the authenticated account AID");
    }
    const account = this.requireOnboardedAccount(sender, payload);
    this.requireNoAccountDeletePending(sender);
    const services = (["registrar", "observer"] as const).filter(kind => this.config[kind] !== null);
    if (!services.length) throw new BootRefusal(503, undefined, "credential services are not configured");
    const operation = this.store.ensureOperation({
      kind: OperationKinds.accountServices,
      subject: `account:${sender}`,
      requester: sender,
      route: "/account/services",
      payload: { account_aid: sender, services },
    });
    this.store.refreshAccountLease(account);
    this.queueReply("/account/services", sender, {
      account_aid: sender,
      operation: this.store.operationPayload(operation),
    });
  }

  /** `/account/witnesses` and `/account/watchers`: the account's resource rows. */
  private accountResources(kind: "witness" | "watcher", sender: string, payload: Record<string, unknown>): void {
    const account = this.requireOnboardedAccount(sender, payload);
    const rows = this.store.listResourcesForAccount(kind, sender).map(row => resourceToApi(row));
    const deletion = this.activeAccountDelete(sender);
    this.store.refreshAccountLease(account);
    const plural = kind === "witness" ? "witnesses" : "watchers";
    const reply: Record<string, unknown> = { account_aid: sender, [plural]: rows };
    if (deletion) reply.account_delete_operation = this.store.operationPayload(deletion);
    this.queueReply(`/account/${plural}`, sender, reply);
  }

  /** The account's own resource named by `<kind>_eid` or `<kind>_id`. */
  private ownedResource(kind: "witness" | "watcher", sender: string, payload: Record<string, unknown>) {
    const id = optionalStr(payload, `${kind}_eid`) || requiredStr(payload, `${kind}_id`);
    const record = this.store.getResource(kind, id);
    if (!record || record.principal !== sender) {
      throw new BootRefusal(404, kind === "witness" ? "Witness not found" : "Watcher not found");
    }
    return { id, record };
  }

  /** `/account/watchers/status`: an operation whose result is the watcher's status JSON. */
  private watcherStatus(sender: string, payload: Record<string, unknown>): void {
    const route = "/account/watchers/status";
    const account = this.requireOnboardedAccount(sender, payload);
    this.requireNoAccountDeletePending(sender);
    const { id, record } = this.ownedResource("watcher", sender, payload);
    const watcher = resourceToApi(record);
    const deletion = this.store.findActiveOperation(OperationKinds.resourceDelete, `watcher:${id}`, sender);
    const operation = deletion ?? this.store.ensureOperation({
      kind: OperationKinds.watcherStatusQuery,
      subject: `watcher:${id}`,
      requester: sender,
      route,
      payload: { account_aid: sender, watcher_id: id },
    });
    this.store.refreshAccountLease(account);
    this.queueReply(route, sender, {
      account_aid: sender,
      watcher,
      watcher_id: id,
      operation: this.store.operationPayload(operation),
    });
  }

  /** `/account/witnesses/delete` and `/account/watchers/delete`: queue one resource deletion. */
  private resourceDelete(kind: "witness" | "watcher", sender: string, payload: Record<string, unknown>): void {
    const route = kind === "witness" ? "/account/witnesses/delete" : "/account/watchers/delete";
    const account = this.requireOnboardedAccount(sender, payload);
    this.requireNoAccountDeletePending(sender);
    const { id, record } = this.ownedResource(kind, sender, payload);
    const operation = this.store.ensureOperation({
      kind: OperationKinds.resourceDelete,
      subject: `${kind}:${id}`,
      requester: sender,
      route,
      payload: { account_aid: sender, resource_kind: kind, resource_id: id, session_id: record.session_id },
    });
    this.store.refreshAccountLease(account);
    this.queueReply(route, sender, {
      account_aid: sender,
      [`${kind}_id`]: id,
      deleted: false,
      operation: this.store.operationPayload(operation),
    });
  }

  /** `/account/delete`: onboarded, expired or failed accounts delete all resources and rows. */
  private accountDelete(sender: string, payload: Record<string, unknown>): void {
    const route = "/account/delete";
    const aid = optionalStr(payload, "account_aid");
    if (aid && aid !== sender) {
      throw new BootRefusal(401, "Account principal mismatch", "The authenticated sender must match account_aid.");
    }
    const account = this.store.getAccount(sender);
    if (
      account
      && ![AccountStates.onboarded, AccountStates.expired, AccountStates.failed].includes(account.status as never)
    ) {
      throw new BootRefusal(
        409,
        "Account not onboarded",
        "Approved-account routes require an onboarded account principal.",
      );
    }
    if (!account) {
      const latest = this.store.listOperations({
        kind: OperationKinds.accountDelete,
        subject: `account:${sender}`,
        requester: sender,
      })[0];
      const reply: Record<string, unknown> = { account_aid: sender, deleted: true };
      if (latest) reply.operation = this.store.operationPayload(latest);
      this.queueReply(route, sender, reply);
      return;
    }
    const operation = this.store.ensureOperation({
      kind: OperationKinds.accountDelete,
      subject: `account:${sender}`,
      requester: sender,
      route,
      payload: { account_aid: sender },
    });
    this.queueReply(route, sender, {
      account_aid: sender,
      deleted: false,
      operation: this.store.operationPayload(operation),
    });
  }

  // Operation worker (`operating.py`)

  /** Drive due operations until halted; claimed work from a previous process is requeued first. */
  *work(intervalMs = 50): Operation<void> {
    this.store.requeueClaimedOperations();
    while (true) {
      let operation: BootOperationRecord | null;
      while ((operation = this.store.claimDueOperation())) yield* this.process(operation);
      yield* sleep(intervalMs);
    }
  }

  /** Run one claimed operation and record success, retry or permanent failure. */
  private *process(operation: BootOperationRecord): Operation<void> {
    try {
      const result = yield* this.perform(operation);
      this.store.succeedOperation(operation.operation_id, result);
    } catch (error) {
      if (!(error instanceof BootApiError)) {
        this.store.failOperation(operation.operation_id, (error as Error)?.message ?? String(error));
        console.error("Boot operation failed unexpectedly", error);
        return;
      }
      const status = error.status;
      const exhausted = operation.attempt_count >= this.config.operationFailureMaxAttempts;
      const retryable = !exhausted && (status === null || status >= 500 || [408, 425, 429].includes(status));
      if (!retryable) {
        this.store.failOperation(operation.operation_id, error.message, status === null ? {} : { status_code: status });
        return;
      }
      const delay = Math.min(5 * 2 ** Math.max(operation.attempt_count - 1, 0), 300);
      this.store.rescheduleOperation(operation.operation_id, nowIso(Date.now() + delay * 1000), error.message);
    }
  }

  /** Dispatch one operation by kind (`BootOperationProcessor`). */
  protected *perform(operation: BootOperationRecord): Operation<Record<string, unknown>> {
    if (operation.kind === OperationKinds.sessionProvision) {
      const id = String(operation.payload.session_id || operation.subject);
      if (!this.store.getSession(id)) throw bootError(`Session '${id}' was not found.`, 404);
      return yield* this.provisionSession(id, operation.operation_id);
    }
    const data = operation.payload;
    if (operation.kind === OperationKinds.accountServices) {
      const aid = String(data.account_aid ?? "");
      if (!aid || operation.requester !== aid) {
        throw bootError("Service operation must belong to its enrolled account", 400);
      }
      return yield* this.provisionAccountServices(aid, data.services, operation.operation_id);
    }
    if (operation.kind === OperationKinds.watcherStatusQuery) {
      return yield* this.watcherStatusQuery(String(data.watcher_id ?? ""));
    }
    if (operation.kind === OperationKinds.resourceDelete) {
      const kind = String(data.resource_kind ?? ""), id = String(data.resource_id ?? "");
      if ((kind !== "witness" && kind !== "watcher") || !id) {
        throw bootError("Resource delete operation is missing a valid resource subject.", 400);
      }
      const aid = String(data.account_aid ?? "");
      const sessionId = String(data.session_id || this.store.getResource(kind, id)?.session_id || "");
      yield* this.deleteHostedResource(kind, id, {
        session: sessionId ? this.store.getSession(sessionId) : null,
        account: aid ? this.store.getAccount(aid) : null,
      });
      return { kind, eid: id, deleted: true };
    }
    if (operation.kind === OperationKinds.accountDelete) {
      return yield* this.deleteAccount(String(data.account_aid ?? ""));
    }
    throw bootError(`Unsupported boot operation kind '${operation.kind}'.`, 400);
  }

  /** Re-check service eligibility around every backend call (`_serviceAccount`). */
  private serviceAccount(aid: string): AccountRecord {
    try {
      const account = this.requireOnboardedAccount(aid, {});
      this.requireNoAccountDeletePending(aid);
      return account;
    } catch (error) {
      if (error instanceof BootRefusal) throw bootError(error.description ?? error.title, error.status);
      throw error;
    }
  }

  /** Registry admin client for a retained enrollment's boot URL. */
  private registryAdmin(bootUrl: string): RegistryAdmin {
    return new RegistryAdmin(bootUrl, this.http, this.config.bootApiTimeoutSeconds * 1000);
  }

  /**
   * `provisionAccountServicesDo`: enroll the account's accepted public KEL (delegation
   * chain, then KEL) with each configured service and require the exact acknowledgement.
   */
  private *provisionAccountServices(
    aid: string,
    services: unknown,
    operationId: string,
  ): Operation<Record<string, unknown>> {
    if (
      !Array.isArray(services) || !services.length || new Set(services).size !== services.length
      || services.some(kind => kind !== "registrar" && kind !== "observer")
    ) throw bootError("Invalid credential-service selection", 400);
    let account = this.serviceAccount(aid);
    const kever = this.hby.db.getKever(aid, { refresh: true });
    if (!kever) throw bootError("Accepted account KEL is unavailable", 409);
    const kel = new TextDecoder().decode(concatBytes(
      ...this.hby.db.cloneDelegation(kever, Vrsn_2_0),
      ...this.hby.db.clonePreIter(aid, 0, Vrsn_2_0),
    ));
    const capabilities: Record<string, unknown> = {};
    for (const kind of services as ("registrar" | "observer")[]) {
      account = this.serviceAccount(aid);
      const backend = this.config[kind];
      if (!backend) throw bootError(`${kind} is no longer configured`, 409);
      const role = kind === "registrar" ? "publisher" : "reader";
      let record = this.store.getResource(kind, aid);
      if (
        record && (record.principal !== aid || record.cid !== aid || record.boot_url !== backend.bootUrl
          || record.url !== backend.publicUrl || record.service_aid !== backend.serviceAid
          || record.ca_pem !== backend.caPem)
      ) throw bootError("Retained service activation differs from configured backend", 409);
      record ??= new ResourceRecord({
        kind,
        eid: aid,
        backend_id: kind,
        cid: aid,
        principal: aid,
        session_id: "",
        name: "",
        identifier_alias: "",
        region_id: "",
        region_name: "",
        url: backend.publicUrl,
        boot_url: backend.bootUrl,
        public_host: "",
        public_port: null,
        oobis: [],
        status: "pending",
        created_at: nowIso(),
        service_aid: backend.serviceAid,
        ca_pem: backend.caPem,
      });
      // Record cleanup debt before the remote side effect, including a lost response.
      this.store.saveResource(record);
      if (account.resources_cleaned_at) {
        account.resources_cleaned_at = "";
        this.store.saveAccount(account);
      }
      let accepted;
      try {
        accepted = yield* this.registryAdmin(record.boot_url).enroll(aid, [role], kel, {
          idempotencyKey: `${operationId}:${kind}`,
        });
      } catch (error) {
        // Signed operation status must not expose private backend URLs or response bodies.
        if (error instanceof BootApiError) throw bootError(`${kind} account enrollment failed`, error.status);
        throw error;
      }
      this.serviceAccount(aid);
      if (
        accepted.aid !== aid || accepted.roles.length !== 1 || accepted.roles[0] !== role
        || accepted.service !== record.service_aid
      ) throw bootError("Credential-service activation acknowledgement differs from request", 409);
      record.status = "active";
      this.store.saveResource(record);
      capabilities[kind] = { aid, roles: [role], service: record.service_aid, url: record.url, ca_pem: record.ca_pem };
    }
    this.serviceAccount(aid);
    return { account_aid: aid, services: capabilities };
  }

  /** `operating.py` watcher status: the backend JSON plus the derived resource status. */
  private *watcherStatusQuery(id: string): Operation<Record<string, unknown>> {
    if (!id) throw bootError("Watcher status operation is missing watcher_id.", 400);
    const record = this.store.getResource("watcher", id);
    if (!record) throw bootError(`Watcher '${id}' was not found.`, 404);
    const status = yield* this.watcherAdmin.status(id);
    let derived = "";
    if (typeof status.status === "string" && status.status) derived = status.status;
    else if (status.summary && typeof status.summary === "object") {
      const summary = status.summary as Record<string, unknown>;
      const total = Number(summary.total_witnesses || 0), responsive = Number(summary.responsive_witnesses || 0);
      if (total > 0 && responsive >= total) derived = "connected";
      else if (total > 0 && responsive <= 0) derived = "disconnected";
      else if (total > 0) derived = "query_pending";
    }
    if (derived) {
      const current = this.store.getResource("watcher", id) ?? record;
      current.status = derived;
      this.store.saveResource(current);
    }
    return status;
  }

  /** `_stopServiceActivation`: cancel queued enrollment; a running one must finish first (425). */
  private stopServiceActivation(aid: string): void {
    if (!aid) return;
    let running = false;
    for (
      const operation of this.store.listOperations({
        kind: OperationKinds.accountServices,
        subject: `account:${aid}`,
        requester: aid,
      })
    ) {
      if (operation.state === OperationStates.pending) {
        this.store.failOperation(operation.operation_id, "Account cleanup cancelled pending service activation", {
          status_code: 409,
        });
      } else if (operation.state === OperationStates.running) running = true;
    }
    if (running) throw bootError("Account service activation is still running", 425);
  }

  /** `deleteHostedResourceDo`: delete remotely (404 tolerated), then forget the row and owners' references. */
  private *deleteHostedResource(
    kind: string,
    eid: string,
    owners: { session?: SessionRecord | null; account?: AccountRecord | null },
  ): Operation<void> {
    if (!eid) return;
    const record = this.store.getResource(kind, eid);
    if (record) {
      try {
        if (kind === "witness") {
          const backend = this.config.witnessBackends.find(item => item.id === record.backend_id)
            ?? this.config.witnessBackends.find(item => item.bootUrl === record.boot_url)
            ?? (this.config.witnessBackends.length === 1 ? this.config.witnessBackends[0] : undefined);
          if (!backend) throw bootError(`Witness backend for '${eid}' is not configured.`, 503);
          yield* this.witnessAdmin(backend.id).remove(eid);
        } else if (kind === "watcher") {
          yield* this.watcherAdmin.remove(eid);
        } else if (kind === "registrar" || kind === "observer") {
          if (record.eid !== record.principal || record.cid !== record.principal) {
            throw bootError("Credential-service enrollment has inconsistent account coordinates", 409);
          }
          this.stopServiceActivation(record.principal);
          try {
            yield* this.registryAdmin(record.boot_url).remove(eid);
          } catch (error) {
            if (error instanceof BootApiError && error.status !== 404) {
              throw bootError(`${kind} account revocation failed`, error.status);
            }
            if (!(error instanceof BootApiError)) throw error;
          }
        } else throw bootError("Unsupported resource kind", 400);
      } catch (error) {
        if (!(error instanceof BootApiError && error.status === 404)) throw error;
      }
      this.store.deleteResource(kind, eid);
    }
    const { session, account } = owners;
    if (session) {
      if (kind === "witness") session.witness_eids = session.witness_eids.filter(item => item !== eid);
      else if (kind === "watcher" && session.watcher_eid === eid) session.watcher_eid = "";
      session.updated_at = nowIso();
      this.store.saveSession(session);
    }
    if (account) {
      if (kind === "witness") account.witness_eids = account.witness_eids.filter(item => item !== eid);
      else if (kind === "watcher" && account.watcher_eid === eid) account.watcher_eid = "";
      this.store.saveAccount(account);
    }
  }

  /** `deleteAccountDo`: revoke services, delete watchers then witnesses, then forget account and sessions. */
  private *deleteAccount(aid: string): Operation<Record<string, unknown>> {
    if (!aid) throw bootError("Account delete operation is missing account_aid.", 400);
    const account = this.store.getAccount(aid);
    this.stopServiceActivation(aid);
    const sessions = this.store.listSessionsForAccount(aid);
    const ids = (kind: "witness" | "watcher") => {
      const candidates: string[] = [];
      if (kind === "witness") {
        candidates.push(...(account?.witness_eids ?? []), ...sessions.flatMap(session => session.witness_eids));
      } else {
        candidates.push(account?.watcher_eid ?? "", ...sessions.map(session => session.watcher_eid));
      }
      candidates.push(...this.store.listResourcesForAccount(kind, aid).map(row => row.eid));
      for (const session of sessions) {
        candidates.push(...this.store.listResourcesForSession(kind, session.session_id).map(row => row.eid));
      }
      return [...new Set(candidates.filter(Boolean))];
    };
    const operations: [string, string][] = [
      ...(["registrar", "observer"] as const).flatMap(kind =>
        this.store.listResourcesForAccount(kind, aid).map(row => [kind, row.eid] as [string, string])
      ),
      ...ids("watcher").map(eid => ["watcher", eid] as [string, string]),
      ...ids("witness").map(eid => ["witness", eid] as [string, string]),
    ];
    const errors: BootApiError[] = [];
    for (const [kind, eid] of operations) {
      try {
        yield* this.deleteHostedResource(kind, eid, { account });
      } catch (error) {
        if (!(error instanceof BootApiError)) throw error;
        errors.push(error);
      }
    }
    if (errors.length) throw bootError(errors.map(error => error.message).join("; "), errors[0].status);
    this.store.deleteAccount(aid);
    for (const session of sessions) this.store.deleteSession(session.session_id);
    return { account_aid: aid, deleted: true, session_ids: sessions.map(session => session.session_id) };
  }

  /** `_terminalProvisionResult`: stop provisioning a closed session. */
  private terminalProvision(session: SessionRecord): Record<string, unknown> | null {
    if (!TERMINAL_SESSION_STATES.has(session.state)) return null;
    if (session.state === SessionStates.failed) {
      throw bootError(session.failure_reason || "The onboarding session is in a failed state.", 409);
    }
    if (session.state === SessionStates.cancelled) throw bootError("The onboarding session was cancelled.", 409);
    if (session.state === SessionStates.expired) throw bootError("The onboarding session has expired.", 410);
    return this.provisionResult(session);
  }

  /** Provision operation result. */
  private provisionResult(session: SessionRecord): Record<string, unknown> {
    return {
      session_id: session.session_id,
      state: session.state,
      witness_eids: [...session.witness_eids],
      watcher_eid: session.watcher_eid,
    };
  }

  /** `_selectWitnessBackends`: `count` distinct backends starting at a session-seeded offset. */
  private selectWitnessBackends(count: number, seed: string): WitnessBackend[] {
    const ordered = [...this.config.witnessBackends].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (count > ordered.length) {
      throw bootError(
        `Session requires ${count} witness backends, but only ${ordered.length} are configured.`,
        503,
      );
    }
    if (count <= 0) return [];
    const digest = blake2b(new TextEncoder().encode(seed), { dkLen: 8 });
    const start = Number(digest.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n) % BigInt(ordered.length));
    return Array.from({ length: count }, (_, index) => ordered[(start + index) % ordered.length]);
  }

  /** `_plannedWitnessBackends`: select once and persist the plan on the session. */
  private plannedWitnessBackends(session: SessionRecord): WitnessBackend[] {
    if (session.witness_backend_ids.length) {
      if (session.witness_backend_ids.length !== session.witness_count) {
        throw bootError("Session witness backend selection does not match the configured witness count.", 503);
      }
      return session.witness_backend_ids.map(id => {
        const backend = this.config.witnessBackends.find(item => item.id === id);
        if (!backend) throw bootError(`Witness backend '${id}' is not configured.`, 503);
        return backend;
      });
    }
    const backends = this.selectWitnessBackends(session.witness_count, session.session_id);
    session.witness_backend_ids = backends.map(backend => backend.id);
    session.updated_at = nowIso();
    this.store.saveSession(session);
    return backends;
  }

  /** Witness admin client for one configured backend. */
  protected witnessAdmin(id: string): WitnessAdmin {
    const admin = this.witnessAdmins.get(id);
    if (!admin) throw bootError(`Witness backend '${id}' is not configured.`, 503);
    return admin;
  }

  /**
   * `provisionSessionResourcesDo`: allocate witnesses one by one across distinct planned
   * backends, recording each before the next, then one watcher introduced to the first
   * witness OOBI. The session is re-read after every backend call because requests may
   * have closed it meanwhile.
   */
  private *provisionSession(id: string, operationId: string): Operation<Record<string, unknown>> {
    let session = this.store.getSession(id)!;
    let terminal = this.terminalProvision(session);
    if (terminal) return terminal;
    if (session.witness_count - session.witness_eids.length > 0) {
      const planned = this.plannedWitnessBackends(session);
      for (let index = session.witness_eids.length; index < planned.length; index++) {
        const backend = planned[index];
        const created: ServiceAllocation = yield* this.witnessAdmin(backend.id).allocate(session.account_aid, {
          idempotencyKey: `${operationId}:witness:${backend.id}:${index}`,
        });
        session = this.store.getSession(id) ?? session;
        this.store.saveResource(makeResource({
          kind: "witness",
          eid: created.eid,
          backend_id: backend.id,
          session_id: id,
          name: `witness-${index + 1}`,
          identifier_alias: session.account_alias,
          region_id: session.region_id,
          region_name: session.region_name,
          public_url: backend.publicUrl,
          boot_url: backend.bootUrl,
          oobis: created.oobis,
          status: "allocated",
        }));
        terminal = this.terminalProvision(this.clearCleanupMark(session));
        if (terminal) return terminal;
        if (!session.witness_eids.includes(created.eid)) session.witness_eids.push(created.eid);
        session.updated_at = nowIso();
        this.store.saveSession(session);
      }
      session = this.store.getSession(id) ?? session;
      terminal = this.terminalProvision(session);
      if (terminal) return terminal;
      session.state = SessionStates.witnessPoolAllocated;
      session.updated_at = nowIso();
      this.store.saveSession(session);
    }
    session = this.store.getSession(id) ?? session;
    terminal = this.terminalProvision(session);
    if (terminal) return terminal;
    if (session.watcher_required && !session.watcher_eid) {
      const first = this.store.getResource("witness", session.witness_eids[0]);
      const created = yield* this.watcherAdmin.allocate(session.account_aid, {
        oobi: first?.oobis[0],
        idempotencyKey: `${operationId}:watcher`,
      });
      session = this.store.getSession(id) ?? session;
      this.store.saveResource(makeResource({
        kind: "watcher",
        eid: created.eid,
        session_id: id,
        name: "watcher",
        identifier_alias: session.account_alias,
        region_id: session.region_id,
        region_name: session.region_name,
        public_url: this.config.watcherPublicUrl,
        boot_url: this.config.watcherBootUrl,
        oobis: created.oobis,
        status: "created",
      }));
      terminal = this.terminalProvision(this.clearCleanupMark(session));
      if (terminal) return terminal;
      session.watcher_eid = created.eid;
      session.updated_at = nowIso();
      this.store.saveSession(session);
    }
    return this.provisionResult(session);
  }

  /** A closed session that gained a new allocation owes cleanup again. */
  private clearCleanupMark(session: SessionRecord): SessionRecord {
    if (TERMINAL_SESSION_STATES.has(session.state) && session.resources_cleaned_at) {
      session.resources_cleaned_at = "";
      session.updated_at = nowIso();
      this.store.saveSession(session);
    }
    return session;
  }
}

// ---------------------------------------------------------------------------
// Runtime

/** Store identity and configuration for one boot service process. */
export interface BootServiceOptions {
  name: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  config: BootServiceConfig;
  /** Backend HTTP owner; defaults to native fetch. */
  http?: HttpClient;
}

/** KRAM windows of kf-boot's `DEFAULT_KRAM_CONFIG` for all messages and for `exn`. */
const KRAM_WINDOWS = [1000, 5000, 5000, 86400000, 5000, 5000, 86400000] as const;

/**
 * Open (or incept) the boot-server habitat, then serve until halted.
 *
 * The boot hab is transferable 1-of-1 (`app.py`), named by `bootHabName`. Shutdown stops
 * the listener and joins in-flight requests, then the worker, runtime and stores.
 */
export function* runBootService(options: BootServiceOptions): Operation<void> {
  const { config } = options;
  let hby: Habery | undefined, runtime: AgentRuntime | undefined;
  let worker: Task<void> | undefined, operations: Task<void> | undefined;
  const db = new BootServiceBaser({ name: options.name, base: options.base, headDirPath: options.headDirPath });
  const requests = new Set<Promise<Response>>();
  try {
    hby = yield* createHabery({
      name: options.name,
      base: options.base,
      headDirPath: options.headDirPath,
      bran: options.passcode,
      skipConfig: true,
      skipSignator: true,
    });
    const hab = hby.habByName(config.bootHabName)
      ?? hby.makeHab(config.bootHabName, undefined, {
        transferable: true,
        isith: "1",
        icount: 1,
        nsith: "1",
        ncount: 1,
      });
    runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      enableMailboxStore: false,
      kram: { enabled: true, denials: [], caches: { "~": [...KRAM_WINDOWS], exn: [...KRAM_WINDOWS] } },
    });
    if (!(yield* db.reopen())) throw new ValidationError("Boot service store could not open");
    const service = new BootService(config, hby, hab, runtime, db, options.http ?? new FetchHttpClient());
    const active = runtime;
    worker = yield* spawn(() => runAgentRuntime(active, { hab, pollMailbox: false }));
    operations = yield* spawn(() => service.work());
    let stopping = false;
    const tracked: ProtocolHandler = req => {
      if (stopping) return Promise.resolve(new Response("Service is stopping", { status: 503 }));
      const pending = service.handle(req);
      requests.add(pending);
      void pending.then(() => requests.delete(pending), () => requests.delete(pending));
      return pending;
    };
    const drain = function*(): Operation<void> {
      stopping = true;
      yield* call(() => Promise.allSettled([...requests]));
    };
    yield* startServer(
      config.port,
      consoleLogger,
      undefined,
      { hostname: config.host, protocolHandler: tracked },
      drain,
    );
  } finally {
    yield* call(() => Promise.allSettled([...requests]));
    if (operations) yield* operations.halt();
    if (worker) yield* worker.halt();
    if (runtime) yield* runtime.close();
    yield* db.close();
    if (hby) yield* hby.close();
  }
}
