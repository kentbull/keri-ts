import { type CesrFrame, Ilks, parse, WireParseError } from "cesr-ts";
import { action, call, createScope, ensure, type Operation, race, resource, useScope } from "effection";
import {
  type AgentRuntime,
  chunkBytes,
  type CueEmission,
  type Hab,
  processCuesOnce,
  type QueryReply,
  respondantCueSink,
  rethrowCleanupFailure,
  socketBytes,
  writeCesrTcpSocket,
} from "keri-ts/runtime";
import { createServer, type Socket } from "node:net";

/** Concrete listener supervision and joined connection lifetimes. */
export interface WitnessTcpOptions {
  /** Absolute deadline after genuine receive EOF, never refreshed by output activity; default 30 seconds. */
  drainTimeoutMs?: number;
  /** Observe expected connection refusal without suppressing storage/invariant failures. */
  onRefusal?: (reason: "wire" | "peer") => void;
}

const PEER_ERRORS = new Set(["ECONNRESET", "ECONNABORTED", "EPIPE", "ETIMEDOUT"]);

/** Recognize peer I/O failures without treating native capacity/infrastructure errors as input refusal. */
function isPeerError(error: Error): boolean {
  return PEER_ERRORS.has((error as NodeJS.ErrnoException).code ?? "");
}
/** Join one parser/watcher/socket lifetime before its connection scope ends. */
function* processWitnessSocket(
  socket: Socket,
  runtime: AgentRuntime,
  serviceHab: Hab,
  closed: Promise<void>,
  onRefusal: NonNullable<WitnessTcpOptions["onRefusal"]>,
  drainTimeoutMs: number,
): Operation<void> {
  // Earlier resource outlives every parser/watcher child, including joined cancellation.
  yield* resource<void>(function*(provide) {
    try {
      yield* provide();
    } finally {
      socket.destroy();
      yield* call(() => closed);
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
        const controller = new AbortController();
        const signal = receiveSignal = controller.signal;
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
        const frames = parse(source);
        let pullingFrame: ReturnType<typeof frames.next> | undefined;
        // Registered before read/dispatch children: abort in finally, then join and return the parser.
        yield* ensure(function*() {
          try {
            if (pullingFrame) {
              try {
                yield* call(() => pullingFrame!);
              } catch (error) {
                rethrowCleanupFailure(error, signal);
              }
            }
          } finally {
            yield* call(() => frames.return());
          }
        });
        try {
          let pending: QueryReply | undefined;
          let next: IteratorResult<CesrFrame, void> | undefined,
            readFailure: { error: unknown; reported?: boolean } | undefined;
          let pulling = false, rxEOF = false, wake: (() => void) | undefined;
          const [reads, haltReads] = createScope(yield* useScope());
          /** Stop the read child and close any retained query, preserving independent failures. */
          const closeReadOwner = function*(): Operation<void> {
            const errors: unknown[] = [];
            try {
              yield* haltReads();
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
          };
          yield* resource<void>(function*(provide) {
            try {
              yield* provide();
            } finally {
              yield* closeReadOwner();
            }
          });
          type Batch = NonNullable<ReturnType<QueryReply["takeAll"]>>;
          /** Interpret captured replies under the guard and write them through the existing socket. */
          const sendBatch = function*(batch: Batch): Operation<void> {
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
                }, { clock: runtime.services.clock });
              });
            }
          };
          /** Settle current input and retain at most one authorized missing-state query on this connection. */
          const processFrame = function*(frame: CesrFrame): Operation<void> {
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
          };
          while (!rxEOF || pending) {
            signal.throwIfAborted();
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
                  signal.throwIfAborted();
                  pullingFrame = frames.next();
                  next = yield* call(() => pullingFrame!);
                  pullingFrame = undefined;
                  signal.throwIfAborted();
                } catch (error) {
                  pullingFrame = undefined;
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
        } finally {
          controller.abort();
        }
      }),
      action<void>((_resolve, reject) => {
        failure.catch(reject);
        return () => {};
      }),
    ]);
  } catch (error) {
    if (error instanceof WireParseError) onRefusal("wire");
    else if (peers.has(error)) onRefusal("peer");
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
    drainTimeoutMs = 30000,
    onRefusal = (reason) => console.warn(`Witness TCP connection refused: ${reason}`),
  }: WitnessTcpOptions = {},
): Operation<void> {
  if (!Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 1) {
    throw new RangeError("TCP drainTimeoutMs must be positive");
  }
  // Created before the listener resource: its finalizer stops acceptance before joining these children.
  const [connections, haltConnections] = createScope(yield* useScope());
  const finished = yield* resource<Promise<void>>(function*(provide) {
    const listening = new AbortController();
    const handles = new Set<Socket>();
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    let stopping = false;
    const server = createServer({ pauseOnConnect: true, allowHalfOpen: true }, (socket) => {
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
        if (stopping) {
          socket.destroy();
          return;
        }
        connections.run(function*() {
          try {
            yield* call(function*() {
              yield* processWitnessSocket(
                socket,
                runtime,
                serviceHab,
                closed,
                onRefusal,
                drainTimeoutMs,
              );
            });
          } catch (error) {
            rejectCompletion(error);
          }
        });
      } catch (error) {
        socket.destroy();
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
 * Own paused sockets, one buffered parser per receive lifetime, and joined listener shutdown.
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
