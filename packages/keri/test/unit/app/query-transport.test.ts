import { call, run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { attachmentPayload, collectPayload, concatBytes, parse, ResourceAdmissionError } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { introduce } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { acceptedEventReplayMessage } from "../../../src/app/habbing.ts";
import { queryTransportSink } from "../../../src/app/runtime-deliveries.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";

/** Collect the finite signed fixture through the same progressive frame boundary used by HTTP output. */
async function expectedMessages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const messages: Uint8Array[] = [];
  for await (const frame of parse(chunkBytes(bytes))) {
    try {
      // HTTP joins the signed body with its counted attachment enclosure, without a stream-level GVC.
      messages.push(concatBytes(frame.body.raw, await collectPayload(attachmentPayload(frame), 8 * 1024 * 1024)));
    } finally {
      await frame.essr?.discard();
    }
  }
  return messages;
}

Deno.test("query transport prepends KERIpy-style introduction before outbound qry delivery", async () => {
  const bodies: Uint8Array[] = [];
  const controller = new AbortController();
  const port = 9138;
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port,
    signal: controller.signal,
  }, async (request) => {
    bodies.push(await readCesrRequestBytes(request));
    return new Response(null, { status: 204 });
  });

  try {
    await run(function*() {
      const hby = yield* createHabery({
        name: `query-transport-local-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });
      const remoteHby = yield* createHabery({
        name: `query-transport-remote-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });

      try {
        const sender = hby.makeHab("sender", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const remoteController = remoteHby.makeHab(
          "remote-controller",
          undefined,
          {
            transferable: true,
            icount: 1,
            isith: "1",
            ncount: 1,
            nsith: "1",
            toad: 0,
          },
        );

        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        try {
          for (const msg of remoteHby.db.clonePreIter(remoteController.pre)) {
            ingestKeriBytes(runtime, msg);
          }
          ingestKeriBytes(
            runtime,
            remoteController.makeLocScheme(
              `http://127.0.0.1:${port}`,
              remoteController.pre,
              "http",
            ),
          );
          ingestKeriBytes(
            runtime,
            remoteController.makeEndRole(
              remoteController.pre,
              EndpointRoles.controller,
              true,
            ),
          );
          yield* processRuntimeTurn(runtime, { pollMailbox: false });

          const query = sender.query(
            remoteController.pre,
            remoteController.pre,
            { route: "logs" as const, q: { s: "0", fn: "0" } },
          );
          const sink = queryTransportSink(runtime, hby, sender);

          yield* sink.send({
            kind: "wire",
            cue: {
              kin: "query",
              pre: remoteController.pre,
              src: remoteController.pre,
              route: "logs" as const,
              q: { s: "0", fn: "0" },
            },
            messages: [query],
          });

          // The guarded cue sink queues delivery; this separate turn owns the response.
          assertEquals(bodies.length, 0);
          yield* runtime.deliveries.process(runtime);
          assertEquals(
            bodies,
            yield* call(() => expectedMessages(concatBytes(introduce(sender, remoteController.pre), query))),
          );
          const cue = {
            kin: "query" as const,
            pre: remoteController.pre,
            src: remoteController.pre,
            route: "logs" as const,
            q: { s: "0", fn: "0" },
          };
          assertThrows(() => sink.admitQuery!(cue, () => Promise.resolve(null) as never), TypeError);
          assertEquals(runtime.resources.used.bytes, 0, "async preparation cannot escape admitted scope");
          assertEquals(sink.admitQuery!(cue, () => null), "ineligible");
          assertEquals(runtime.resources.used.bytes, 0, "unresolved preparation cannot publish an owner");
          const readFailure = new Error("query iterator read failed");
          const cleanupFailure = new ResourceAdmissionError("foreign query cleanup busy", "busy");
          const cleanup = assertThrows(() =>
            sink.admitQuery!(cue, () => ({
              kind: "wire",
              cue,
              messages: {
                [Symbol.iterator]() {
                  return {
                    next() {
                      throw readFailure;
                    },
                    return() {
                      throw cleanupFailure;
                    },
                  };
                },
              },
            })), AggregateError);
          assertEquals(cleanup.errors, [readFailure, cleanupFailure]);
          assertEquals(runtime.resources.used.bytes, 0, "both query failure paths release unpublished credit");
          runtime.cues.push(cue);
          runtime.querying.configure({ hab: sender, sink });
          const sign = sender.query, resolve = sender.endsFor;
          const signed: Uint8Array[] = [];
          let resolved = 0;
          sender.query = function(...args) {
            const wire = sign.apply(this, args);
            signed.push(wire);
            return wire;
          };
          sender.endsFor = function(...args) {
            resolved++;
            return resolve.apply(this, args);
          };
          try {
            for (let index = 0; index < 8; index++) {
              runtime.deliveries.enqueue(() => ({
                url: `http://127.0.0.1:${port}`,
                body: query,
                bodyMode: "header",
                destination: remoteController.pre,
              }));
            }
            runtime.querying.enqueue({
              pre: remoteController.pre,
              src: remoteController.pre,
              route: "logs" as const,
              q: {},
            });
            const pending = runtime.querying.pending.peekHead();
            yield* processCuesOnce(runtime, { hab: sender, sink: runtime.querying });
            yield* runtime.querying.processPending();
            assertStrictEquals(runtime.cues.peekHead(), cue);
            assertStrictEquals(runtime.querying.pending.peekHead(), pending);
            assertEquals([signed.length, resolved], [0, 0], "item refusal precedes signing and route lookup");
            yield* runtime.deliveries.process(runtime);
            const pendingBytes = runtime.resources.used.bytes;
            assertEquals(pendingBytes > 0, true, "unresolved pending metadata remains owned");
            const foreign = new ResourceAdmissionError("foreign signing busy", "busy");
            sender.query = () => {
              throw foreign;
            };
            assertStrictEquals(
              yield* call(() =>
                assertRejects(() => run(() => processCuesOnce(runtime, { hab: sender, sink: runtime.querying })))
              ),
              foreign,
            );
            assertStrictEquals(runtime.cues.peekHead(), cue);
            assertStrictEquals(runtime.querying.pending.peekHead(), pending);
            assertEquals(runtime.resources.used.bytes, pendingBytes, "failed signing cannot retire pending metadata");
            sender.query = function(...args) {
              const wire = sign.apply(this, args);
              signed.push(wire);
              return wire;
            };
            yield* processCuesOnce(runtime, { hab: sender, sink: runtime.querying });
            yield* runtime.querying.processPending();
            assertEquals([runtime.cues.empty, runtime.querying.pending.empty, signed.length], [true, true, 2]);
            assertEquals(runtime.resources.used.bytes, 18 * 1024 ** 2, "two independent wire and route owners remain");
            const captured = concatBytes(introduce(sender, remoteController.pre), signed[0]);
            sender.rotate();
            yield* runtime.reactor.process((signal) =>
              chunkBytes(
                remoteController.makeLocScheme("http://unreachable.test/", remoteController.pre, "http"),
                { signal },
              )
            );
            const before = bodies.length;
            yield* runtime.deliveries.process(runtime);
            assertEquals(
              bodies.slice(before, before + (yield* call(() => expectedMessages(captured))).length),
              yield* call(() => expectedMessages(captured)),
              "captured endpoint and original signature survive later state changes",
            );
            assertEquals(signed.length, 2, "delivery never re-signs the admitted query");
            assertEquals(runtime.resources.used.bytes, 0);
          } finally {
            sender.query = sign;
            sender.endsFor = resolve;
          }
        } finally {
          yield* runtime.close();
        }
      } finally {
        yield* remoteHby.close(true);
        yield* hby.close(true);
      }
    });
  } finally {
    controller.abort();
    try {
      await server.finished;
    } catch {
      // Abort-driven shutdown is expected here.
    }
  }
});

