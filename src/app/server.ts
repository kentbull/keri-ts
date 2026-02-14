import { action, type Operation } from "npm:effection@^3.6.0";
import { consoleLogger, type Logger } from "../core/logger.ts";

/**
 * Start HTTP server with Effection as the outermost runtime.
 * Each request is spawned as a separate Effection task, ensuring
 * proper structured concurrency and cleanup.
 */
export function* startServer(
  port: number = 8000,
  logger: Logger = consoleLogger,
): Operation<void> {
  // Use Deno.serve
  return yield* action((resolve, reject) => {
    const controller = new AbortController();
    const { signal } = controller;

    const server = Deno.serve(
      {
        port,
        hostname: "127.0.0.1",
        signal,
        onListen: ({ port }) =>
          logger.info(`Server running on http://localhost:${port}`),
        onError: (error) => {
          logger.error("Server error:", error);
          return new Response("Internal Server Error", { status: 500 });
        },
      },
      (req: Request) => {
        try {
          const url = new URL(req.url);
          if (url.pathname === "/health") {
            return new Response("ok", {
              status: 200,
              headers: { "Content-Type": "text/plain" },
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

    // Wait for server to finish
    server.finished.then(resolve).catch(reject);

    // Graceful shutdown logic using signals
    const shutdown = () => {
      logger.info("Shutting down server...");
      controller.abort();
    };

    // Deno signal listeners
    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    return () => {
      Deno.removeSignalListener("SIGINT", shutdown);
      Deno.removeSignalListener("SIGTERM", shutdown);
      controller.abort();
    };
  });
}
