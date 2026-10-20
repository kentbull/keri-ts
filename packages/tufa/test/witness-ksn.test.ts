import { SerderKERI } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  createAgentRuntime,
  createHabery,
  settleRuntimeIngress,
  witnessReceiptPost,
} from "keri-ts/runtime";
import { FetchHttpClient } from "../../keri/src/app/http-client.ts";
import { systemClock } from "../../keri/src/app/runtime-clock.ts";
import { createProtocolHandler } from "../src/http/protocol-handler.ts";

Deno.test("tufa witness KSN requires destination and receipts and independently verifies endorsed state", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const peer = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    let server: Deno.HttpServer<Deno.NetAddr> | undefined;
    const client = Deno.createHttpClient({});
    try {
      const witness = hby.makeHab("witness", undefined, { transferable: false });
      const controller = peer.makeHab("controller", undefined, { wits: [witness.pre], toad: 1 });
      const unreceipted = hby.makeHab("unreceipted", undefined, { wits: [witness.pre], toad: 1 });
      const handle = createProtocolHandler(runtime, {
        serviceHab: witness,
        witnessHab: witness,
        hostedPrefixes: [witness.pre],
      });
      server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handle);
      const origin = `http://127.0.0.1:${server.addr.port}`;
      const get = (pre: string | null, destination: string | null = witness.pre) =>
        fetch(
          new Request(
            origin + "/ksn" + (pre ? "?pre=" + pre : ""),
            { headers: destination ? { "CESR-DESTINATION": destination } : {} },
          ),
          { client },
        );
      for (
        const [pre, destination, status] of [
          [witness.pre, null, 400],
          [witness.pre, controller.pre, 400],
          [null, witness.pre, 400],
          [controller.pre, witness.pre, 404],
          [unreceipted.pre, witness.pre, 404],
        ] as const
      ) {
        const rejected = yield* call(() => get(pre, destination));
        yield* call(() => rejected.arrayBuffer());
        assertEquals(rejected.status, status);
      }
      const event = [...peer.db.clonePreIter(controller.pre)][0];
      assertEquals((yield* witnessReceiptPost(runtime, witness, event)).kind, "accepted");
      // The actual query handler captures metadata without hydrating an event or pulling output early.
      const read = hby.db.getEvt;
      hby.db.getEvt = () => {
        throw new Error("GET hydrated before response pull");
      };
      try {
        const lazy = yield* call(() => handle(new Request(origin + `/query?typ=kel&pre=${controller.pre}`)));
        assertEquals(lazy.status, 200);
        yield* call(() => lazy.body!.cancel());
      } finally {
        hby.db.getEvt = read;
      }
      for (
        const [query, status] of [
          ["", 400],
          ["?typ=kel", 400],
          ["?typ=tel", 501],
          ["?typ=unknown", 400],
          ["?typ=kel&pre=unknown", 200],
          [`?typ=kel&pre=${controller.pre}&sn=99`, 400],
        ] as const
      ) {
        const result = yield* call(() => fetch(origin + "/query" + query, { client }));
        assertEquals(result.status, status);
        const bytes = yield* call(() => result.arrayBuffer());
        if (status === 200) assertEquals(bytes.byteLength, 0);
      }
      const replay = yield* call(() => fetch(origin + `/query?typ=kel&pre=${controller.pre}&sn=0`, { client }));
      assertEquals(replay.status, 200);
      assertEquals(
        new SerderKERI({ raw: new Uint8Array(yield* call(() => replay.arrayBuffer())) }).said,
        controller.pre,
      );

      const response = yield* call(() => get(controller.pre));
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-type"), "application/cesr");
      const bytes = new Uint8Array(yield* call(() => response.arrayBuffer()));
      const notice = new SerderKERI({ raw: bytes });
      assertEquals(notice.pvrsn.major, 1, "preserve existing reply wire generation");
      assertEquals(notice.ked?.r, `/ksn/${witness.pre}`);
      for (const tamper of [false, true]) {
        const observer = yield* createHabery({
          name: crypto.randomUUID(),
          temp: true,
          skipConfig: true,
          skipSignator: true,
        });
        const verifier = yield* createAgentRuntime(
          observer,
          new FetchHttpClient(),
          systemClock,
        );
        try {
          yield* settleRuntimeIngress(verifier, hby.db.clonePreIter(witness.pre));
          const evidence = bytes.slice();
          if (tamper) evidence[evidence.length - 8] = evidence[evidence.length - 8] === 65 ? 66 : 65;
          yield* settleRuntimeIngress(verifier, [evidence]);
          const saved = observer.db.knas.get([controller.pre, witness.pre]);
          if (tamper) assertEquals(saved, null, "changed signature must not save state");
          else {
            assertExists(saved);
            const state = observer.db.ksns.get([saved.qb64]);
            assertEquals(state?.i, controller.pre);
            assertEquals(state?.d, controller.kever!.said);
            assertEquals(state?.s, "0");
          }
        } finally {
          yield* verifier.close();
          yield* observer.close();
        }
      }
    } finally {
      if (server) yield* call(() => server!.shutdown());
      client.close();
      yield* runtime.close();
      yield* peer.close();
      yield* hby.close();
    }
  });
});
