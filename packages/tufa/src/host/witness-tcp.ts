import { ResourceLimitError, type ResourceReservation, WireParseError } from "cesr-ts";
import { action, call, createScope, type Operation, race, resource, useScope } from "effection";
import { type AgentRuntime, DeckFullError, type Hab, processWitnessIngressSource, socketBytes } from "keri-ts/runtime";
import { createServer, type Socket } from "node:net";

/** Finite host supervision; the runtime owns the sole parser stream reservation. */
export interface WitnessTcpOptions {
  /** Maximum admitted/closing connections on this listener; default two. */
  maxConnections?: number;
  /** Observe expected connection refusal without suppressing storage/invariant failures. */
  onRefusal?: (reason: "busy" | "limit" | "wire" | "peer") => void;
}

// Logical native-read/backing-copy allowance, not a hard bound on OS or pooled native buffering.
const CONNECTION_BYTES = 2 * 1024 ** 2;
const PEER_ERRORS = new Set(["ECONNRESET", "ECONNABORTED", "EPIPE", "ETIMEDOUT"]);

/** Recognize peer I/O failures without treating native capacity/infrastructure errors as input refusal. */
function isPeerError(error: Error): boolean {
  return PEER_ERRORS.has((error as NodeJS.ErrnoException).code ?? "");
}

/** Join one parser/watcher/socket lifetime before returning its connection credit. */
function* processWitnessSocket(
  socket: Socket,
  runtime: AgentRuntime,
  serviceHab: Hab,
  closed: Promise<void>,
  release: () => void,
  onRefusal: NonNullable<WitnessTcpOptions["onRefusal"]>,
): Operation<void> {
  // Earlier resource outlives every parser/watcher child, including joined cancellation.
  yield* resource<void>(function*(provideLease) {
    try {
      yield* provideLease();
    } finally {
      try {
        socket.destroy();
        yield* call(() => closed);
      } finally {
        release();
      }
    }
  });
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  failure.catch(() => {});
  const peers = new Set<unknown>();
  let receiveSignal: AbortSignal | undefined;
  let returning = false;
  const error = (error: Error) => {
    if (receiveSignal?.aborted || returning) return;
    if (isPeerError(error)) peers.add(error);
    rejectFailure(error);
  };
  const close = () => {
    if (socket.readableEnded || receiveSignal?.aborted || returning) return;
    const error = new Error("TCP peer closed before receive EOF");
    peers.add(error);
    rejectFailure(error);
  };
  yield* resource<void>(function*(provideWatcher) {
    socket.on("error", error);
    socket.on("close", close);
    try {
      yield* provideWatcher();
    } finally {
      socket.off("error", error);
      socket.off("close", close);
    }
  });
  try {
    yield* race([
      processWitnessIngressSource(runtime, serviceHab, (signal) => {
        receiveSignal = signal;
        const input = socketBytes(socket, { signal });
        const source: AsyncIterableIterator<Uint8Array> = {
          [Symbol.asyncIterator]() {
            return this;
          },
          next: () => input.next(),
          return() {
            // Parser-owned return can destroy the socket before its adapter aborts the signal.
            returning = true;
            return input.return!();
          },
        };
        return source;
      }, { local: true, classifyWireErrors: true }),
      action<void>((_resolve, reject) => {
        failure.catch(reject);
        return () => {};
      }),
    ]);
  } catch (error) {
    if (error instanceof WireParseError) onRefusal("wire");
    else if (error instanceof DeckFullError) onRefusal("busy");
    else if (error instanceof ResourceLimitError) {
      onRefusal("reason" in error && error.reason === "busy" ? "busy" : "limit");
    } else if (peers.has(error)) onRefusal("peer");
    else throw error;
  }
}

/** Keep connection children inside an isolated listener lifetime so fatal failures reach its caller. */
function* witnessTcpListener(
  port: number,
  hostname: string,
  runtime: AgentRuntime,
  serviceHab: Hab,
  { maxConnections = 2, onRefusal = (reason) => console.warn(`Witness TCP connection refused: ${reason}`) }:
    WitnessTcpOptions = {},
): Operation<void> {
  if (!Number.isSafeInteger(maxConnections + 1) || maxConnections < 1) {
    throw new RangeError("TCP maxConnections and its rejection allowance must be positive safe integers");
  }
  // Created before the listener resource: its finalizer stops acceptance before joining these children.
  const [connections, haltConnections] = createScope(yield* useScope());
  const finished = yield* resource<Promise<void>>(function*(provide) {
    const listening = new AbortController();
    const sockets = new Set<Socket>();
    const handles = new Set<Socket>();
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    let stopping = false;
    const server = createServer({ pauseOnConnect: true }, (socket) => {
      let unowned: ResourceReservation | undefined;
      handles.add(socket);
      socket.once("close", () => handles.delete(socket));
      const closed = new Promise<void>((resolve) => socket.once("close", resolve));
      // Refused handles have no parser/task; their native close still belongs to server.close().
      const nativeError = (error: Error) => {
        if (!isPeerError(error)) rejectCompletion(error);
      };
      socket.on("error", nativeError);
      socket.once("close", () => socket.off("error", nativeError));
      try {
        if (stopping || sockets.size >= maxConnections) {
          socket.destroy();
          if (!stopping) onRefusal("busy");
          return;
        }
        const decision = runtime.resources.reserve({ bytes: CONNECTION_BYTES });
        if (decision.kind === "refuse") {
          socket.destroy();
          onRefusal(decision.reason);
          return;
        }
        unowned = decision.reservation;
        sockets.add(socket);
        connections.run(function*() {
          try {
            yield* call(function*() {
              unowned = undefined;
              yield* processWitnessSocket(socket, runtime, serviceHab, closed, () => {
                sockets.delete(socket);
                decision.reservation.release();
              }, onRefusal);
            });
          } catch (error) {
            rejectCompletion(error);
          }
        });
      } catch (error) {
        unowned?.release();
        sockets.delete(socket);
        socket.destroy();
        rejectCompletion(error);
      }
    });
    // Deno does not emit Node's drop event: one native rejection handle permits explicit refusal reporting.
    server.maxConnections = maxConnections + 1;
    server.on("drop", () => {
      try {
        onRefusal("busy");
      } catch (error) {
        rejectCompletion(error);
      }
    });
    server.on("error", rejectCompletion);
    server.once("close", resolveCompletion);
    // Observe errors before listener setup or a synchronous connection task can fail.
    completion.catch(() => {});
    try {
      server.listen({ port, host: hostname, signal: listening.signal });
      yield* provide(completion);
    } finally {
      stopping = true;
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error?: NodeJS.ErrnoException) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        });
      });
      listening.abort();
      try {
        yield* haltConnections();
      } finally {
        for (const socket of handles) socket.destroy();
        yield* call(() => closed);
      }
    }
  });
  yield* call(() => finished);
}

/**
 * Own paused sockets, one progressive parser per receive lifetime, and joined listener shutdown.
 * Admission precedes task/source acquisition; the Reactor alone charges the receive stream slot.
 * Default receipt/mailbox/direct delivery stays unchanged, with no same-socket duplex policy.
 */
export function startWitnessTcpServer(
  port: number,
  hostname: string,
  runtime: AgentRuntime,
  serviceHab: Hab,
  options: WitnessTcpOptions = {},
): Operation<void> {
  return call(() => witnessTcpListener(port, hostname, runtime, serviceHab, options));
}
