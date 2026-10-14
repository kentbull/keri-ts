import { call, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { attachmentPayload, collectPayload, concatBytes, parse } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { introduce } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
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
            { s: "0", fn: "0" },
            "logs",
          );
          const sink = queryTransportSink(runtime, hby, sender);

          yield* sink.send({
            kind: "wire",
            cue: {
              kin: "query",
              pre: remoteController.pre,
              src: remoteController.pre,
              route: "logs",
              query: { s: "0", fn: "0" },
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
          yield* processRuntimeTurn(runtime, { pollMailbox: false });

          const query = sender.query(
            remoteController.pre,
            remoteWitness.pre,
            {
              s: "0",
              fn: "0",
              a: { i: sender.pre, s: "0", d: sender.kever!.said! },
            },
            "logs",
          );
          const sink = queryTransportSink(runtime, hby, sender);

          yield* sink.send({
            kind: "wire",
            cue: {
              kin: "query",
              pre: remoteController.pre,
              src: remoteWitness.pre,
              route: "logs",
              query: {
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
            { s: "0", fn: "0" },
            "logs",
          );
          const sink = queryTransportSink(runtime, hby, sender);

          yield* sink.send({
            kind: "wire",
            cue: {
              kin: "query",
              pre: remoteController.pre,
              src: remoteController.pre,
              route: "logs",
              query: { s: "0", fn: "0" },
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
        cue: { kin: "query" as const, pre: peer.pre, src: peer.pre, route: "logs", query: {} },
        messages: [sender.query(peer.pre, peer.pre, {}, "logs")],
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
