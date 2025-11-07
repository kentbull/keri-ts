import { action, type Operation, run, spawn } from 'effection'
import { openDB, readValue, writeValue } from '@db/core/db.ts'
import { RootDatabase } from 'lmdb' // Helper: Promise → Operation (for server.finished).

// Helper: Promise → Operation (for server.finished).
function* toOp<T>(promise: Promise<T>, cleanup: () => void): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve, reject);
    return cleanup; // Cleanup server resources / abort
  });
}

// Helper: Signal → Operation (Deno-specific; Hio Tymist equiv for events).
function* waitSignal(signame: string): Operation<void> {
  return yield* action((resolve) => {
    const listener = () => resolve(undefined);
    Deno.addSignalListener(signame as Deno.Signal, listener);
    return () => Deno.removeSignalListener(signame as Deno.Signal, listener);
  });
}

export function* startServer(port: number = 8000): Operation<void> {
  // openDB is synchronous, so call it directly
  const db = openDB();

  // Create an AbortController to manage server lifecycle
  // When aborted, Deno will cancel pending requests, allowing server.finished to resolve
  const abortController = new AbortController();
  const { signal } = abortController;

  // Modern Deno.serve with AbortSignal; handler wraps effect in run (tradeoff: error handling explicit).
  // The signal allows us to cancel pending requests when the server is halted
  const server = Deno.serve({ port, signal }, (req: Request) =>
    run(function* () {
      return yield* handleRequest(req, db);
    }));

  let shutdownInitiated = false;

  const shutdownServer = () => {
    shutdownInitiated = true;
    abortController.abort(); // Abort signal cancels pending requests
    server.shutdown();
  }

  // Sig handler spawns background task (structured: runs until halt).
  yield* spawn(function* () {
    yield* waitSignal("SIGINT");
    if (!shutdownInitiated) {
      shutdownServer();
    }
  });

  console.log(`Server running on http://localhost:${port}`);

  try {
    const serverCleanup = () => {
      if (!shutdownInitiated) {
        shutdownServer();
      }
    }
    yield* toOp(server.finished, serverCleanup);
  } finally {
    if (!shutdownInitiated) {
      shutdownServer();
    }
    
    // Wait for shutdown to complete - ensures Deno's leak detector sees completion
    yield* toOp(server.finished, () => {});
  }
}

// deno-lint-ignore require-yield
function* handleRequest(req: Request, db: RootDatabase): Operation<Response> {
  const url = new URL(req.url);

  if (url.pathname.startsWith("/echo/")) {
    let val = url.pathname.slice(6); // Trim '/echo/'.
    // readValue and writeValue are synchronous, so call them directly (no yield needed)
    const oldVal = readValue(db, 'echo');
    val = val ? val : oldVal ? oldVal : "initial echo";
    writeValue(db, 'echo', val);
    return new Response(val, { status: 200 });
  }
  return new Response("Not Found", { status: 404 });
}
