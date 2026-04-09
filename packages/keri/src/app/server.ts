/**
 * Shared HTTP host adapters for protocol routing.
 *
 * This module owns transport startup, Node/Web request bridging, and shutdown
 * lifecycle. Path semantics live in `protocol-handler.ts` so Deno/Node hosting
 * stays separate from mailbox, witness, and OOBI request policy.
 *
 * Maintainer rule:
 * - if the question is "how do we listen, bridge requests, or stop cleanly?"
 *   it belongs here
 * - if the question is "which protocol surface should handle this request?"
 *   it belongs in `protocol-handler.ts`
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { action, type Operation } from "npm:effection@^3.6.0";
import { consoleLogger, type Logger } from "../core/logger.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import type { Hab } from "./habbing.ts";
import { createProtocolHandler, type ProtocolHandler } from "./protocol-handler.ts";

/** Minimal shutdown/wait contract shared by Deno and Node server hosts. */
interface RunningServer {
  readonly finished: Promise<void>;
}

/** Started HTTP host plus the cleanup handle that owns its shutdown boundary. */
interface ServerHost {
  readonly server: RunningServer;
  close(): void;
}
/** Host-agnostic server startup inputs used by both runtime adapters. */
interface ServerOptions {
  port: number;
  hostname: string;
  signal: AbortSignal;
  onListen: (address: { port: number }) => void;
  onError: (error: unknown) => Response;
}

/**
 * Runtime-hosting options that scope one long-lived protocol host.
 *
 * These inputs intentionally describe *hosting policy*, not HTTP route
 * semantics. `protocol-handler.ts` consumes them to decide which locally hosted
 * AIDs and protocol surfaces are visible through this listener.
 */
export interface RuntimeServerOptions {
  /** Concrete local listen host passed to the HTTP server implementation. */
  hostname?: string;
  /**
   * Local habitat used to interpret runtime-owned cue semantics for inbound
   * request processing.
   *
   * Typical use:
   * - a mailbox or agent-style host may need one designated service habitat to
   *   turn runtime cues into wire emissions and mailbox side effects
   */
  serviceHab?: Hab;
  /**
   * Optional subset of local prefixes whose advertised endpoints are hosted by
   * this process. When omitted, all local prefixes remain visible.
   *
   * This is the explicit answer to "which local AIDs are reachable through this
   * one listener?" It does not create multiple servers; it filters hosted
   * identity exposure within one server.
   */
  hostedPrefixes?: readonly string[];
  /**
   * Optional hosted witness habitat that enables witness-specific surfaces such
   * as `/receipts` and `/query`.
   *
   * When present, `protocol-handler.ts` may also route ordinary hosted witness
   * root ingress through the witness-local settlement seam for KERIpy parity.
   */
  witnessHab?: Hab;
  /**
   * Optional callback fired only after the underlying HTTP host has bound and
   * is listening on the configured port.
   */
  onListen?: (address: { port: number; hostname: string }) => void;
}

/**
 * Detect whether the current runtime can host directly via `Deno.serve()`.
 *
 * The npm build still carries a Deno shim object, so this must check the
 * actual function presence rather than assuming `globalThis.Deno` means
 * "native Deno host available".
 */
function hasDenoServe(): boolean {
  return typeof Deno.serve === "function";
}

/**
 * Normalize startup options common to both HTTP host implementations.
 *
 * This keeps logging/error policy in one place so host selection only changes
 * transport mechanics, not externally visible behavior.
 */
function buildServerOptions(
  port: number,
  logger: Logger,
  signal: AbortSignal,
  hostname = "127.0.0.1",
  onListen?: (address: { port: number; hostname: string }) => void,
): ServerOptions {
  return {
    port,
    hostname,
    signal,
    onListen: ({ port }) => {
      logger.info(`Server running on http://${hostname}:${port}`);
      onListen?.({ port, hostname });
    },
    onError: (error) => {
      logger.error("Server error:", error);
      return new Response("Internal Server Error", { status: 500 });
    },
  };
}

/**
 * Open the native Deno HTTP host.
 *
 * Shutdown ownership stays with the shared abort signal, so the local `close()`
 * hook is intentionally a no-op.
 */
function openDenoServerHost(
  options: ServerOptions,
  handler: ProtocolHandler,
): ServerHost {
  const server = Deno.serve(options, handler);
  return {
    server: {
      finished: server.finished,
    },
    close() {
      // The abort signal passed to `Deno.serve()` owns shutdown.
    },
  };
}

/**
 * Copy one Node header entry into the Web `Headers` object.
 *
 * Node exposes repeated headers as arrays while the request handler expects
 * Fetch-style `Headers`, so this helper preserves multiplicity without leaking
 * Node-specific branching into request conversion.
 */
function appendNodeHeader(
  headers: Headers,
  key: string,
  value: string | string[] | undefined,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      headers.append(key, item);
    }
    return;
  }
  if (value !== undefined) {
    headers.set(key, value);
  }
}

/**
 * Convert one Node incoming request into the Fetch `Request` shape consumed by
 * the shared protocol handler.
 *
 * The important invariant is that body-bearing methods expose a web stream plus
 * `duplex: "half"` so Node's Fetch implementation accepts the bridged body.
 */