Deno.test("query transport resolves explicit witness-targeted queries from witness locs", async () => {
  const bodies: Uint8Array[] = [];
  let reply: Uint8Array = new Uint8Array();
  const sockets = new Set<Socket>();
  let tcpConnections = 0;
  const tcpServer = createServer({ allowHalfOpen: true }, (socket) => {
    tcpConnections++;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.resume();
    socket.once("end", () => socket.end(reply));
  });
  await new Promise<void>((resolve) => tcpServer.listen(0, "127.0.0.1", resolve));
  const tcpUrl = `tcp://127.0.0.1:${(tcpServer.address() as { port: number }).port}`;
  const controller = new AbortController();
  const port = 9238;
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port,
    signal: controller.signal,
  }, async (request) => {
    bodies.push(await readCesrRequestBytes(request));
    return new Response(null, { status: 204 });
  });

  try {
    await run(function*() {
      const hby = yield* createHabery({
        name: `query-transport-witness-local-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });
      const remoteHby = yield* createHabery({
        name: `query-transport-witness-remote-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });

      try {
        const sender = hby.makeHab("sender", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const remoteWitness = remoteHby.makeHab("remote-witness", undefined, {
          transferable: false,
          icount: 1,
          isith: "1",
          toad: 0,
        });
        const remoteController = remoteHby.makeHab(
          "remote-controller",
          undefined,
          {
            transferable: true,
            icount: 1,
            isith: "1",
            ncount: 1,
            nsith: "1",
            wits: [remoteWitness.pre],
            toad: 1,
          },
        );

        remoteHby.db.wigs.put(
          [remoteController.pre, remoteController.kever!.said],
          remoteWitness.sign(remoteController.kever!.serder.raw, true),
        );
        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        try {
          for (const msg of remoteHby.db.clonePreIter(remoteWitness.pre)) {
            ingestKeriBytes(runtime, msg);
          }
          for (const msg of remoteHby.db.clonePreIter(remoteController.pre)) {
            ingestKeriBytes(runtime, msg);
          }
          ingestKeriBytes(
            runtime,
            remoteWitness.makeLocScheme(
              `http://127.0.0.1:${port}`,
              remoteWitness.pre,
              "http",
            ),
          );
          ingestKeriBytes(runtime, remoteWitness.makeLocScheme(tcpUrl, remoteWitness.pre, "tcp"));
          yield* processRuntimeTurn(runtime, { pollMailbox: false });

          const query = sender.query(
            remoteController.pre,
            remoteWitness.pre,
            {
              route: "logs" as const,
              q: {
                s: "0",
                fn: "0",
                a: { i: sender.pre, s: "0", d: sender.kever!.said! },
              },
            },
          );
          const sink = queryTransportSink(runtime, hby, sender);

          yield* sink.send({
            kind: "wire",
            cue: {
              kin: "query",
              pre: remoteController.pre,
              src: remoteWitness.pre,
              route: "logs" as const,
              q: {
                s: "0",
                fn: "0",
                a: { i: sender.pre, s: "0", d: sender.kever!.said! },
              },
              wits: [remoteWitness.pre],
            },
            messages: [query],
          });

          // The guarded cue sink queues delivery; this separate turn owns the response.
          assertEquals(bodies.length, 0);
          yield* runtime.deliveries.process(runtime);
          assertEquals(
            bodies,
            yield* call(() => expectedMessages(concatBytes(introduce(sender, remoteWitness.pre), query))),
          );
          assertEquals(tcpConnections, 0, "HTTP remains preferred when both schemes are advertised");
          hby.db.locs.rem([remoteWitness.pre, "http"]);
          remoteController.interact();
          assertEquals(hby.db.getKever(remoteController.pre)?.sn, 0);
          runtime.querying.configure({ hab: sender, sink });
          const enqueue = () =>
            runtime.querying.enqueue({
              pre: remoteController.pre,
              route: "logs" as const,
              q: { s: "1", fn: "0" },
              hab: sender,
              wits: [remoteWitness.pre],
            });
          const waiting = runtime.querying.watchSeqNo(remoteController.pre, 1, {
            hab: sender,
            wits: [remoteWitness.pre],
          });
          yield* runtime.querying.processPending();
          assertEquals(tcpConnections, 0, "guarded query preparation performs no network I/O");
          assertEquals(yield* runtime.deliveries.process(runtime), { retiredOwners: 1, pending: false });
          assertEquals(hby.db.getKever(remoteController.pre)?.sn, 0, "TCP drain does not satisfy the query");
          assertEquals(waiting.done, false);
          remoteHby.db.wigs.put(
            [remoteController.pre, remoteController.kever!.said],
            remoteWitness.sign(remoteController.kever!.serder.raw, true),
          );
          reply = acceptedEventReplayMessage(remoteHby, remoteController.pre, 1).message;
          enqueue();
          yield* runtime.querying.processPending();
          yield* runtime.deliveries.process(runtime);
          assertEquals(tcpConnections, 2);
          assertEquals(
            hby.db.getKever(remoteController.pre)?.sn,
            1,
            "signed TCP replay passes Kevery before state advances",
          );
          yield* runtime.querying.processPending();
          assertEquals(waiting.done, true, "the sequence continuation observes verified accepted state");
          assertEquals(
            runtime.cues.toArray().map((cue) =>
              cue.kin === "receipt"
                ? [cue.kin, cue.serder.pre, cue.serder.said]
                : cue.kin === "keyStateSaved"
                ? [cue.kin, cue.ksn.i, cue.ksn.d]
                : [cue.kin]
            ),
            ["receipt", "keyStateSaved"].map((kin) => [kin, remoteController.pre, remoteController.kever!.said]),
          );
          assertEquals(runtime.resources.used, { bytes: 3785, streams: 0, decryptions: 0 });
          runtime.cues.clear(); // Only queued accepted output is released; leaked transport credit would remain.
          assertEquals(runtime.resources.used, { bytes: 0, streams: 0, decryptions: 0 });
          yield* runtime.reactor.processEscrowsOnce();
        } finally {
          yield* runtime.close();
        }
      } finally {
        yield* remoteHby.close(true);
        yield* hby.close(true);
      }
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => tcpServer.close((error) => error ? reject(error) : resolve()));
    controller.abort();
    try {
      await server.finished;
    } catch {
      // Abort-driven shutdown is expected here.
    }
  }
});

