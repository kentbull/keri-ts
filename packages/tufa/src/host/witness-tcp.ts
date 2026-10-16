import {
  type CesrFrame,
  Ilks,
  ResourceAdmissionError,
  ResourceLimitError,
  type ResourceReservation,
  WireParseError,
} from "cesr-ts";
import { toEffectionFrames } from "cesr-ts/effection";
import { action, call, createScope, type Operation, race, resource, useScope } from "effection";
import {
  type AgentRuntime,
  chunkBytes,
  type CueEmission,
  type Hab,
  processCuesOnce,
  type QueryReply,
  respondantCueSink,
  socketBytes,
  writeCesrTcpSocket,
} from "keri-ts/runtime";
import { createServer, type Socket } from "node:net";

/** Finite host supervision; the runtime owns the sole parser stream reservation. */
export interface WitnessTcpOptions {
  /** Maximum admitted/closing connections on this listener; default two. */
  maxConnections?: number;
  /** Absolute deadline after genuine receive EOF, never refreshed by output activity; default 30 seconds. */
  drainTimeoutMs?: number;
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
  drainTimeoutMs: number,
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
    if ((receiveSignal?.aborted && !socket.readableEnded) || returning) {
      return;
    }
    if (isPeerError(error)) {
      peers.add(error);
    }
    rejectFailure(error);
  };
  const close = () => {
    if (
      (socket.readableEnded && socket.writableFinished) || (receiveSignal?.aborted && !socket.readableEnded)
      || returning
    ) {
      return;
    }
    const error = new Error("TCP peer closed before directional drain completed");
    peers.add(error);
    rejectFailure(error);
  };
  let deadline: ReturnType<AgentRuntime["services"]["clock"]["setTimeout"]> | undefined;
  const eof = () => {
    deadline = runtime.services.clock.setTimeout(() => {
      const error = new Error("TCP reply drain deadline exceeded");
      peers.add(error);
      rejectFailure(error);
    }, drainTimeoutMs);
  };
  yield* resource<void>(function*(provideWatcher) {
    socket.on("error", error);
    socket.on("close", close);
    socket.once("end", eof);
    try {
      yield* provideWatcher();
    } finally {
      socket.off("error", error);
      socket.off("close", close);
      socket.off("end", eof);
      if (deadline !== undefined) runtime.services.clock.clearTimeout(deadline);
    }
  });
  try {
    yield* race([
      call(function*() {
        const channel = yield* toEffectionFrames((signal) => {
          receiveSignal = signal;
          const input = socketBytes(socket, { signal });
          const source: AsyncIterableIterator<Uint8Array> = {
            [Symbol.asyncIterator]() {
              return this;
            },
            next: () => input.next(),
            return() {
              returning = !socket.readableEnded;
              return input.return!();
            },
          };
          return source;
        });
        let pending: QueryReply | undefined;
        let next: IteratorResult<CesrFrame, void> | undefined,
          readFailure: { error: unknown; reported?: boolean } | undefined;
        let pulling = false, rxEOF = false, wake: (() => void) | undefined;
        const frames = yield* channel.frames;
        const [reads, haltReads] = createScope(yield* useScope());
        /** Join the one pull, dispose its unclaimed frame, and release the slot even after cleanup failure. */
        function* closeReadOwner(): Operation<void> {
          const errors: unknown[] = [];
          try {
            yield* haltReads();
          } catch (error) {
            errors.push(error);
          }
          try {
            const unclaimed = next;
          } catch (error) {
            errors.push(error);
          }
          if (readFailure && !readFailure.reported && !errors.includes(readFailure.error)) {
            errors.push(readFailure.error);
          }
          try {
            pending?.close();
          } catch (error) {
            errors.push(error);
          }
          if (errors.length === 1) throw errors[0];
          if (errors.length) throw new AggregateError(errors, "TCP read/reply cleanup failed");
        }
        yield* resource<void>(function*(provide) {
          try {
            yield* provide();
          } finally {
            yield* closeReadOwner();
          }
        });
        type Batch = NonNullable<ReturnType<QueryReply["takeAll"]>>;
        /** Interpret captured replies under the guard and write them through the existing socket. */
        function* sendBatch(batch: Batch): Operation<void> {
          for (const cue of batch.cues) {
            yield* call(function*() {
              let output: CueEmission | undefined;
              yield* runtime.reactor.settle(undefined, {}, function*() {
                output = serviceHab.interpretCue(cue);
              });
              yield* writeCesrTcpSocket(socket, async function*(signal) {
                for (const message of output!.messages) {
                  yield* chunkBytes(message, { signal, maxChunkBytes: 65536 });
                }
              }, { services: runtime.services });
            });
          }
        }
        /** Settle current input and retain at most one authorized missing-state query on this connection. */
        function* processFrame(frame: CesrFrame): Operation<void> {
          const body = frame.body;
          if (body.ilk === Ilks.qry && pending) {
            const error = new Error("TCP connection already has an unresolved query");
            peers.add(error);
            throw error;
          }
          const pre = typeof body.ked?.i === "string" ? body.ked.i : undefined;
          let slot = body.ilk === Ilks.qry && body.said
            ? runtime.reactor.replies.reserve(body.said)
            : ([Ilks.icp, Ilks.dip, Ilks.rot, Ilks.drt, Ilks.ixn] as readonly string[]).includes(body.ilk!) && pre
                && body.said
            ? runtime.reactor.replies.reserveEvent(pre, body.said)
            : undefined;
          let batch: ReturnType<NonNullable<typeof slot>["takeAll"]>;
          yield* resource<void>(function*(provide) {
            try {
              yield* provide();
            } finally {
              slot?.close();
            }
          });
          yield* runtime.reactor.settle(frame, { local: true, escrows: true }, function*(_envelope, decision) {
            // SAIDs do not include signatures: this exact dispatch must authorize its output.
            if (
              body.ilk === Ilks.qry
                ? decision?.kind !== "drop" && decision?.kind !== "pending" && decision?.kind !== "missing"
                : decision?.kind === "accept" || decision?.kind === "duplicate"
            ) {
              if (
                body.ilk === Ilks.qry && decision?.kind === "escrow"
                && ["logs", "ksn"].includes(String(body.ked?.r))
              ) {
                pending = slot;
                slot = undefined;
              } else batch = slot?.takeAll();
            }
          });
          yield* processCuesOnce(runtime, { hab: serviceHab, sink: respondantCueSink(runtime, serviceHab) });
          if (batch) yield* sendBatch(batch);
        }
        while (!rxEOF || pending) {
          if (pending?.ready) {
            yield* call(function*() {
              let batch: Batch | undefined;
              yield* runtime.reactor.settle(undefined, {}, function*() {
                batch = pending!.takeAll();
              });
              if (batch) yield* sendBatch(batch);
            });
            pending.close();
            pending = undefined;
            continue;
          }
          if (readFailure) {
            readFailure.reported = true;
            throw readFailure.error;
          }
          if (next) {
            const result = next;
            if (result.done) {
              next = undefined;
              rxEOF = true;
            } else {
              // Register ownership before the pending pull transfers its one complete frame.
              yield* call(function*() {
                next = undefined;
                yield* processFrame(result.value);
              });
            }
            pulling = false;
            continue;
          }
          if (!rxEOF && !pulling) {
            pulling = true;
            reads.run(function*() {
              try {
                next = yield* frames.next();
              } catch (error) {
                readFailure = { error };
              }
              wake?.();
            });
          }
          // One cancellable observer and one joined parser pull; no result queue or Promise waiter growth.
          yield* action<void>((resolve) => {
            wake = resolve;
            const unobserve = pending?.observeReady(resolve);
            if (next || readFailure) resolve();
            return () => {
              wake = undefined;
              unobserve?.();
            };
          });
        }
        // Genuine RX EOF leaves TX available until every scoped reply has drained.
        yield* call(() =>
          new Promise<void>((resolve, reject) => socket.end((error?: Error) => error ? reject(error) : resolve()))
        );
        yield* call(() => closed);
      }),
      action<void>((_resolve, reject) => {
        failure.catch(reject);
        return () => {};
      }),
    ]);
  } catch (error) {
    if (error instanceof WireParseError) onRefusal("wire");
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
  {
    maxConnections = 2,
    drainTimeoutMs = 30000,
    onRefusal = (reason) => console.warn(`Witness TCP connection refused: ${reason}`),
  }: WitnessTcpOptions = {},
): Operation<void> {
  if (!Number.isSafeInteger(maxConnections + 1) || maxConnections < 1) {
    throw new RangeError("TCP maxConnections and its rejection allowance must be positive safe integers");
  }
  if (!Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 1) {
    throw new RangeError("TCP drainTimeoutMs must be positive");
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
    const server = createServer({ pauseOnConnect: true, allowHalfOpen: true }, (socket) => {
      let unowned: ResourceReservation | undefined;
      handles.add(socket);
      socket.once("close", () => handles.delete(socket));
      const closed = new Promise<void>((resolve) => socket.once("close", resolve));
      // Refused handles have no parser/task; their native close still belongs to server.close().
      const nativeError = (error: Error) => {
        if (!isPeerError(error)) {
          rejectCompletion(error);
        }
      };
      socket.on("error", nativeError);
      socket.once("close", () => socket.off("error", nativeError));
      try {
        if (stopping || sockets.size >= maxConnections) {
          socket.destroy();
          if (!stopping) {
            onRefusal("busy");
          }
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
              yield* processWitnessSocket(
                socket,
                runtime,
                serviceHab,
                closed,
                () => {
                  sockets.delete(socket);
                  decision.reservation.release();
                },
                onRefusal,
                drainTimeoutMs,
              );
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
 * Exact event proofs and query replies use this connection; unrelated mailbox/direct cues retain ordinary routing.
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
