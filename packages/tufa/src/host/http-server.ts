/**
 * Shared HTTP host adapters for the Tufa application edge.
 *
 * This module owns Deno/Node listener startup, request bridging, and shutdown.
 * Protocol route composition lives under `tufa/src/http`, while route-facing
 * policy lives in `keri-ts` through `ProtocolHostPolicy`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { action, type Operation } from "npm:effection@^3.6.0";
import type { AgentRuntime, ProtocolHostPolicy } from "../../../keri/runtime.ts";
import { consoleLogger, type Logger } from "../../../keri/src/core/logger.ts";
import { createTufaApp } from "../http/app.ts";

interface RunningServer {
  readonly finished: Promise<void>;
}

interface ServerHost {
  readonly server: RunningServer;
  close(): void;
}

interface ServerOptions {
  port: number;
  hostname: string;
  signal: AbortSignal;
  onListen: (address: { port: number }) => void;
  onError: (error: unknown) => Response;
}

/** Tufa-owned HTTP host options. */
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

/** Open the native Deno HTTP host. */
function openDenoServerHost(
  options: ServerOptions,
  handler: (req: Request) => Promise<Response>,
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
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    res.on("error", reject);
    res.on("finish", () => resolve());
    stream.pipe(res);
  });
}

/** Execute the shared Fetch handler for one Node request. */
async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
  handler: (req: Request) => Promise<Response>,
): Promise<void> {
  try {
    const response = await handler(toNodeRequest(req, options));
    await writeNodeResponse(res, response);
  } catch (error) {
    const fallback = options.onError(error);
    await writeNodeResponse(res, fallback);
  }
}

/** Open the Node fallback host used by the npm build. */
function openNodeServerHost(
  options: ServerOptions,
  handler: (req: Request) => Promise<Response>,
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

/** Open one Tufa-owned HTTP host and return its cleanup handle. */
function openServerHost(
  port: number,
  logger: Logger,
  runtime?: AgentRuntime,
  options: RuntimeHttpHostOptions = {},
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
  const app = createTufaApp({
    runtime,
    protocolPolicy: options,
    app: { logger },
  });
  const handler = (req: Request): Promise<Response> => Promise.resolve(app.fetch(req));
  let host: ServerHost;
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
function* waitForServerFinished(server: RunningServer): Operation<void> {
  yield* action((resolve, reject) => {
    server.finished.then(resolve).catch(reject);
    return () => {};
  });
}

/** Start the Tufa HTTP host for one shared `AgentRuntime`. */
export function* startServer(
  port: number = 8000,
  logger: Logger = consoleLogger,
  runtime?: AgentRuntime,
  options: RuntimeHttpHostOptions = {},
): Operation<void> {
  const host = openServerHost(port, logger, runtime, options);
  try {
    yield* waitForServerFinished(host.server);
  } finally {
    host.close();
  }
}