Deno.test("query transport ingests open-ended SSE mailbox iterable responses for posted qry delivery", async () => {
  const bodies: Uint8Array[] = [];
  const controller = new AbortController();
  const port = 9338;
  const encoder = new TextEncoder();
  let replay = new Uint8Array();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port,
    signal: controller.signal,
  }, async (request) => {
    bodies.push(await readCesrRequestBytes(request));
    return new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(encoder.encode("retry: 5000\n\n"));
          stream.enqueue(
            encoder.encode("id: 0\nevent: /replay\nretry: 5000\ndata: "),
          );
          stream.enqueue(replay);
          stream.enqueue(encoder.encode("\n\n"));
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  });

  try {
    await run(function*() {
      const hby = yield* createHabery({
        name: `query-transport-sse-local-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });
      const remoteHby = yield* createHabery({
        name: `query-transport-sse-remote-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });

      try {
        const sender = hby.makeHab("sender", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const remoteController = remoteHby.makeHab(
          "remote-controller",
          undefined,
          {
            transferable: true,
            icount: 1,
            isith: "1",
            ncount: 1,
            nsith: "1",
            toad: 0,
          },
        );

        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        try {
          for (const msg of remoteHby.db.clonePreIter(remoteController.pre)) {
            ingestKeriBytes(runtime, msg);
          }
          ingestKeriBytes(
            runtime,
            remoteController.makeLocScheme(
              `http://127.0.0.1:${port}`,
              remoteController.pre,
              "http",
            ),
          );
          ingestKeriBytes(
            runtime,
            remoteController.makeEndRole(
              remoteController.pre,
              EndpointRoles.controller,
              true,
            ),
          );
          yield* processRuntimeTurn(runtime, { pollMailbox: false });
          remoteController.rotate();
          replay = Uint8Array.from(
            concatBytes(...remoteHby.db.clonePreIter(remoteController.pre)),
          );

          const query = sender.query(
            remoteController.pre,
            remoteController.pre,
            { route: "logs" as const, q: { s: "0", fn: "0" } },
          );
          const sink = queryTransportSink(runtime, hby, sender);

          yield* sink.send({
            kind: "wire",
            cue: {
              kin: "query",
              pre: remoteController.pre,
              src: remoteController.pre,
              route: "logs" as const,
              q: { s: "0", fn: "0" },
            },
            messages: [query],
          });
          yield* processRuntimeTurn(runtime, { pollMailbox: false });

          assertEquals(runtime.hby.db.getKever(remoteController.pre)?.sn, 1);
          assertEquals(
            bodies,
            yield* call(() => expectedMessages(concatBytes(introduce(sender, remoteController.pre), query))),
          );
        } finally {
          yield* runtime.close();
        }
      } finally {
        yield* remoteHby.close(true);
        yield* hby.close(true);
      }
    });
  } finally {
    controller.abort();
    try {
      await server.finished;
    } catch {
      // Abort-driven shutdown is expected here.
    }
  }
});

