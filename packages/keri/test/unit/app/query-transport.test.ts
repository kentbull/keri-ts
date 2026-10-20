import { call, run, sleep, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { attachmentPayload, collectPayload, concatBytes, parse, parseBytes, SerderKERI } from "../../../../cesr/mod.ts";
import {
  createAgentRuntime,
  settleMailboxPollBatch,
  settleRuntimeIngress,
} from "../../../src/app/agent-runtime.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { httpClient } from "../../support/http-client.ts";

import { chunkBytes } from "../../../src/app/byte-source.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { introduce } from "../../../src/app/forwarding.ts";
import {
  acceptedEventReplayMessage,
  createHabery,
} from "../../../src/app/habbing.ts";

import { SeqNoQuerier } from "../../../src/app/querying.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { waitForTaskHalt } from "../../effection-http.ts";

/** Collect the finite signed fixture through the same progressive frame boundary used by HTTP output. */
async function expectedMessages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const messages: Uint8Array[] = [];
  for await (const frame of parse(chunkBytes(bytes))) {
    // HTTP joins the signed body with its counted attachment enclosure, without a stream-level GVC.
    messages.push(concatBytes(frame.body.raw, await collectPayload(attachmentPayload(frame))));
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

        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        try {
          for (const msg of remoteHby.db.clonePreIter(remoteController.pre)) {
            yield* settleRuntimeIngress(runtime, [msg]);
          }
          yield* settleRuntimeIngress(runtime, [
            remoteController.makeLocScheme(
              `http://127.0.0.1:${port}`,
              remoteController.pre,
              "http",
            ),
            remoteController.makeEndRole(
              remoteController.pre,
              EndpointRoles.controller,
              true,
            ),
          ]);

          runtime.cues.clear(); // Setup cues are separate from the queried replay under test.
          let query!: Uint8Array;
          const signQuery = sender.query;
          sender.query = function(...args) {
            return query = signQuery.apply(this, args);
          };
          const bodyStart = bodies.length;

          runtime.querying.enqueueCue({
            kin: "query",
            pre: remoteController.pre,
            src: remoteController.pre,
            route: "logs" as const,
            q: { s: "0", fn: "0" },
          }, sender);

          // The query owner queues signed wire; this separate turn owns the response.
          assertEquals(bodies.length, bodyStart);
          yield* runtime.querying.deliverOnce();
          assertEquals(
            bodies.slice(bodyStart),
            yield* call(() => expectedMessages(concatBytes(introduce(sender, remoteController.pre), query))),
          );
          const selected = hby.makeHab("selected");
          let selectedQuery!: Uint8Array;
          const selectedSign = selected.query;
          selected.query = function(...args) {
            return selectedQuery = selectedSign.apply(this, args);
          };
          const beforeSelected = bodies.length;
          runtime.querying.enqueueCue({
            kin: "query",
            pre: remoteController.pre,
            src: remoteController.pre,
            signer: selected.pre,
            route: "logs",
            q: {},
          }, sender);
          yield* runtime.querying.deliverOnce();
          assertEquals(
            bodies.slice(beforeSelected),
            yield* call(() => expectedMessages(concatBytes(introduce(selected, remoteController.pre), selectedQuery))),
            "the introduction must authenticate the selected query signer, not the ambient Hab",
          );
          const cue = {
            kin: "query" as const,
            pre: remoteController.pre,
            src: remoteController.pre,
            route: "logs" as const,
            q: { s: "0", fn: "0" },
          };
          runtime.cues.push(cue);
          runtime.querying.configure({ hab: sender });
          const sign = sender.query, resolve = sender.endsFor;
          const signed: Uint8Array[] = [];
          sender.query = function(...args) {
            const wire = sign.apply(this, args);
            signed.push(wire);
            return wire;
          };
          sender.endsFor = function(...args) {
            return resolve.apply(this, args);
          };
          try {
            runtime.querying.enqueue({
              pre: remoteController.pre,
              src: remoteController.pre,
              route: "logs" as const,
              q: {},
            });
            const pending = runtime.querying.pending.peekHead();
            const foreign = new Error("foreign signing busy");
            sender.query = () => {
              throw foreign;
            };
            yield* processCuesOnce(runtime, { hab: sender });
            assertEquals(runtime.cues.empty, true);
            assertStrictEquals(
              yield* call(() => assertRejects(() => run(() => runtime.querying.deliverOnce()))),
              foreign,
            );
            assertStrictEquals(runtime.querying.pending.peekHead(), pending);
            sender.query = function(...args) {
              const wire = sign.apply(this, args);
              signed.push(wire);
              return wire;
            };
            const before = bodies.length;
            yield* runtime.querying.deliverOnce();
            assertEquals([runtime.querying.pending.empty, signed.length], [true, 2]);
            const expected: Uint8Array[] = [];
            for (const query of signed) {
              expected.push(
                ...(yield* call(() => expectedMessages(concatBytes(introduce(sender, remoteController.pre), query)))),
              );
            }
            assertEquals(bodies.slice(before), expected);
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
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        try {
          for (const msg of remoteHby.db.clonePreIter(remoteWitness.pre)) {
            yield* settleRuntimeIngress(runtime, [msg]);
          }
          for (const msg of remoteHby.db.clonePreIter(remoteController.pre)) {
            yield* settleRuntimeIngress(runtime, [msg]);
          }
          yield* settleRuntimeIngress(runtime, [
            remoteWitness.makeLocScheme(
              `http://127.0.0.1:${port}`,
              remoteWitness.pre,
              "http",
            ),
            remoteWitness.makeLocScheme(tcpUrl, remoteWitness.pre, "tcp"),
          ]);

          runtime.cues.clear(); // Setup cues are separate from the queried replay under test.
          let query!: Uint8Array;
          const signQuery = sender.query;
          sender.query = function(...args) {
            return query = signQuery.apply(this, args);
          };
          const bodyStart = bodies.length;

          runtime.querying.enqueueCue({
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
          }, sender);

          // The query owner queues signed wire; this separate turn owns the response.
          assertEquals(bodies.length, bodyStart);
          yield* runtime.querying.deliverOnce();
          assertEquals(
            bodies.slice(bodyStart),
            yield* call(() => expectedMessages(concatBytes(introduce(sender, remoteWitness.pre), query))),
          );
          assertEquals(tcpConnections, 0, "HTTP remains preferred when both schemes are advertised");
          hby.db.locs.rem([remoteWitness.pre, "http"]);
          remoteController.interact();
          assertEquals(hby.db.getKever(remoteController.pre)?.sn, 0);
          runtime.querying.configure({ hab: sender });
          const enqueue = () =>
            runtime.querying.enqueue({
              pre: remoteController.pre,
              route: "logs" as const,
              q: { s: "1", fn: "0" },
              signer: sender.pre,
              wits: [remoteWitness.pre],
            });
          let accepted = false;
          const waiting = yield* spawn(function*() {
            yield* new SeqNoQuerier(hby.db, runtime.querying, remoteController.pre, 1, {
              signer: sender.pre,
              wits: [remoteWitness.pre],
            }).queryDo();
            accepted = true;
          });

          assertEquals(tcpConnections, 0, "guarded query preparation performs no network I/O");
          yield* runtime.querying.deliverOnce();
          assertEquals(runtime.querying.hasPendingDelivery, false);
          assertEquals(hby.db.getKever(remoteController.pre)?.sn, 0, "TCP drain does not satisfy the query");
          assertEquals(accepted, false);
          remoteHby.db.wigs.put(
            [remoteController.pre, remoteController.kever!.said],
            remoteWitness.sign(remoteController.kever!.serder.raw, true),
          );
          reply = acceptedEventReplayMessage(remoteHby, remoteController.pre, 1).message;
          enqueue();

          yield* runtime.querying.deliverOnce();
          assertEquals(tcpConnections, 2);
          assertEquals(
            hby.db.getKever(remoteController.pre)?.sn,
            1,
            "signed TCP replay passes Kevery before state advances",
          );

          yield* waiting;
          assertEquals(accepted, true, "the sequence workflow observes verified accepted state");
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

          runtime.cues.clear(); // Ordinary accepted output records carry no transport lease.

          yield* runtime.protocol.processEscrowsOnce();
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

Deno.test("ordinary query acknowledgement leaves state unchanged until an independent mailbox receiver accepts replay", async () => {
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
    const wire = await readCesrRequestBytes(request);
    bodies.push(wire);
    const body = (await parseBytes(wire))[0].body;
    if (!(body instanceof SerderKERI) || body.route !== "mbx") return new Response(null, { status: 204 });
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

        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        try {
          for (const msg of remoteHby.db.clonePreIter(remoteController.pre)) {
            yield* settleRuntimeIngress(runtime, [msg]);
          }
          yield* settleRuntimeIngress(runtime, [
            remoteController.makeLocScheme(
              `http://127.0.0.1:${port}`,
              remoteController.pre,
              "http",
            ),
            remoteController.makeEndRole(
              remoteController.pre,
              EndpointRoles.controller,
              true,
            ),
          ]);

          remoteController.rotate();
          replay = Uint8Array.from(
            concatBytes(...remoteHby.db.clonePreIter(remoteController.pre)),
          );

          runtime.cues.clear(); // Setup cues are separate from the queried replay under test.
          let query!: Uint8Array;
          const signQuery = sender.query;
          sender.query = function(...args) {
            return query = signQuery.apply(this, args);
          };
          const bodyStart = bodies.length;

          let accepted = false;
          const waiting = yield* spawn(function*() {
            yield* new SeqNoQuerier(hby.db, runtime.querying, remoteController.pre, 1, { signer: sender.pre })
              .queryDo();
            accepted = true;
          });
          yield* runtime.querying.deliverOnce();
          assertEquals([hby.db.getKever(remoteController.pre)?.sn, accepted], [0, false]);
          assertEquals(
            bodies.slice(bodyStart),
            yield* call(() => expectedMessages(concatBytes(introduce(sender, remoteController.pre), query))),
          );
          yield* settleRuntimeIngress(runtime, [sender.makeEndRole(remoteController.pre, EndpointRoles.mailbox, true)]);
          const receiving = yield* spawn(() =>
            runtime.mailboxPoller.pollDo(batch => settleMailboxPollBatch(runtime, batch))
          );
          try {
            const deadline = Date.now() + 2_000;
            while (
              (!accepted || hby.db.tops.get([sender.pre, remoteController.pre])?.topics["/replay"] !== 0)
              && Date.now() < deadline
            ) {
              yield* sleep(5);
            }
            assertEquals(hby.db.getKever(remoteController.pre)?.sn, 1);
            assertEquals(accepted, true);
            assertEquals(hby.db.tops.get([sender.pre, remoteController.pre])?.topics["/replay"], 0);
            yield* waiting;
          } finally {
            yield* waitForTaskHalt(receiving);
            yield* waiting.halt();
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

Deno.test("ordinary query delivery drains an unsolicited response while accepted evidence remains with the receiver", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender");
    const peer = remote.makeHab("peer");
    let requests = 0;
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(() => {
        requests++;
        return Promise.resolve(
          new Response(new Uint8Array(concatBytes(...remote.db.clonePreIter(peer.pre))), {
            headers: { "Content-Type": "application/cesr" },
          }),
        );
      }),
      systemClock,
    );
    try {
      hby.db.locs.pin([peer.pre, "http"], { url: "http://query-peer.test/" });
      hby.db.ends.pin([peer.pre, EndpointRoles.controller, peer.pre], { allowed: true });

      runtime.querying.enqueueCue({ kin: "query", pre: peer.pre, src: peer.pre, route: "logs", q: {} }, sender);
      assertEquals([requests, runtime.querying.pending.length], [0, 1]);
      yield* runtime.querying.deliverOnce();
      assertEquals(hby.db.getKever(peer.pre), null);
      yield* runtime.reactor.processBytes(concatBytes(...remote.db.clonePreIter(peer.pre)));
      assertEquals(hby.db.getKever(peer.pre)?.said, peer.kever!.said);
      assertEquals(runtime.querying.hasPendingDelivery, false);
    } finally {
      yield* runtime.close();
      yield* remote.close(true);
      yield* hby.close(true);
    }
  });
});
