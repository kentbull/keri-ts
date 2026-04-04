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
import { Roles } from "../core/roles.ts";
import type { AgentRuntime } from "./agent-runtime.ts";

/** Started HTTP host plus the cleanup handle that owns its shutdown boundary. */
interface ServerHost {
  readonly server: ReturnType<typeof Deno.serve>;
  close(): void;
}

/**
 * Start the protocol HTTP host and return its shutdown handle.
 *
 * This keeps the host-construction side effects separate from the
 * `server.finished` wait path so the promise boundary is explicit and local.
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
  const server = Deno.serve(
    {
      port,
      hostname: "127.0.0.1",
      signal,
      onListen: ({ port }) => logger.info(`Server running on http://localhost:${port}`),
      onError: (error) => {
        logger.error("Server error:", error);
        return new Response("Internal Server Error", { status: 500 });
      },
    },
    async (req: Request) => {
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
                normalizeMailboxTopics(query?.topics),
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
    },
  );

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  return {
    server,
    close() {
      Deno.removeSignalListener("SIGINT", shutdown);
      Deno.removeSignalListener("SIGTERM", shutdown);
      controller.abort();
    },
  };
}

/** Adapt `server.finished` into an Effection operation. */
function* waitForServerFinished(
  server: ReturnType<typeof Deno.serve>,
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

function normalizeMailboxTopics(
  value: unknown,
): Record<string, number> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((topic): topic is string => typeof topic === "string")
        .map((topic) => [topic, 0]),
    );
  }
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([topic]) => typeof topic === "string")
      .map((
        [topic, idx],
      ) => [topic, typeof idx === "number" ? idx : Number(idx) || 0]),
  );
}