function toNodeRequest(
  req: IncomingMessage,
  options: ServerOptions,
): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    appendNodeHeader(headers, key, value);
  }

  const method = req.method ?? "GET";
  const host = req.headers.host ?? `${options.hostname}:${options.port}`;
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }

  return new Request(`http://${host}${req.url ?? "/"}`, init);
}

/**
 * Flush one Fetch `Response` back onto Node's `ServerResponse`.
 *
 * This is the reverse side of `toNodeRequest()`: keep all Node/Web stream
 * bridging here so protocol code can stay Fetch-native.
 */
async function writeNodeResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const stream = Readable.fromWeb(
    response.body as unknown as NodeReadableStream<Uint8Array>,
  );
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    res.on("error", reject);
    res.on("finish", () => resolve());
    stream.pipe(res);
  });
}

/**
 * Execute the shared protocol handler for one Node request and guarantee that a
 * concrete HTTP response is written even when the handler throws.
 */
async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
  handler: ProtocolHandler,
): Promise<void> {
  try {
    const response = await handler(toNodeRequest(req, options));
    await writeNodeResponse(res, response);
  } catch (error) {
    const fallback = options.onError(error);
    await writeNodeResponse(res, fallback);
  }
}

/**
 * Open the Node fallback host used by the npm build when `Deno.serve()` is not
 * available.
 *
 * Lifecycle contract:
 * - startup emits the same listen callback shape as the Deno host
 * - shutdown is driven by the shared abort signal from `openServerHost()`
 * - `finished` resolves on close so Effection can wait on one unified contract
 */
function openNodeServerHost(
  options: ServerOptions,
  handler: ProtocolHandler,
): ServerHost {
  const server = createServer((req, res) => {
    void handleNodeRequest(req, res, options, handler);
  });
  const onAbort = () => {
    void new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }).catch(() => {
      // Ignore shutdown races during abort-driven cleanup.
    });
  };

  options.signal.addEventListener("abort", onAbort, { once: true });
  const finished = new Promise<void>((resolve, reject) => {
    server.once("close", resolve);
    server.once("error", reject);
  });

  server.listen(options.port, options.hostname, () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null
      ? address.port
      : options.port;
    options.onListen({ port });
  });

  return {
    server: { finished },
    close() {
      options.signal.removeEventListener("abort", onAbort);
      if (server.listening) {
        server.close();
      }
    },
  };
}

/**
 * Start the protocol HTTP host and return its shutdown handle.
 *
 * Ownership split:
 * - this function chooses the concrete transport host for the current runtime
 * - `createProtocolHandler()` owns route semantics
 * - `waitForServerFinished()` adapts host lifetime back into Effection
 *
 * This keeps host-construction side effects separate from the `server.finished`
 * wait path so the promise boundary is explicit and local.
 *
 * Important invariant:
 * - this function should not grow request-routing policy again
 * - its only protocol-aware step is wiring the already-built
 *   `createProtocolHandler(...)` into the chosen transport host
 */
function openServerHost(
  port: number,
  logger: Logger,
  runtime?: AgentRuntime,
  options: RuntimeServerOptions = {},
): ServerHost {
  const controller = new AbortController();
  const { signal } = controller;
  const shutdown = () => {
    logger.info("Shutting down server...");
    controller.abort();
  };
  const serverOptions = buildServerOptions(
    port,
    logger,
    signal,
    options.hostname ?? "127.0.0.1",
    options.onListen,
  );
  const handler = createProtocolHandler(runtime, options);
  const host = hasDenoServe()
    ? openDenoServerHost(serverOptions, handler)
    : openNodeServerHost(serverOptions, handler);

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  return {
    server: host.server,
    close() {
      Deno.removeSignalListener("SIGINT", shutdown);
      Deno.removeSignalListener("SIGTERM", shutdown);
      host.close();
      controller.abort();
    },
  };
}

/** Adapt `server.finished` into an Effection operation. */
function* waitForServerFinished(
  server: RunningServer,
): Operation<void> {
  yield* action((resolve, reject) => {
    server.finished.then(resolve).catch(reject);
    return () => {};
  });
}

/**
 * Start the protocol-facing HTTP host for the shared `AgentRuntime`.
 *
 * Current Gate E surface:
 * - `GET /health`
 * - `GET /.well-known/keri/oobi/{aid}`
 * - `GET /oobi`
 * - `GET /oobi/{aid}`
 * - `GET /oobi/{aid}/{role}/{eid?}`
 *
 * Security/runtime model:
 * - this is intentionally protocol-only and does not expose a localhost admin
 *   API for CLI mutation
 * - OOBI responses are served from local `Hab.replyToOobi()` state when a
 *   runtime is supplied
 *
 * Shutdown model:
 * - the returned Effection operation blocks until the underlying `Deno.serve`
 *   instance stops
 * - halting the operation aborts the server and removes signal handlers
 *
 * Architectural role:
 * - this is the outermost composition point for a long-lived protocol host
 * - it does not know mailbox, witness, or OOBI precedence itself
 * - that separation is what keeps Node/Deno transport code reviewable and lets
 *   protocol behavior evolve without re-threading host adapters
 */
export function* startServer(
  port: number = 8000,
  logger: Logger = consoleLogger,
  runtime?: AgentRuntime,
  options: RuntimeServerOptions = {},
): Operation<void> {
  const host = openServerHost(port, logger, runtime, options);
  try {
    yield* waitForServerFinished(host.server);
  } finally {
    host.close();
  }
}
