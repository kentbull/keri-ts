/**
 * Shared HTTP host adapters for the HTTP application edge.
 *
 * This module owns Deno/Node listener startup, request bridging, and shutdown.
 * Protocol route composition lives under `hosting/src/http`, while route-facing
 * policy lives in `keri-ts` through `ProtocolHostPolicy`.
 */
import { action, call, type Operation } from "effection";
import { type AgentRuntime, consoleLogger, type Logger, type ProtocolHostPolicy } from "keri-ts/runtime";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createTufaApp } from "../http/app.ts";

interface RunningServer {
  readonly finished: Promise<void>;
}

interface ServerHost {
  readonly server: RunningServer;
  close(): void | Promise<void>;
}

interface OwnedServerHost extends ServerHost {
  readonly shutdownRequested: Promise<void>;
}

interface ServerOptions {
  port: number;
  hostname: string;
  signal: AbortSignal;
  onListen: (address: { port: number }) => void;
  onError: (error: unknown) => Response;
}

/** HTTP host options. */
export interface RuntimeHttpHostOptions extends ProtocolHostPolicy {
  hostname?: string;
  onListen?: (address: { port: number; hostname: string }) => void;
}

/**
 * Detect whether the current runtime can host directly via `Deno.serve()`.
 *
 * The npm build still carries a Deno shim object, so this checks the actual
 * function presence instead of assuming `globalThis.Deno` means native hosting.
 */
function hasDenoServe(): boolean {
  return typeof Deno.serve === "function";
}

/** Normalize startup policy shared by both HTTP host implementations. */
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

/** Open the native Deno HTTP host and join request cleanup after its listener closes. */
export function openDenoServerHost(
  options: ServerOptions,
  handler: (req: Request) => Promise<Response>,
): ServerHost {
  const requests = new Set<Promise<Response>>();
  const server = Deno.serve(options, (request) => {
    const response = Promise.resolve().then(() => handler(request));
    requests.add(response);
    void response.then(() => requests.delete(response), () => requests.delete(response));
    return response;
  });
  return {
    server: {
      // Native server.finished can resolve while a disconnected handler still joins parser/sink cleanup.
      finished: server.finished.finally(async () => {
        await Promise.allSettled(requests);
      }),
    },
    close() {
      // The abort signal passed to `Deno.serve()` owns shutdown.
    },
  };
}

/** Preserve multiplicity when copying Node headers into Fetch `Headers`. */
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

/** Convert one Node incoming request into a Fetch `Request`. */
function toNodeRequest(
  req: IncomingMessage,
  options: ServerOptions,
  signal: AbortSignal,
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
    signal,
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }

  return new Request(`http://${host}${req.url ?? "/"}`, init);
}

/** Flush one Fetch `Response` back onto Node's `ServerResponse`. */
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
  try {
    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      res.once("error", reject);
      res.once("finish", () => resolve());
      res.once("close", () => {
        // A disconnect may never emit finish; destroying the Node reader cancels its Fetch body too.
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
    });
  } finally {
    // fromWeb finishes destruction only after cancelling its source; retain ownership until that joins.
    await new Promise<void>((resolve) => {
      if (stream.closed) resolve();
      else {
        stream.once("close", resolve);
        stream.destroy();
      }
    });
  }
}

/** Execute the shared Fetch handler for one Node request. */
async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
  handler: (req: Request) => Promise<Response>,
): Promise<void> {
  const disconnected = new AbortController();
  /** Carry socket loss into every request-owned parser and storage operation. */
  const abort = () => disconnected.abort(new DOMException("Client disconnected", "AbortError"));
  req.once("aborted", abort);
  res.once("close", abort);
  const signal = AbortSignal.any([options.signal, disconnected.signal]);
  try {
    const response = await handler(toNodeRequest(req, options, signal));
    if (!res.destroyed) await writeNodeResponse(res, response);
    else await response.body?.cancel();
  } catch (error) {
    if (res.headersSent) {
      // A streamed body can fail after 200 headers; terminate that transfer instead of rewriting its status.
      res.destroy();
      if (!signal.aborted || error !== signal.reason) options.onError(error);
    } else if (!res.destroyed) {
      const fallback = options.onError(error);
      await writeNodeResponse(res, fallback);
    }
  } finally {
    req.removeListener("aborted", abort);
    res.removeListener("close", abort);
    disconnected.abort();
  }
}

