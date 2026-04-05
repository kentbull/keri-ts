import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { action, type Operation } from "npm:effection@^3.6.0";
import {
  type CesrMessage,
  createParser,
  Ilks,
  parseSerder,
  type SerderKERI,
  type Smellage,
} from "../../../cesr/mod.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import { normalizeMbxTopicCursor } from "../core/mailbox-topics.ts";
import { Roles } from "../core/roles.ts";
import type { AgentRuntime } from "./agent-runtime.ts";

/** Minimal shutdown/wait contract shared by Deno and Node server hosts. */
interface RunningServer {
  readonly finished: Promise<void>;
}

/** Started HTTP host plus the cleanup handle that owns its shutdown boundary. */
interface ServerHost {
  readonly server: RunningServer;
  close(): void;
}

type ProtocolHandler = (req: Request) => Promise<Response>;

/** Host-agnostic server startup inputs used by both runtime adapters. */
interface ServerOptions {
  port: number;
  hostname: string;
  signal: AbortSignal;
  onListen: (address: { port: number }) => void;
  onError: (error: unknown) => Response;
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
 * Build the protocol request handler shared by both the Deno and Node hosts.
 *
 * Maintainer boundary:
 * - keep all route semantics here so Deno and Node serve the exact same API
 * - keep host/runtime adaptation out of this function
 * - return a plain promise-backed handler because both `Deno.serve()` and the
 *   Node adapter expect ordinary async request callbacks, not Effection ops
 */
function createProtocolHandler(
  runtime?: AgentRuntime,
): ProtocolHandler {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return new Response("ok", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      if (runtime) {
        const parts = url.pathname.split("/").filter((part) => part.length > 0);
        let aid: string | undefined;
        let role: string | undefined;
        let eid: string | undefined;

        if (
          parts.length >= 4
          && parts[0] === ".well-known"
          && parts[1] === "keri"
          && parts[2] === "oobi"
        ) {
          aid = parts[3];
          role = Roles.controller;
        } else if (parts[0] === "oobi") {
          aid = parts[1];
          role = parts[2];
          eid = parts[3];
        }

        if (aid && role) {
          const hab = runtime.hby.habs.get(aid);
          if (!hab) {
            return new Response("Not Found", {
              status: 404,
              headers: { "Content-Type": "text/plain" },
            });
          }
          const msgs = hab.replyToOobi(aid, role, eid ? [eid] : []);
          if (msgs.length === 0) {
            return new Response("Not Found", {
              status: 404,
              headers: { "Content-Type": "text/plain" },
            });
          }
          const body = msgs.slice().buffer as ArrayBuffer;
          return new Response(new Blob([body]), {
            status: 200,
            headers: {
              "Content-Type": "application/cesr",
              "Oobi-Aid": aid,
            },
          });
        }
      }

      if (runtime && (req.method === "POST" || req.method === "PUT")) {
        const bytes = new Uint8Array(await req.arrayBuffer());
        const serder = inspectCesrRequest(bytes);
        if (!serder) {
          return new Response("Invalid CESR request", {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          });
        }

        runtime.reactor.ingest(bytes);
        runtime.reactor.processOnce();
        runtime.reactor.processEscrowsOnce();
        drainRuntimeCues(runtime);

        if (serder.ilk === Ilks.qry && serder.route === "mbx") {
          const query = serder.ked?.q as Record<string, unknown> | undefined;
          const pre = typeof query?.i === "string" ? query.i : null;
          if (!pre) {
            return new Response("Mailbox query is missing i", {
              status: 400,
              headers: { "Content-Type": "text/plain" },
            });
          }

          return new Response(
            runtime.mailboxDirector.streamMailbox(
              pre,
              normalizeMbxTopicCursor(query?.topics),
            ),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "close",
              },
            },
          );
        }

        return new Response(null, {
          status: 204,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  };
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
): ServerOptions {
  return {
    port,
    hostname: "127.0.0.1",
    signal,
    onListen: ({ port }) => logger.info(`Server running on http://localhost:${port}`),
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
    options.onListen({ port: options.port });
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
 */
function openServerHost(
  port: number,
  logger: Logger,
  runtime?: AgentRuntime,
): ServerHost {
  const controller = new AbortController();
  const { signal } = controller;
  const shutdown = () => {
    logger.info("Shutting down server...");
    controller.abort();
  };
  const options = buildServerOptions(port, logger, signal);
  const handler = createProtocolHandler(runtime);
  const host = hasDenoServe()
    ? openDenoServerHost(options, handler)
    : openNodeServerHost(options, handler);

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
 */
export function* startServer(
  port: number = 8000,
  logger: Logger = consoleLogger,
  runtime?: AgentRuntime,
): Operation<void> {
  const host = openServerHost(port, logger, runtime);
  try {
    yield* waitForServerFinished(host.server);
  } finally {
    host.close();
  }
}

function drainRuntimeCues(runtime: AgentRuntime): void {
  const habitats = [...runtime.hby.habs.values()];
  const hab = habitats.length === 1 ? habitats[0] : null;
  if (!hab) {
    return;
  }

  for (const emission of hab.processCuesIter(runtime.cues)) {
    runtime.mailboxDirector.handleEmission(emission);
  }
}

function inspectCesrRequest(bytes: Uint8Array): SerderKERI | null {
  const parser = createParser({
    framed: false,
    attachmentDispatchMode: "compat",
  });
  const frames = parser.feed(bytes);
  for (const frame of frames) {
    if (frame.type === "error") {
      throw frame.error;
    }
    return parseSerder(
      frame.frame.body.raw,
      smellageFromMessage(frame.frame),
    ) as SerderKERI;
  }
  return null;
}

function smellageFromMessage(
  message: CesrMessage,
): Smellage {
  return {
    proto: message.body.proto,
    pvrsn: message.body.pvrsn,
    kind: message.body.kind,
    size: message.body.size,
    gvrsn: message.body.gvrsn,
  };
}
