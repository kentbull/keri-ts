import { action, type Operation, suspend } from "effection";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { RootDatabase } from "lmdb";
import { openDB, readValue, writeValue } from "../../src/db/core/db.ts";

// Helper: Promise → Operation (for server lifecycle).
export function* toOp<T>(promise: Promise<T>, cleanup: () => void = () => {}): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve, reject);
    return cleanup; // Cleanup server resources / abort
  });
}

// Helper: Signal → Operation (Node.js signal handling).
function* waitSignal(signame: string): Operation<void> {
  return yield* action((resolve) => {
    const listener = () => resolve(undefined);
    process.on(signame as NodeJS.Signals, listener);
    return () => process.removeListener(signame as NodeJS.Signals, listener);
  });
}

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

  let serverClosed = false;

  // Create Node.js HTTP server
  const server: Server = createServer();

  // Handle each request with database persistence
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
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

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end(val);
      } else {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain");
        res.end("Not Found");
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });

  // Handle server errors
  server.on("error", (error) => {
    if (!serverClosed) {
      console.error("Server error:", error);
    }
  });

  // Start server synchronously (listen is async but we don't need to wait)
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  server.on("error", (error) => {
    if (!serverClosed) {
      console.error("Server error:", error);
    }
  });

  // Set up signal handlers for graceful shutdown
  const shutdown = () => {
    if (!serverClosed) {
      serverClosed = true;
      server.close(() => {
        console.log("Server closed");
      });
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    // Keep the operation running indefinitely until halted
    yield* suspend();
  } finally {
    // Cleanup runs when operation is halted (by signal or external halt)
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);

    if (!serverClosed) {
      serverClosed = true;
      server.close(() => {
        console.log("Server closed (cleanup)");
      });
    }
  }
}
