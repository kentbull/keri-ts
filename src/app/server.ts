import { action, type Operation, run, spawn } from 'effection'
import { openDB, readValue, writeValue } from '@db/core/db.ts'
import { RootDatabase } from 'lmdb' // Helper: Promise → Operation (for server.finished).

// Helper: Promise → Operation (for server.finished).
function* toOp<T>(promise: Promise<T>): Operation<T> {
  return yield* action(function* (resolve) {
    promise.then(resolve, (e) => resolve.raise(e));
    return () => {}; // Add abort if available.
  });
}

// Helper: Signal → Operation (Deno-specific; Hio Tymist equiv for events).
function* waitSignal(signame: string): Operation<void> {
  return yield* action(function* (resolve) {
    const listener = () => resolve(undefined);
    Deno.addSignalListener(signame as Deno.Signal, listener);
    return () => Deno.removeSignalListener(signame as Deno.Signal, listener);
  });
}

export function* startServer(port: number = 8000): Operation<void> {
  const db = yield* openDB();

  // Modern Deno.serve; handler wraps effect in run (tradeoff: error handling explicit).
  const server = Deno.serve({ port }, (req: Request) =>
    run(function* () {
      return yield* handleRequest(req, db);
    }));

  // Sig handler spawns background task (structured: runs until halt).
  yield* spawn(function* () {
    yield* waitSignal("SIGINT");
    server.shutdown();
  });

  console.log(`Server running on http://localhost:${port}`);

  // Wait for shutdown (Hio recur equiv: blocks until done).
  yield* toOp(server.finished);
}

function* handleRequest(req: Request, db: RootDatabase): Operation<Response> {
  const url = new URL(req.url);

  if (url.pathname.startsWith("/echo/")) {
    let val = url.pathname.slice(6); // Trim '/echo/'.
    const oldVal = yield* readValue(db, 'echo');
    val = val ? val : oldVal ? oldVal : "initial echo";
    yield* writeValue(db, 'echo', val);
    return new Response(val, { status: 200 });
  }
  return new Response("Not Found", { status: 404 });
}

