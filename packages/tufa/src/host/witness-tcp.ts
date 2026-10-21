import { type CesrFrame, Ilks, parse, WireParseError } from "cesr-ts";
import { action, call, createScope, ensure, type Operation, race, resource, useScope } from "effection";
import {
  type AgentRuntime,
  chunkBytes,
  type Hab,
  processCuesOnce,
  type QueryReply,
  rethrowCleanupFailure,
  socketBytes,
  UnsupportedTelReplayError,
  writeCesrTcpSocket,
} from "keri-ts/runtime";
import { createServer, type Socket } from "node:net";

/** Concrete listener supervision and joined connection lifetimes. */
export interface WitnessTcpOptions {
  /** Absolute deadline after genuine receive EOF, never refreshed by output activity; default 30 seconds. */
  drainTimeoutMs?: number;
  /** Observe expected connection refusal without suppressing storage/invariant failures. */
  onRefusal?: (reason: "wire" | "peer" | "unsupported-replay") => void;
}

const PEER_ERRORS = new Set(["ECONNRESET", "ECONNABORTED", "EPIPE", "ETIMEDOUT"]);

/**
 * Recognize peer I/O failures without treating native capacity/infrastructure errors as input refusal.
 *
 * @param error Native socket error whose code is inspected.
 * @returns True for the explicit reset/abort/pipe/timeout codes treated as peer failures.
 */
