import { action, type Operation } from "effection";
import { RootDatabase } from "lmdb";
import { openDB, readValue, writeValue } from "../../src/db/core/db.ts";

/**
 * Start HTTP server with Effection as the outermost runtime.
 * Each request is spawned as a separate Effection task, ensuring
 * proper structured concurrency and cleanup.
 */
export function* startServer(port: number = 8000): Operation<void> {
  // openDB is synchronous, so call it directly
  let db: RootDatabase;
  try {
    db = openDB();
  } catch (error) {
    console.error("Error opening database:", error);
    throw error;
  }

  // Use Deno.serve
  return yield* action((resolve, reject) => {
    const controller = new AbortController();
    const { signal } = controller;

    const server = Deno.serve(
      {
        port,
        hostname: "127.0.0.1",
        signal,
        onListen: ({ port }) => console.log(`Server running on http://localhost:${port}`),
        onError: (error) => {
          console.error("Server error:", error);
          return new Response("Internal Server Error", { status: 500 });
        },
      },
      (req: Request) => {
        try {
          const url = new URL(req.url);
          if (url.pathname.startsWith("/echo/")) {
            // Extract value from path (everything after "/echo/")
            let val = url.pathname.slice(6); // Trim '/echo/'

            // If no value in path, read from database
            if (!val) {
              const oldVal = readValue(db, "echo");
              val = oldVal ? oldVal : "initial echo";
            }

            // Write the value to database (persist it)
            writeValue(db, "echo", val);

            return new Response(val, {
              status: 200,
              headers: { "Content-Type": "text/plain" },
            });
          } else {
            return new Response("Not Found", {
              status: 404,
              headers: { "Content-Type": "text/plain" },
            });
          }
        } catch (error) {
          return new Response(String(error), { status: 500 });
        }
      }
    );

    // Wait for server to finish
    server.finished.then(resolve).catch(reject);

    // Graceful shutdown logic using signals
    const shutdown = () => {
      console.log("Shutting down server...");
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