Deno.test("query delivery settles a streamed reply after releasing the guarded cue turn", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender");
    const peer = remote.makeHab("peer");
    let requests = 0;
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          fetch: () => {
            requests++;
            return Promise.resolve(
              new Response(new Uint8Array(concatBytes(...remote.db.clonePreIter(peer.pre))), {
                headers: { "Content-Type": "application/cesr" },
              }),
            );
          },
        },
      },
    });
    try {
      hby.db.locs.pin([peer.pre, "http"], { url: "http://query-peer.test/" });
      hby.db.ends.pin([peer.pre, EndpointRoles.controller, peer.pre], { allowed: true });
      const sink = queryTransportSink(runtime, hby, sender);
      const emission = {
        kind: "wire" as const,
        cue: { kin: "query" as const, pre: peer.pre, src: peer.pre, route: "logs" as const, q: {} },
        messages: [sender.query(peer.pre, peer.pre, { route: "logs" as const, q: {} })],
      };
      // The real guard owns cue handling. Reply parsing here would recursively wait for this same guard.
      yield* runtime.reactor.settle(undefined, {}, () => sink.send(emission));
      assertEquals(requests, 0);
      assertEquals(runtime.deliveries.hasPending, true);
      yield* runtime.deliveries.process(runtime);
      assertEquals(hby.db.getKever(peer.pre)?.said, peer.kever!.said);
      assertEquals(runtime.deliveries.hasPending, false);
    } finally {
      yield* runtime.close();
      yield* remote.close(true);
      yield* hby.close(true);
    }
  });
});