function isPeerError(error: Error): boolean {
  return PEER_ERRORS.has((error as NodeJS.ErrnoException).code ?? "");
}
/**
 * Own one accepted connection from buffered input through response drain and close.
 * Exact event/query correlations reserve request-owned output before dispatch.
 * Only authorized results are sent on this socket; unrelated cues use ordinary
 * routing. One unresolved query may survive receive EOF until ready or the fixed
 * drain deadline. Teardown joins parser/read children and releases correlation
 * slots before the outer socket resource finishes closing.
 *
 * @param socket Accepted paused, half-open-capable socket owned by this connection scope.
 * @param runtime Borrowed composed host; supplies protocol processing, reply correlations and clock.
 * @param serviceHab Hosted signer used to construct authorized responses on this socket.
 * @param closed Native close promise registered before processing starts.
 * @param onRefusal Observer called for recognized wire/peer refusal; other failures propagate.
 * @param drainTimeoutMs Absolute deadline in milliseconds after receive EOF, covering pending replies and output drain.
 * @throws Infrastructure, protocol-handler and cleanup failures reach the listener owner.
 */
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
  /**
   * Report socket failure unless it belongs to already-started local teardown.
   * @param error Native error; recognized peer codes are tracked for connection-local refusal reporting.
   */
  const error = (error: Error) => {
    if ((receiveSignal?.aborted && !socket.readableEnded) || returning) {
      return;
    }
    if (isPeerError(error)) {
      peers.add(error);
    }
    rejectFailure(error);
  };
  /** Reject closure before both directions drain, except during deliberate parser/owner teardown. */
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
  let deadline: ReturnType<AgentRuntime["clock"]["setTimeout"]> | undefined;
  /** Start the fixed reply-drain deadline at receive EOF; later activity never refreshes it. */
  const eof = () => {
    deadline = runtime.clock.setTimeout(() => {
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
      if (deadline !== undefined) runtime.clock.clearTimeout(deadline);
    }
  });
  try {
    yield* race([
      call(function*() {
        const controller = new AbortController();
        const signal = receiveSignal = controller.signal;
        const input = socketBytes(socket, { signal });
        const source: AsyncIterableIterator<Uint8Array> = {
          /**
           * Keep parser iteration on the existing socket reader.
           *
           * @returns The same request-owned socket iterator.
           */
          [Symbol.asyncIterator]() {
            return this;
          },
          next: () => input.next(),
          /**
           * Mark early parser return so connection watchers distinguish teardown from peer failure.
           *
           * @returns The socket source cleanup promise.
           */
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
          /**
           * Write fully prepared captured replies through their existing request socket.
           * @param msgs Ordered complete signed responses; each write/drain finishes before the next message.
           */
          const sendMsgs = function*(msgs: Uint8Array[]): Operation<void> {
            yield* writeCesrTcpSocket(socket, async function*(signal) {
              for (const msg of msgs) {
                yield* chunkBytes(msg, { signal, maxChunkBytes: 65536 });
              }
            }, runtime.clock);
          };
          /**
           * Settle input and retain at most one authorized missing-state query on this connection.
           * @param frame Complete inbound frame; capture correlation before dispatch, then authorize from its exact decision.
           */
          const processFrame = function*(frame: CesrFrame): Operation<void> {
            const body = frame.body;
            if (body.ilk === Ilks.qry && pending) {
              const error = new Error("TCP connection already has an unresolved query");
              peers.add(error);
              throw error;
            }
            const pre = typeof body.ked?.i === "string" ? body.ked.i : undefined;
            let slot = body.ilk === Ilks.qry && body.said
              ? runtime.replies.reserve(body.said)
              : ([Ilks.icp, Ilks.dip, Ilks.rot, Ilks.drt, Ilks.ixn] as readonly string[]).includes(body.ilk!) && pre
                  && body.said
              ? runtime.replies.reserveEvent(pre, body.said)
              : undefined;
            let msgs: Uint8Array[] | undefined;
            yield* resource<void>(function*(provide) {
              try {
                yield* provide();
              } finally {
                slot?.close();
              }
            });
            const { decision } = yield* runtime.protocol.dispatch(frame, { local: true, escrows: true });
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
              } else {
                const captured = slot?.peekAll();
                if (captured) {
                  msgs = [...serviceHab.processCuesIter(captured.cues)];
                  slot!.takeAll();
                }
              }
            }
            yield* processCuesOnce(runtime, { hab: serviceHab });
            if (msgs) yield* sendMsgs(msgs);
          };
          while (!rxEOF || pending) {
            signal.throwIfAborted();
            if (pending?.ready) {
              yield* call(function*() {
                const captured = pending!.peekAll();
                if (captured) {
                  const msgs = [...serviceHab.processCuesIter(captured.cues)];
                  pending!.takeAll();
                  yield* sendMsgs(msgs);
                }
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
    if (error instanceof UnsupportedTelReplayError) onRefusal("unsupported-replay");
    else if (error instanceof WireParseError) onRefusal("wire");
    else if (peers.has(error)) onRefusal("peer");
    else throw error;
  }
}
/**
 * Supervise accepted connection children within the listener lifetime.
 * These functions provide the listener/connection responsibilities associated with
 * KERIpy direct-mode owners. Shutdown stops acceptance, joins connection children,
 * destroys remaining sockets and joins listener close before returning.
 *
 * @param port Local listen port; zero allows the operating system to select a port.
 * @param hostname Local bind address.
 * @param runtime Borrowed runtime whose stores must outlive all listener/connection children.
 * @param serviceHab Hosted AID used for request-owned replies.
 * @param options Positive drain timeout in milliseconds and refusal observer; defaults to 30000 and a console warning.
 * @throws Listener setup and unexpected child/cleanup failures; recognized peer refusals stay connection-local.
 */
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
      /**
       * Keep infrastructure failure visible even for handles rejected before parser creation.
       * @param error Native socket error; recognized peer errors remain connection-local.
       */
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
 * Run the witness TCP listener until cancellation or a fatal host failure.
 * These functions provide the listener/connection responsibilities associated with
 * KERIpy direct-mode owners. Shutdown stops acceptance, joins connection children,
 * destroys remaining sockets and joins listener close before returning.
 *
 * @param port Local listen port; zero allows the operating system to select a port.
 * @param hostname Local bind address.
 * @param runtime Borrowed runtime whose stores must outlive all listener/connection children.
 * @param serviceHab Hosted AID used for request-owned replies.
 * @param options Positive drain timeout in milliseconds and refusal observer; defaults to 30000 and a console warning.
 * @throws Listener setup and unexpected child/cleanup failures; recognized peer refusals stay connection-local.
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
