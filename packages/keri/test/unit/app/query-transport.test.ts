// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { concatBytes } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes, splitCesrStream } from "../../../src/app/cesr-http.ts";
import { introduce } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { queryTransportSink } from "../../../src/app/query-transport.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";

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
        const remoteController = remoteHby.makeHab("remote-controller", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });

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
            msgs: [query],
          });

          assertEquals(
            bodies,
            splitCesrStream(concatBytes(introduce(sender, remoteController.pre), query)),
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
        const remoteController = remoteHby.makeHab("remote-controller", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          wits: [remoteWitness.pre],
          toad: 1,
        });

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
            { s: "0", fn: "0", a: { i: sender.pre, s: "0", d: sender.kever!.said! } },
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
              query: { s: "0", fn: "0", a: { i: sender.pre, s: "0", d: sender.kever!.said! } },
              wits: [remoteWitness.pre],
            },
            msgs: [query],
          });

          assertEquals(
            bodies,
            splitCesrStream(concatBytes(introduce(sender, remoteWitness.pre), query)),
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
          stream.enqueue(encoder.encode("id: 0\nevent: /replay\nretry: 5000\ndata: "));
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
        const remoteController = remoteHby.makeHab("remote-controller", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });

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
            msgs: [query],
          });
          yield* processRuntimeTurn(runtime, { pollMailbox: false });

          assertEquals(runtime.hby.db.getKever(remoteController.pre)?.sn, 1);
          assertEquals(
            bodies,
            splitCesrStream(concatBytes(introduce(sender, remoteController.pre), query)),
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