/** Open the Node fallback host; completion joins every admitted request after the listener closes. */
export function openNodeServerHost(
  options: ServerOptions,
  handler: (req: Request) => Promise<Response>,
): ServerHost {
  // A closed socket does not imply that its parser or payload cleanup has finished.
  const requests = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    const request = handleNodeRequest(req, res, options, handler);
    requests.add(request);
    // Attach both branches immediately: a rejected fallback response must not become detached rejection.
    void request.then(() => requests.delete(request), () => requests.delete(request));
  });
  // listen() is asynchronous; an owner can close the host before Node marks it listening.
  let closing = false;
  /** Remember early cancellation and close the listener as soon as it becomes available. */
  const close = () => {
    closing = true;
    if (server.listening) server.close();
  };
  const onAbort = close;

  options.signal.addEventListener("abort", onAbort, { once: true });
  const closed = new Promise<void>((resolve, reject) => {
    server.once("close", resolve);
    server.once("error", reject);
  });
  const finished = closed.finally(async () => {
    // Listener closure prevents new admissions; settle every remaining owner before releasing the runtime.
    await Promise.allSettled(requests);
  });

  server.listen(options.port, options.hostname, () => {
    if (closing || options.signal.aborted) {
      close();
      return;
    }
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : options.port;
    options.onListen({ port });
  });

  return {
    server: { finished },
    close() {
      options.signal.removeEventListener("abort", onAbort);
      close();
    },
  };
}

/** Open one HTTP host and return its cleanup handle. */
function openServerHost(
  port: number,
  logger: Logger,
  runtime?: AgentRuntime,
  options: RuntimeHttpHostOptions = {},
): OwnedServerHost {
  const controller = new AbortController();
  const { signal } = controller;
  let requestShutdown!: () => void;
  const shutdownRequested = new Promise<void>((resolve) => requestShutdown = resolve);
  const shutdown = () => {
    logger.info("Shutting down server...");
    requestShutdown();
  };
  const serverOptions = buildServerOptions(
    port,
    logger,
    signal,
    options.hostname ?? "127.0.0.1",
    options.onListen,
  );
  const app = createTufaApp({
    runtime,
    protocolPolicy: options,
    app: { logger },
  });
  const handler = (req: Request): Promise<Response> => Promise.resolve(app.fetch(req));
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);
  const removeSignals = () => {
    Deno.removeSignalListener("SIGINT", shutdown);
    Deno.removeSignalListener("SIGTERM", shutdown);
  };
  let host: ServerHost;
  try {
    if (hasDenoServe()) {
      try {
        host = openDenoServerHost(serverOptions, handler);
      } catch (error) {
        logger.warn(
          "Falling back to Node HTTP host after Deno.serve() startup failed:",
          error,
        );
        host = openNodeServerHost(serverOptions, handler);
      }
    } else {
      host = openNodeServerHost(serverOptions, handler);
    }
  } catch (error) {
    removeSignals();
    throw error;
  }

  return {
    server: host.server,
    shutdownRequested,
    async close() {
      // Keep repeated signals graceful until the adapter has actually drained.
      try {
        try {
          await host.close();
        } finally {
          controller.abort();
          try {
            await app.close();
          } finally {
            await host.server.finished;
          }
        }
      } finally {
        removeSignals();
      }
    },
  };
}

/** Adapt `server.finished` into an Effection operation. */
function* waitForServerStop(host: OwnedServerHost): Operation<void> {
  yield* action((resolve, reject) => {
    Promise.race([host.server.finished, host.shutdownRequested]).then(resolve).catch(reject);
    return () => {};
  });
}

/** Start the Tufa HTTP host for one shared `AgentRuntime`. */
export function* startServer(
  port: number = 8000,
  logger: Logger = consoleLogger,
  runtime?: AgentRuntime,
  options: RuntimeHttpHostOptions = {},
  beforeDrain?: () => Operation<void>,
): Operation<void> {
  const host = openServerHost(port, logger, runtime, options);
  try {
    yield* waitForServerStop(host);
  } finally {
    // Stop accepting work synchronously, then let the owner close response-producing
    // resources before waiting for active response bodies to drain.
    const closing = host.close();
    try {
      if (beforeDrain) {
        yield* beforeDrain();
      }
    } finally {
      yield* call(() => Promise.resolve(closing));
    }
  }
}
