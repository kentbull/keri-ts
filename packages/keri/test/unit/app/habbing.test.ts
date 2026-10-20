import { run } from "effection";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import {
  Cigar,
  concatBytes,
  Counter,
  CtrDexV1,
  CtrDexV2,
  Diger,
  parseCounterFromText,
  SerderKERI,
  Siger,
  Signer,
  smell,
  Verfer,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { createAgentRuntime, settleRuntimeIngress } from "../../../src/app/agent-runtime.ts";
import { createConfiger } from "../../../src/app/configing.ts";
import { Anchorer, DELEGATE_REQUEST_ROUTE } from "../../../src/app/delegating.ts";
import { introduce, type Poster, type PosterEvent } from "../../../src/app/forwarding.ts";
import { createHabery, eventPayloadMessage, eventReplayMessage, SIGNER } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";

import type { QueryRequest } from "../../../src/core/cues.ts";
import { Kevery } from "../../../src/core/eventing.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";
import { fetchStoredTsgs } from "../../../src/core/routing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

function makeExchangeSerder(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  return exchangeMessage(route, payload, args)[0];
}

Deno.test("Hab.make propagates temporary keeper mode into key inception", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-temp-incept-${crypto.randomUUID()}`,
      temp: true,
    });
    type InceptArgs = NonNullable<Parameters<typeof hby.mgr.incept>[0]>;
    const originalIncept = hby.mgr.incept.bind(hby.mgr);
    const seenTemps: Array<boolean | undefined> = [];
    hby.mgr.incept = ((args: InceptArgs = {}) => {
      seenTemps.push(args.temp);
      return originalIncept(args);
    }) as typeof hby.mgr.incept;
    try {
      hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      assertEquals(seenTemps, [true]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Hab.rotate reuses one Habery for success and rollback coverage", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-rotate-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const acceptedHab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const priorKey = acceptedHab.kever?.verfers[0]?.qb64 ?? "";
      const priorSaid = acceptedHab.kever?.said ?? "";

      const msg = acceptedHab.rotate({ ncount: 1, nsith: "1" });
      const nextState = hby.db.getState(acceptedHab.pre);
      const nextKever = acceptedHab.kever;

      assertEquals(nextKever?.sn, 1);
      assertEquals(nextState?.s, "1");
      assertNotEquals(nextState?.d, priorSaid);
      assertNotEquals(nextState?.k?.[0], priorKey);
      assertEquals(hby.db.kels.getLast(acceptedHab.pre, 1), nextState?.d);
      assertEquals(hby.db.getFel(acceptedHab.pre, 1), nextState?.d);
      assertEquals(msg.length > 0, true);

      const rollbackHab = hby.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const before = hby.ks.getSits(rollbackHab.pre);

      try {
        rollbackHab.rotate({ isith: "2", ncount: 1, nsith: "1" });
        throw new Error("Expected invalid rotation to throw.");
      } catch (error) {
        assertEquals(
          error instanceof Error ? error.message : String(error),
          "Invalid current threshold for 1 keys.",
        );
      }

      const after = hby.ks.getSits(rollbackHab.pre);
      assertEquals(after?.old.pubs, before?.old.pubs);
      assertEquals(after?.new.pubs, before?.new.pubs);
      assertEquals(after?.nxt.pubs, before?.nxt.pubs);
      assertEquals(rollbackHab.kever?.sn, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Hab.interact advances accepted state, preserves keys, and commits anchor data", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-interact-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const acceptedHab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const priorKey = acceptedHab.kever?.verfers[0]?.qb64 ?? "";
      const priorSaid = acceptedHab.kever?.said ?? "";
      const committed = [
        {
          i: acceptedHab.pre,
          s: "0",
          d: priorSaid,
        },
      ];

      const msg = acceptedHab.interact({ data: committed });
      const nextState = hby.db.getState(acceptedHab.pre);
      const nextKever = acceptedHab.kever;
      const event = nextState?.d ? hby.db.getEvtSerder(acceptedHab.pre, nextState.d) : null;

      assertEquals(nextKever?.sn, 1);
      assertEquals(nextState?.s, "1");
      assertNotEquals(nextState?.d, priorSaid);
      assertEquals(nextState?.k?.[0], priorKey);
      assertEquals(hby.db.kels.getLast(acceptedHab.pre, 1), nextState?.d);
      assertEquals(hby.db.getFel(acceptedHab.pre, 1), nextState?.d);
      if (!event) {
        throw new Error("Expected stored interaction event serder.");
      }
      assertInstanceOf(event, SerderKERI);
      assertEquals(event.ked?.["a"], committed);
      assertEquals(msg.length > 0, true);

      const estOnlyHab = hby.makeHab("est-only", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        estOnly: true,
      });
      assertThrows(
        () => estOnlyHab.interact(),
        Error,
        "was not accepted",
      );
      assertEquals(estOnlyHab.kever?.sn, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Hab.interact preserves hex-width boundaries across successive accepted events", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-interact-hex-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const acceptedHab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      for (let step = 1; step <= 256; step += 1) {
        const msg = acceptedHab.interact({ data: [{ step }] });
        assertEquals(msg.length > 0, true);
      }

      const finalState = hby.db.getState(acceptedHab.pre);
      assertEquals(acceptedHab.kever?.sn, 256);
      assertEquals(finalState?.s, "100");

      for (
        const [sn, expectedHex] of [
          [15, "f"],
          [16, "10"],
          [255, "ff"],
          [256, "100"],
        ] as const
      ) {
        const said = hby.db.kels.getLast(acceptedHab.pre, sn);
        assertExists(said);
        assertEquals(hby.db.getFel(acceptedHab.pre, sn), said);

        const event = hby.db.getEvtSerder(acceptedHab.pre, said);
        assertExists(event);
        assertInstanceOf(event, SerderKERI);
        assertEquals(event.ked?.["s"], expectedHex);

        if (sn === 256) {
          assertEquals(event.ked?.["a"], [{ step: 256 }]);
        }
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Anchorer uses the proxy habitat for delegated inception and retries witness-backed anchor queries from dune", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-delegate-coordinator-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegatorWitness = hby.makeHab("delegator-witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      hby.db.locs.pin([delegatorWitness.pre, "tcp"], {
        url: "tcp://127.0.0.1:9451",
      });
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [delegatorWitness.pre],
        toad: 1,
      });
      const proxy = hby.makeHab("proxy", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const delegate = hby.makeHab("delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        delpre: delegator.pre,
      });

      const sent: Array<
        {
          sender: string;
          recipient: string;
          topic?: string;
          message: Uint8Array;
        }
      > = [];
      const queuedQueries: QueryRequest[] = [];
      const postman = {
        send(evt: PosterEvent) {
          sent.push({ sender: evt.src, recipient: evt.dest, topic: evt.topic, message: evt.msg });
          return evt;
        },
        *wait(evt: PosterEvent) {
          return { kin: "sent", evt, deliveries: ["mock"] };
        },
      } as unknown as Poster;
      const querying = {
        enqueue(request: QueryRequest) {
          queuedQueries.push(request);
        },
      };
      const coordinator = new Anchorer(
        hby,
        postman,
        querying,
        null,
        new FetchHttpClient(),
        systemClock,
      );

      const started = coordinator.beginLatest(delegate.pre, 0, {
        communicationHab: proxy,
      });
      assertEquals(started.pre, delegate.pre);
      const initial = yield* coordinator.processAllOnce();
      assertEquals(initial[0]?.kind, "advance");
      assertEquals(
        initial[0] && "to" in initial[0] ? initial[0].to : null,
        "waitingDelegatorAnchor",
      );
      assertEquals(
        coordinator.workflowStatus(delegate.pre, "0").proxyDependent,
        true,
      );
      assertEquals(
        sent.map(({ sender, recipient, topic }) => ({
          sender,
          recipient,
          topic,
        })),
        [
          { sender: proxy.pre, recipient: delegator.pre, topic: "/delegate" },
          { sender: proxy.pre, recipient: delegator.pre, topic: "/delegate" },
        ],
      );
      const request = new SerderKERI({ raw: sent[0]!.message });
      assertEquals(request.route, DELEGATE_REQUEST_ROUTE);
      assertEquals(request.pre, proxy.pre);
      assertEquals(request.ked?.rp, "");
      assertEquals(request.ked?.a, { delpre: delegator.pre });
      assertEquals(
        (request.ked?.e as Record<string, Record<string, unknown>>)?.evt?.["i"],
        delegate.pre,
      );
      assertEquals(
        (request.ked?.e as Record<string, Record<string, unknown>>)?.evt?.["t"],
        "dip",
      );
      const event = new SerderKERI({ raw: sent[1]!.message });
      assertEquals(event.pre, delegate.pre);
      assertEquals(event.ilk, "dip");
      assertEquals(queuedQueries, [{
        pre: delegator.pre,
        route: "logs",
        q: {
          fn: "0",
          s: "0",
          a: { i: delegate.pre, s: "0", d: delegate.kever!.said! },
        },
        signer: proxy.pre,
        wits: [delegatorWitness.pre],
      }]);

      for (let i = 0; i < 7; i += 1) {
        yield* coordinator.processAllOnce();
      }
      assertEquals(queuedQueries.length, 1);
      yield* coordinator.processAllOnce();
      assertEquals(queuedQueries.length, 2);
      assertEquals(hby.db.dune.cnt(), 1);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Anchorer completes delegated inception once the delegator approval is locally discoverable", async () => {
  let reply: Uint8Array = new Uint8Array();
  let publications = 0;
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    publications++;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.resume();
    socket.once("end", () => socket.end(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(function*() {
      const hby = yield* createHabery({
        name: `habery-delegate-coordinator-complete-${crypto.randomUUID()}`,
        temp: true,
      });
      try {
        const delegator = hby.makeHab("delegator", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const proxy = hby.makeHab("proxy", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const delegate = hby.makeHab("delegate", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
          delpre: delegator.pre,
        });

        const postman = {
          send(evt: PosterEvent) {
            return evt;
          },
          *wait(evt: PosterEvent) {
            return { kin: "sent", evt, deliveries: ["mock"] };
          },
        } as unknown as Poster;
        const querying = {
          enqueue() {
            return;
          },
        };
        const coordinator = new Anchorer(
          hby,
          postman,
          querying,
          null,
          new FetchHttpClient(),
          systemClock,
        );

        coordinator.beginLatest(delegate.pre, 0, {
          communicationHab: proxy,
        });
        yield* coordinator.processAllOnce();

        assertExists(delegate.kever?.said);
        delegator.interact({
          data: [{
            i: delegate.pre,
            s: "0",
            d: delegate.kever.said,
          }],
        });

        const completed = yield* coordinator.processAllOnce();
        assertEquals(completed[0]?.kind, "complete");
        assertExists(hby.db.aess.get(dgKey(delegate.pre, delegate.kever.said)));
        assertEquals(hby.db.cdel.cntOn(delegate.pre), 1);
        assertEquals(hby.db.dune.cnt(), 0);
        assertEquals(coordinator.complete(delegate.pre, 0), true);
        const peerHby = yield* createHabery({
          name: `anchor-peer-${crypto.randomUUID()}`,
          temp: true,
          skipConfig: true,
        });
        try {
          const peer = peerHby.makeHab("peer");
          reply = eventReplayMessage(peerHby, peer.kever!.serder);
          const witness = hby.makeHab("publication-witness", undefined, { transferable: false });
          const witnessed = hby.makeHab("witnessed-delegate", undefined, {
            delpre: delegator.pre,
            wits: [witness.pre],
            toad: 1,
          });
          const event = witnessed.kever!.serder;
          hby.db.wigs.put(dgKey(witnessed.pre, event.said!), witness.sign(event.raw, true));
          hby.db.locs.pin([witness.pre, "tcp"], {
            url: `tcp://127.0.0.1:${(server.address() as { port: number }).port}`,
          });
          delegator.interact({ data: [{ i: witnessed.pre, s: "0", d: event.said }] });
          const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
          try {
            runtime.postman.send = postman.send; // Reuse the fixture's delegator mailbox sink; witness TCP is real.
            runtime.postman.wait = postman.wait;
            runtime.delegating.beginLatest(witnessed.pre, 0, { communicationHab: proxy });
            // Start at the already-receipted anchor-waiting frontier; publication runs through the concrete Anchorer.
            hby.db.dpwe.rem([witnessed.pre, "0"]);
            hby.db.dune.pin([witnessed.pre, "0"], event);
            assertEquals(hby.db.getKever(peer.pre), null);
            yield* runtime.delegating.processAllOnce();
            assertEquals(publications > 0, true);
            assertEquals(
              hby.db.getKever(peer.pre)?.sn,
              0,
              "Anchorer uses its borrowed protocol receiver for verified TCP reply intake",
            );
            assertEquals(runtime.delegating.complete(witnessed.pre, 0), true);

            yield* runtime.protocol.processEscrowsOnce();
          } finally {
            yield* runtime.close();
          }
        } finally {
          yield* peerHby.close(true);
        }
      } finally {
        yield* hby.close(true);
      }
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

Deno.test("Anchorer fails delegated inception without an explicit proxy", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-delegate-requires-proxy-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const delegate = hby.makeHab("delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        delpre: delegator.pre,
      });

      const postman = {
        send() {
          throw new Error("delegated inception should not send without a proxy");
        },
      } as unknown as Poster;
      const querying = {
        enqueue() {
          throw new Error(
            "delegated inception should not query without a proxy",
          );
        },
      };
      const coordinator = new Anchorer(
        hby,
        postman,
        querying,
        null,
        new FetchHttpClient(),
        systemClock,
      );

      coordinator.beginLatest(delegate.pre, 0);
      const initial = yield* coordinator.processAllOnce();
      assertEquals(initial[0]?.kind, "fail");
      assertStringIncludes(
        initial[0]?.reason ?? "",
        "requires --proxy <alias>",
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Anchorer uses the delegate habitat for delegated rotation and queues a witness-backed anchor query by default", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-delegate-rotation-default-sender-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegatorWitness = hby.makeHab("delegator-witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      hby.db.locs.pin([delegatorWitness.pre, "http"], {
        url: "http://127.0.0.1:9452/",
      });
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [delegatorWitness.pre],
        toad: 1,
      });
      const delegate = hby.makeHab("delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        delpre: delegator.pre,
      });
      delegator.interact({
        data: [{
          i: delegate.pre,
          s: "0",
          d: delegate.kever!.said,
        }],
      });
      const approving = hby.db.getEvtSerder(
        delegator.pre,
        delegator.kever!.said,
      );
      assertExists(approving?.sner);
      hby.db.aess.pin(dgKey(delegate.pre, delegate.kever!.said!), [
        approving.sner,
        new Diger({ qb64: approving.said! }),
      ]);
      delegate.rotate({ data: [{ step: "rot" }] });

      const sent: Array<
        { sender: string; recipient: string; message: Uint8Array }
      > = [];
      const queuedQueries: QueryRequest[] = [];
      const postman = {
        send(evt: PosterEvent) {
          sent.push({ sender: evt.src, recipient: evt.dest, message: evt.msg });
          return evt;
        },
        *wait(evt: PosterEvent) {
          return { kin: "sent", evt, deliveries: ["mock"] };
        },
      } as unknown as Poster;
      const querying = {
        enqueue(request: QueryRequest) {
          queuedQueries.push(request);
        },
      };
      const coordinator = new Anchorer(
        hby,
        postman,
        querying,
        null,
        new FetchHttpClient(),
        systemClock,
      );

      coordinator.beginLatest(delegate.pre, delegate.kever!.sn);
      const initial = yield* coordinator.processAllOnce();
      assertEquals(initial[0]?.kind, "advance");
      assertEquals(sent[0]?.sender, delegate.pre);
      assertEquals(
        new SerderKERI({ raw: sent[0]!.message }).route,
        DELEGATE_REQUEST_ROUTE,
      );
      assertEquals(new SerderKERI({ raw: sent[1]!.message }).ilk, "drt");
      assertEquals(queuedQueries, [{
        pre: delegator.pre,
        route: "logs",
        q: {
          fn: "0",
          s: "0",
          a: {
            i: delegate.pre,
            s: delegate.kever!.sn.toString(16),
            d: delegate.kever!.said!,
          },
        },
        signer: delegate.pre,
        wits: [delegatorWitness.pre],
      }]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Hab.replyToOobi refuses unapproved delegated state and serves approved delegation chains", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-delegate-oobi-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const delegate = hby.makeHab("delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        delpre: delegator.pre,
      });

      assertEquals(delegate.replyToOobi(delegate.pre).length, 0);

      assertExists(delegate.kever?.said);
      delegator.interact({
        data: [{
          i: delegate.pre,
          s: "0",
          d: delegate.kever.said,
        }],
      });
      assertExists(delegator.kever?.said);
      const approving = hby.db.getEvtSerder(
        delegator.pre,
        delegator.kever.said,
      );
      assertExists(approving?.sner);
      hby.db.aess.pin(dgKey(delegate.pre, delegate.kever.said), [
        approving.sner,
        new Diger({ qb64: approving.said! }),
      ]);

      const approved = delegate.replyToOobi(delegate.pre);
      const expected = concatBytes(
        ...hby.db.cloneDelegation(delegate.kever!),
        ...hby.db.clonePreIter(delegate.pre),
      );
      assertEquals([...approved], [...expected]);
      const introduction = concatBytes(
        ...hby.db.clonePreIter(delegate.pre),
        ...hby.db.cloneDelegation(delegate.kever!),
        delegate.replyEndRole(delegate.pre),
      );
      assertEquals(introduce(delegate, delegator.pre), introduction);
      const read = hby.db.getEvt;
      const fault = new Error("event hydration follows metadata capture");
      hby.db.getEvt = () => {
        throw fault;
      };
      let selectorReads = 0;
      const selectors = [delegate.pre];
      Object.defineProperty(selectors, Symbol.iterator, {
        value: () => {
          throw new Error("caller selector iterator must not execute");
        },
      });
      Object.defineProperty(selectors, 0, {
        get() {
          selectorReads++;
          return delegate.pre;
        },
      });
      const source = delegate.replyToOobiMessages(delegate.pre, undefined, selectors);
      assertEquals(selectorReads, 0); // Input is borrowed until iterator acquisition.

      assertThrows(() => [...source], Error, fault.message);
      assertEquals(selectorReads, 1);
      hby.db.getEvt = read;

      const iterator = source[Symbol.iterator]();
      assertEquals(selectorReads, 2); // Acquisition, before its first next(), captures the filter.
      const first = iterator.next();
      assertExists(first.value);
      delegator.interact(); // Accepted after acquisition: excluded from this captured horizon.
      const remainder = [...{ [Symbol.iterator]: () => iterator }];
      assertEquals([...concatBytes(first.value, ...remainder)], [...approved]);
      const replayRange = hby.db.replayRange;
      hby.db.replayRange = function*(range) {
        if (range[0] !== delegate.pre) return; // Durable anchor exists, but no readable parent chain.
        yield* replayRange.call(this, range);
      };
      assertEquals([...delegate.replyToOobiMessages(delegate.pre)], []);
      hby.db.replayRange = replayRange;
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Habery eagerly loads persisted habitats on open", async () => {
  const name = `habery-load-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const alias = "alice";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      assertEquals(hby.habs.get(hab.pre)?.name, alias);
      const storedHab = hby.db.getHab(hab.pre);
      assertEquals(storedHab?.hid, hab.pre);
      assertEquals(storedHab?.name, alias);
      assertEquals(storedHab ? "sigs" in storedHab : false, false);
      const state = hby.db.getState(hab.pre);
      assertEquals(state?.i, hab.pre);
      assertEquals(state?.k, hab.kever?.verfers.map((verfer) => verfer.qb64));
      assertEquals(hby.db.kels.getLast(hab.pre, 0), state?.d);
      assertEquals(hby.db.getFel(hab.pre, 0), state?.d);
      assertEquals(hab.accepted, true);
      assertEquals(hby.db.getKever(hab.pre)?.pre, hab.pre);
      assertEquals(hby.prefixes.includes(hab.pre), true);
      assertStrictEquals(hab.kevery, hby.kevery);

      const evt = state?.d ? hby.db.getEvt(dgKey(hab.pre, state.d)) : null;
      const evtText = evt ? new TextDecoder().decode(evt) : "";
      const match = evtText.match(/"d":"([^"]+)"/);
      if (!match) {
        throw new Error("Expected inception event SAID in stored event.");
      }
      const said = match[1];
      assertEquals(hab.pre, said);
      assertEquals(hby.db.getSigs(hab.pre, said).length, 1);
      if (!evt) {
        throw new Error("Expected stored inception event bytes.");
      }
      assertEquals(smell(evt).smellage.size, evt.length);
      const evtSerder = hby.db.getEvtSerder(hab.pre, said);
      assertEquals(evtSerder instanceof SerderKERI, true);
      assertEquals(evtSerder?.pre, hab.pre);
      assertEquals(evtSerder?.said, said);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      assertEquals(hby.habs.size, 1);
      const hab = [...hby.habs.values()][0];
      assertEquals(hab?.name, alias);
      assertEquals(hby.habByName(alias)?.pre, hab?.pre);
      assertEquals(hab?.kever?.pre, hab?.pre);
      assertEquals(hab?.accepted, true);
      assertEquals(hby.prefixes.includes(hab?.pre ?? ""), true);
      assertStrictEquals(hab?.kevery, hby.kevery);
      const storedHab = hab ? hby.db.getHab(hab.pre) : null;
      assertEquals(storedHab?.hid, hab?.pre);
      assertEquals(storedHab?.name, alias);
      assertEquals(storedHab ? "sigs" in storedHab : false, false);
      const state = hab ? hby.db.getState(hab.pre) : null;
      assertEquals(state?.i, hab?.pre);
      assertEquals(state?.k, hab?.kever?.verfers.map((verfer) => verfer.qb64));
      assertEquals(
        hab ? hby.db.getKever(hab.pre)?.pre : null,
        hab?.pre ?? null,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery makeGroupHab creates a local group inception and persists member metadata", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-group-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const member1 = hby.makeHab("member1", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const member2 = hby.makeHab("member2", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const group = hby.makeGroupHab(
        "team",
        member1,
        [
          member1.pre,
          member2.pre,
        ],
        undefined,
        undefined,
        {
          isith: "2",
          nsith: "2",
          toad: 0,
        },
      );

      assertEquals(group.hab.pre, group.serder.pre);
      assertEquals(group.sigers.map((siger) => siger.index), [0, 1]);
      assertEquals(group.message.length > group.serder.raw.length, true);
      assertEquals(hby.db.getKever(group.hab.pre)?.sn, 0);
      assertEquals(hby.db.groups.has(group.hab.pre), true);

      const stored = hby.db.getHab(group.hab.pre);
      assertEquals(stored?.hid, group.hab.pre);
      assertEquals(stored?.mid, member1.pre);
      assertEquals(stored?.smids, [member1.pre, member2.pre]);
      assertEquals(stored?.rmids, [member1.pre, member2.pre]);
      assertEquals(
        hby.ks.getSmids(group.hab.pre).map(([, number]) => number.num),
        [
          0n,
          1n,
        ],
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("local group inception precedes witness receipts without exempting a remote validator", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const members = [source.makeHab("alice"), source.makeHab("bob")];
      const witness = Signer.random({ transferable: false });
      const group = source.makeGroupHab("team", members[0], members.map((hab) => hab.pre), undefined, undefined, {
        isith: "2",
        nsith: "2",
        wits: [witness.verfer.qb64],
        toad: 1,
      });
      assertExists(group.hab.kever, "a local group must accept before its receipt owner can publish the event");
      assertEquals(source.db.groups.has(group.hab.pre), true);
      assertEquals(source.db.wigs.get([group.hab.pre, group.serder.said!]), [], "acceptance is not full witnessing");
      const envelope = {
        serder: group.serder,
        sigers: group.sigers,
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      };
      const pending = remote.kevery.processEvent(envelope);
      assertEquals(pending.kind, "escrow");
      if (pending.kind === "escrow") assertEquals(pending.reason, "partialWigs");
      assertEquals(remote.db.getKever(group.hab.pre), null, "a disinterested validator still needs witness proof");
      const proof = witness.sign(group.serder.raw, { index: 0 });
      assertInstanceOf(proof, Siger);
      assertEquals(remote.kevery.processEvent({ ...envelope, wigers: [proof] }).kind, "accept");
      assertExists(remote.db.getKever(group.hab.pre));
    } finally {
      yield* source.close(true);
      yield* remote.close(true);
    }
  });
});

Deno.test("Habery rotateGroupHab preserves accepted member metadata while rotation is pending", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-group-pending-rot-${crypto.randomUUID()}`,
      temp: true,
    });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    const remoteHby = yield* createHabery({
      name: `habery-group-pending-rot-remote-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const member1 = hby.makeHab("member1", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const member2 = hby.makeHab("member2", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const remote = remoteHby.makeHab("remote", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      yield* settleRuntimeIngress(runtime, remoteHby.db.clonePreIter(remote.pre, 0));
      assertExists(hby.db.getKever(remote.pre));

      const group = hby.makeGroupHab(
        "team",
        member1,
        [member1.pre, member2.pre],
        [member1.pre, member2.pre],
        undefined,
        {
          isith: "2",
          nsith: "2",
          toad: 0,
        },
      );
      assertEquals(hby.db.getHab(group.hab.pre)?.smids, [member1.pre, member2.pre]);
      assertEquals(hby.db.getHab(group.hab.pre)?.rmids, [member1.pre, member2.pre]);

      hby.habs.delete(member2.pre);
      const rotation = hby.rotateGroupHab(
        "team",
        [member1.pre, member2.pre],
        [member1.pre, remote.pre],
        {
          isith: "2",
          nsith: "2",
          toad: 0,
        },
      );

      assertEquals(rotation.sigers.map((siger) => siger.index), [0]);
      assertEquals(
        rotation.serder.sn !== null ? hby.db.kels.getLast(group.hab.pre, rotation.serder.sn) : null,
        null,
      );
      const stored = hby.db.getHab(group.hab.pre);
      assertEquals(stored?.smids, [member1.pre, member2.pre]);
      assertEquals(stored?.rmids, [member1.pre, member2.pre]);
      assertEquals(hby.ks.getSmids(group.hab.pre).map((tuple) => tuple[0].qb64), [member1.pre, member2.pre]);
      assertEquals(hby.ks.getRmids(group.hab.pre).map((tuple) => tuple[0].qb64), [member1.pre, member2.pre]);
    } finally {
      yield* remoteHby.close(true);
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("eventReplayMessage includes stored witness indexed signatures", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `habery-replay-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `habery-replay-remote-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const witness = source.makeHab("wit", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("ctrl", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      if (!event?.pre || !event.said || event.sn === null) {
        throw new Error("Expected accepted witnessed controller event.");
      }

      const kvy = new Kevery(remote.db);
      kvy.processEvent({
        serder: event,
        sigers: controller.sign(event.raw, true) as Siger[],
        wigers: witness.sign(event.raw, true) as Siger[],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });

      assertEquals(remote.db.wigs.get(dgKey(event.pre, event.said)).length, 1);
      const replay = eventReplayMessage(remote, event);
      const replayAttachments = new TextDecoder().decode(
        replay.slice(event.size),
      );
      const witnessCounter = new TextDecoder().decode(
        new Counter({
          code: CtrDexV1.WitnessIdxSigs,
          count: 1,
          version: { major: 1, minor: 0 },
        }).qb64b,
      );
      assertStringIncludes(replayAttachments, witnessCounter);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("eventPayloadMessage can clone a pre-approval delegated event", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-delegated-payload-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const member1 = hby.makeHab("member1", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const member2 = hby.makeHab("member2", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const group = hby.makeGroupHab(
        "team",
        member1,
        [member1.pre, member2.pre],
        [member1.pre, member2.pre],
        undefined,
        {
          isith: "2",
          nsith: "2",
          toad: 0,
          delpre: delegator.pre,
        },
      );

      if (!group.serder.pre || !group.serder.said) {
        throw new Error("Expected delegated group event prefix and SAID.");
      }
      assertEquals(hby.db.getFelFn(group.serder.pre, group.serder.said), null);
      assertThrows(
        () => eventReplayMessage(hby, group.serder),
        Error,
        "Missing first-seen ordinal",
      );
      const payload = eventPayloadMessage(hby, group.serder);
      assertStringIncludes(
        new TextDecoder().decode(payload.slice(group.serder.size)),
        new TextDecoder().decode(
          new Counter({
            code: CtrDexV1.ControllerIdxSigs,
            count: 2,
            version: { major: 1, minor: 0 },
          }).qb64b,
        ),
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Habery skips pending delegated group records during reopen", async () => {
  const name = `habery-pending-group-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  let groupPre = "";

  await run(function*() {
    const hby = yield* createHabery({ name, headDirPath });
    try {
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const member1 = hby.makeHab("member1", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const member2 = hby.makeHab("member2", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const group = hby.makeGroupHab(
        "team",
        member1,
        [
          member1.pre,
          member2.pre,
        ],
        undefined,
        undefined,
        {
          isith: "2",
          nsith: "2",
          toad: 0,
          delpre: delegator.pre,
        },
      );
      groupPre = group.hab.pre;

      assertEquals(hby.db.getHab(groupPre)?.mid, member1.pre);
      assertEquals(hby.db.getKever(groupPre), null);
      assertEquals(hby.db.groups.has(groupPre), true, "local membership does not assert accepted key state");
      assertEquals(hby.db.prefixes.has(groupPre), false);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({ name, headDirPath });
    try {
      assertEquals(hby.db.getHab(groupPre)?.name, "team");
      assertEquals(hby.habs.has(groupPre), false);
      assertEquals(hby.db.getKever(groupPre), null);
      assertEquals(hby.db.groups.has(groupPre), true, "local membership does not assert accepted key state");
      assertEquals(hby.db.prefixes.has(groupPre), false);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Habery keeps a local kevery separate from runtime-owned kevery cues", async () => {
  const name = `habery-local-kevery-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipSignator: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);

      assertStrictEquals(hab.kevery, hby.kevery);
      assertStrictEquals(hby.kevery.local, true);
      assertStrictEquals(hby.kevery.lax, false);
      assertEquals(runtime.reactor.kvy === hby.kevery, false);
      assertEquals(runtime.reactor.kvy.cues === runtime.cues, false);
      assertEquals(runtime.cues === hby.kevery.cues, false);
      const localCues = hby.kevery.cues.toArray();
      const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const peer = remote.makeHab("peer");
        yield* settleRuntimeIngress(runtime, remote.db.clonePreIter(peer.pre));
        assertEquals(hby.db.getKever(peer.pre)?.said, peer.kever!.said);
        assertEquals(runtime.reactor.kvy.cues.empty, true);
        assertEquals(runtime.cues.toArray().map((cue) => cue.kin), ["receipt", "keyStateSaved"]);
        assertEquals(hby.kevery.cues.toArray(), localCues);
      } finally {
        yield* runtime.close();
        yield* remote.close(true);
      }
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery reconfigure preserves top-level OOBI preload queues", async () => {
  const name = `habery-config-oobi-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    cf.put({
      dt: "2026-04-06T12:00:00.000Z",
      iurls: ["http://127.0.0.1:7001/oobi/i"],
      durls: ["http://127.0.0.1:7001/oobi/d"],
      wurls: ["http://127.0.0.1:7001/.well-known/keri/oobi/w"],
    });

    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
    });
    try {
      assertEquals(hby.db.oobis.cnt(), 2);
      assertEquals(hby.db.woobi.cnt(), 1);
      assertEquals(
        hby.db.oobis.get("http://127.0.0.1:7001/oobi/i")?.state,
        "queued",
      );
      assertEquals(
        hby.db.oobis.get("http://127.0.0.1:7001/oobi/d")?.state,
        "queued",
      );
      assertEquals(
        hby.db.woobi.get("http://127.0.0.1:7001/.well-known/keri/oobi/w")
          ?.state,
        "queued",
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab reconfigure applies alias-scoped controller curls through reply acceptance", async () => {
  // Both cigar and establishment-group proofs must pass the normal reply verifier.
  for (const transferable of [true, false]) {
    const name = `habery-config-curls-${crypto.randomUUID()}`;
    const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
    const url = "http://127.0.0.1:7002/controller";

    await run(function*() {
      const cf = yield* createConfiger({
        name,
        headDirPath,
        temp: false,
      });
      cf.put({
        alice: {
          dt: "2026-04-06T12:30:00.000Z",
          curls: [url],
        },
      });

      const hby = yield* createHabery({
        name,
        headDirPath,
        cf,
      });
      try {
        const hab = hby.makeHab("alice", undefined, {
          transferable,
          icount: 1,
          isith: "1",
          ncount: transferable ? 1 : 0,
          nsith: transferable ? "1" : "0",
          toad: 0,
        });

        assertEquals(
          hby.db.ends.get([hab.pre, "controller", hab.pre])?.allowed,
          true,
        );
        assertEquals(hby.db.locs.get([hab.pre, "http"])?.url, url);
        assertEquals(hab.fetchUrls(hab.pre, "http").http, url);
        const accepted = hby.db.lans.get([hab.pre, "http"])!.qb64;
        const proof = hby.db.rpys.get([accepted])!;
        assertEquals(proof.verify(), true);
        if (transferable) {
          const [group] = fetchStoredTsgs(hby.db, accepted);
          assertEquals(group.diger.qb64, hab.kever!.lastEst.d);
          assertEquals(hab.kever!.verfers[0].verify(group.sigers[0].raw, proof.raw), true);
        } else {
          const [[verfer, cigar]] = hby.db.scgs.get([accepted]);
          assertEquals(verfer.verify(cigar.raw, proof.raw), true);
        }

        // An older timestamp with different content must not bypass BADA through local admission.
        const changedUrl = "http://127.0.0.1:7002/changed";
        cf.put({ alice: { dt: "2026-04-05T12:30:00.000Z", curls: [changedUrl] } });
        hab.reconfigure();
        assertEquals(hby.db.locs.get([hab.pre, "http"])?.url, url);
        assertEquals(hby.db.lans.get([hab.pre, "http"])?.qb64, accepted);
        if (transferable) {
          // A later establishment event outranks the old reply time and uses its accepted keys.
          hab.rotate();
          hab.reconfigure();
          assertEquals(hby.db.locs.get([hab.pre, "http"])?.url, changedUrl);
          const latest = hby.db.lans.get([hab.pre, "http"])!.qb64;
          assertEquals(fetchStoredTsgs(hby.db, latest)[0].diger.qb64, hab.kever!.lastEst.d);
        }
      } finally {
        yield* hby.close();
      }
    });
  }
});

Deno.test("Habery reconfigure reapplies alias-scoped controller curls idempotently on reopen", async () => {
  const name = `habery-config-reopen-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const url = "http://127.0.0.1:7003/controller";
  let pre = "";
  let endSaid = "";
  let locSaid = "";

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    cf.put({
      alice: {
        dt: "2026-04-06T13:00:00.000Z",
        curls: [url],
      },
    });

    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      endSaid = hby.db.eans.get([pre, "controller", pre])?.qb64 ?? "";
      locSaid = hby.db.lans.get([pre, "http"])?.qb64 ?? "";
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
    });
    try {
      assertEquals(hby.db.ends.get([pre, "controller", pre])?.allowed, true);
      assertEquals(hby.db.locs.get([pre, "http"])?.url, url);
      assertEquals(hby.db.eans.get([pre, "controller", pre])?.qb64, endSaid);
      assertEquals(hby.db.lans.get([pre, "http"])?.qb64, locSaid);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab receives KERIpy-style config and local routing seams from Habery", async () => {
  const name = `habery-injected-seams-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    cf.put({
      alice: {
        dt: "2026-04-06T13:30:00.000Z",
        curls: ["http://127.0.0.1:7004/controller"],
      },
    });

    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
      skipSignator: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      assertStrictEquals(hab.cf, cf);
      assertStrictEquals(hab.rtr, hby.rtr);
      assertStrictEquals(hab.rvy, hby.rvy);
      assertStrictEquals(hab.kvy, hby.kevery);
      assertEquals(hab.hasConfigSection(), true);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab endorse matches KERIpy EXN pipelining modes", async () => {
  const name = `habery-endorse-exn-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const serder = makeExchangeSerder(
        "/challenge/response",
        { i: hab.pre, words: ["able", "baker"] },
        { sender: hab.pre, recipient: hab.pre },
      );

      const pipelined = hab.endorse(serder);
      const unpipelined = hab.endorse(serder, { pipelined: false });
      const pipelinedCtr = new Counter({ qb64b: pipelined.slice(serder.size) });
      const unpipelinedCtr = new Counter({
        qb64b: unpipelined.slice(serder.size),
      });

      assertEquals(pipelinedCtr.code, CtrDexV1.AttachmentGroup);
      assertEquals(unpipelinedCtr.code, CtrDexV1.TransIdxSigGroups);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab endorse emits v2 live counters when gvrsn is requested", async () => {
  const name = `habery-endorse-gvrsn-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const serder = makeExchangeSerder(
        "/challenge/response",
        { i: hab.pre, words: ["able", "baker"] },
        { sender: hab.pre, recipient: hab.pre },
      );

      const message = hab.endorse(serder, { gvrsn: Vrsn_2_0 });
      const counter = parseCounterFromText(message.slice(serder.size), Vrsn_2_0);

      assertEquals(counter.code, CtrDexV2.AttachmentGroup);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery inception reuses one Habery across prefix and threshold variants", async () => {
  const name = `habery-inception-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const nested = [{ "1": ["1/2", "1/2"] }];

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const nonTransferableHab = hby.makeHab("bob", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const nonTransferableState = hby.db.getState(nonTransferableHab.pre);
      assertEquals(nonTransferableHab.pre, nonTransferableState?.k?.[0]);
      assertEquals(nonTransferableHab.pre.startsWith("B"), true);
      assertEquals(nonTransferableState?.n ?? [], []);
      assertEquals(nonTransferableState?.b ?? [], []);

      const ecdsaHab = hby.makeHab("bob-r1", undefined, {
        transferable: false,
        icode: "Q",
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const ecdsaState = hby.db.getState(ecdsaHab.pre);
      assertEquals(ecdsaHab.pre, ecdsaState?.k?.[0]);
      assertEquals(ecdsaHab.pre.startsWith("1AAI"), true);
      assertEquals(ecdsaState?.n ?? [], []);
      assertEquals(ecdsaState?.b ?? [], []);

      const digestiveHab = hby.makeHab("carol", undefined, {
        code: "I",
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const digestiveState = hby.db.getState(digestiveHab.pre);
      assertEquals(digestiveHab.pre.startsWith("I"), true);
      assertEquals(digestiveState?.d?.startsWith("E"), true);
      assertEquals(digestiveHab.pre === digestiveState?.k?.[0], false);

      const hab = hby.makeHab("weighted", undefined, {
        transferable: true,
        icount: 2,
        isith: ["1/2", "1/2"],
        ncount: 2,
        nsith: nested,
        toad: 0,
      });
      const state = hby.db.getState(hab.pre);

      assertEquals(state?.kt, ["1/2", "1/2"]);
      assertEquals(state?.nt, nested);
      assertEquals(hab.kever?.tholder?.sith, ["1/2", "1/2"]);
      assertEquals(hab.kever?.tholder?.weighted, true);
      assertEquals(hab.kever?.ntholder?.sith, nested);
      assertEquals(hab.kever?.ntholder?.weighted, true);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab and Signator signing keep indexed and unindexed overload behavior intact", async () => {
  const name = `habery-sign-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab("dave", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const ser = new TextEncoder().encode("hab-signatures");

      const indexed = hab.sign(ser, true);
      const unindexed = hab.sign(ser, false);
      const signatorSig = hby.signator?.sign(ser);

      assertEquals(indexed.length, 1);
      assertEquals(unindexed.length, 1);
      assertInstanceOf(indexed[0], Siger);
      assertInstanceOf(unindexed[0], Cigar);
      assertEquals(indexed[0]?.index, 0);
      assertInstanceOf(signatorSig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, hby.signator?.pre);
      assertEquals(
        hby.signator?.verfer.qb64,
        hby.signator?.hab.kever?.verfers[0]?.qb64,
      );
      assertEquals(
        signatorSig ? hby.signator?.verify(ser, signatorSig) : false,
        true,
      );
      assertEquals(
        signatorSig
          ? hby.signator?.verify(
            new TextEncoder().encode("wrong-message"),
            signatorSig,
          )
          : true,
        false,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab receipt helpers reuse one Habery across witness and receipt variants", async () => {
  const name = `habery-receipts-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const witness = hby.makeHab("wit", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const witnessController = hby.makeHab("ctrl-wit", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const witnessEvent = hby.db.getEvtSerder(
        witnessController.pre,
        witnessController.kever?.said ?? "",
      );
      if (!witnessEvent?.said) {
        throw new Error(
          "Expected accepted witness controller inception event.",
        );
      }
      const witnessMsg = witness.witness(witnessEvent);
      assertEquals(witnessMsg.length > 0, true);
      assertEquals(
        hby.db.wigs.get([witnessController.pre, witnessEvent.said]).length,
        0,
      );

      const receiptor = hby.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const receiptController = hby.makeHab("ctrl-rct", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const receiptEvent = hby.db.getEvtSerder(
        receiptController.pre,
        receiptController.kever?.said ?? "",
      );
      if (!receiptEvent?.said) {
        throw new Error("Expected accepted non-transferable receipt event.");
      }
      const nonTransferableReceiptMsg = receiptor.receipt(receiptEvent);
      assertEquals(nonTransferableReceiptMsg.length > 0, true);
      assertEquals(
        hby.db.rcts.get([receiptController.pre, receiptEvent.said]).length,
        0,
      );

      const validator = hby.makeHab("val", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const controller = hby.makeHab("ctrl", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = hby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      if (!event?.said) {
        throw new Error("Expected accepted controller inception event.");
      }

      const transferableReceiptMsg = validator.receipt(event);

      assertEquals(transferableReceiptMsg.length > 0, true);
      assertEquals(hby.db.vrcs.get([controller.pre, event.said]).length, 0);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("encrypted Habery reopens its signator and signs with the same passcode", async () => {
  const name = `habery-enc-signator-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const bran = "MyPasscodeARealSecret";
  let signatoryPre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      bran,
    });
    try {
      hby.makeHab("erin", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const ser = new TextEncoder().encode("encrypted-signator");
      const sig = hby.signator?.sign(ser);

      signatoryPre = hby.db.getHby(SIGNER) ?? "";
      assertInstanceOf(sig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, signatoryPre);
      assertEquals(
        sig ? hby.signator?.verify(ser, sig) : false,
        true,
      );
      assertEquals(signatoryPre.length > 0, true);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      bran,
    });
    try {
      const ser = new TextEncoder().encode("encrypted-signator-reopen");
      const sig = hby.signator?.sign(ser);

      assertEquals(hby.signator?.pre, signatoryPre);
      assertEquals(hby.db.getHby(SIGNER), signatoryPre);
      assertInstanceOf(sig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, signatoryPre);
      assertEquals(
        hby.signator?.verfer.qb64,
        hby.signator?.hab.kever?.verfers[0]?.qb64,
      );
      assertEquals(
        sig ? hby.signator?.verify(ser, sig) : false,
        true,
      );
    } finally {
      yield* hby.close();
    }
  });

  await assertRejects(
    () =>
      run(function*() {
        const hby = yield* createHabery({
          name,
          headDirPath,
          bran: "WrongPasscodeSecretAB",
        });
        try {
          hby.signator?.sign(new TextEncoder().encode("wrong-passcode"));
        } finally {
          yield* hby.close();
        }
      }),
    Error,
    "Last seed missing or provided last seed not associated",
  );
});

Deno.test("Signator reuses the Habery narrow dependency seam across reopen", async () => {
  const name = `habery-signator-seams-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  let signatoryPre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const signator = hby.signator;
      if (!signator) {
        throw new Error("Expected signator.");
      }

      signatoryPre = signator.pre;
      assertStrictEquals(signator.hab.cf, hby.cf);
      assertStrictEquals(signator.hab.rtr, hby.rtr);
      assertStrictEquals(signator.hab.rvy, hby.rvy);
      assertStrictEquals(signator.hab.kvy, hby.kevery);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const signator = hby.signator;
      if (!signator) {
        throw new Error("Expected signator.");
      }

      assertEquals(signator.pre, signatoryPre);
      assertStrictEquals(signator.hab.rtr, hby.rtr);
      assertStrictEquals(signator.hab.rvy, hby.rvy);
      assertStrictEquals(signator.hab.kvy, hby.kevery);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery rotateGroupHab maps prior commitments independently of signing members", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `group-dual-index-${crypto.randomUUID()}`, temp: true });
    try {
      const alice = hby.makeHab("alice");
      const bob = hby.makeHab("bob");
      const fresh = hby.makeHab("fresh");
      const group = hby.makeGroupHab("team", alice, [alice.pre, bob.pre], [bob.pre, alice.pre], undefined, {
        isith: "2",
        nsith: "2",
        toad: 0,
      });
      assertEquals(group.sigers.map((siger) => siger.ondex ?? null), [null, null]);
      alice.rotate();
      bob.rotate();
      const added = hby.rotateGroupHab("team", [alice.pre, bob.pre, fresh.pre], undefined, {
        isith: ["0", "0", "1"],
        nsith: "2",
        toad: 0,
      });
      assertEquals(added.sigers.map((siger) => [siger.index, siger.ondex ?? null]), [[0, 1], [1, 0], [2, null]]);
      assertEquals(group.hab.kever?.sn, 1);
      assertEquals(hby.db.kels.getLast(group.hab.pre, 1), added.serder.said);
      assertEquals(hby.db.getHab(group.hab.pre)?.smids, [alice.pre, bob.pre, fresh.pre]);
      const signed = hby.interactGroupHab("team");
      assertEquals(signed.sigers.map((siger) => siger.ondex ?? null), [null, null, null]);
      assertEquals(group.hab.kever?.sn, 2);
      alice.rotate();
      bob.rotate();
      const removed = hby.rotateGroupHab("team", [bob.pre, alice.pre], [alice.pre, bob.pre], {
        isith: "2",
        nsith: "2",
        toad: 0,
      });
      assertEquals(removed.sigers.map((siger) => [siger.index, siger.ondex ?? null]), [[0, 0], [1, 1]]);
      assertEquals(group.hab.kever?.sn, 3);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Habery rotateGroupHab repeatedly replaces an inaccessible user with two service members", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `group-recovery-${crypto.randomUUID()}`, temp: true });
    const observer = yield* createHabery({ name: `group-recovery-observer-${crypto.randomUUID()}`, temp: true });
    const runtime = yield* createAgentRuntime(observer, new FetchHttpClient(), systemClock);
    try {
      const services = [hby.makeHab("service1"), hby.makeHab("service2"), hby.makeHab("service3")];
      const mids = services.map((member) => member.pre);
      const group = hby.makeGroupHab("account", services[0], mids, mids, undefined, {
        isith: ["1/2", "1/2", "1/2"],
        nsith: ["1/2", "1/2", "1/2"],
        toad: 0,
      });
      const root = group.hab.pre;
      // The unavailable custodian contributes neither a signature nor an exposed key.
      hby.habs.delete(services[2].pre);
      let oldUser: string | undefined;
      for (let generation = 0; generation < 3; generation++) {
        if (oldUser) hby.habs.delete(oldUser);
        services[0].rotate();
        services[1].rotate();
        const user = hby.makeHab(`user-${generation}`);
        const rotation = hby.rotateGroupHab("account", [...mids, user.pre], [...mids, user.pre], {
          isith: ["0", "0", "0", "1"],
          nsith: [{ "1": ["1/2", "1/2", "1/2"] }, "1"],
          toad: 0,
        });
        assertEquals(rotation.sigers.map((siger) => [siger.index, siger.ondex ?? null]), [[0, 0], [1, 1], [3, null]]);
        assertEquals(group.hab.pre, root);
        assertEquals(group.hab.kever?.sn, generation * 2 + 1);
        assertEquals(hby.db.kels.getLast(root, generation * 2 + 1), rotation.serder.said);
        hby.interactGroupHab("account", [...mids, user.pre], { data: [{ generation }] });
        assertEquals(group.hab.kever?.sn, generation * 2 + 2);
        oldUser = user.pre;
      }
      yield* settleRuntimeIngress(runtime, hby.db.clonePreIter(root, 0));
      assertEquals(observer.db.getKever(root)?.sn, 6);
      assertEquals(observer.db.getKever(root)?.said, group.hab.kever?.said);
    } finally {
      yield* runtime.close();
      yield* observer.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Habery rotateGroupHab requires both prior recovery quorum and replacement consent", async () => {
  for (const retained of [[3], [0, 3], [0, 1]]) {
    await run(function*() {
      const hby = yield* createHabery({ name: `group-recovery-insufficient-${crypto.randomUUID()}`, temp: true });
      try {
        const services = [hby.makeHab("service1"), hby.makeHab("service2"), hby.makeHab("service3")];
        const mids = services.map((member) => member.pre);
        const group = hby.makeGroupHab("account", services[0], mids, mids, undefined, {
          isith: ["1/2", "1/2", "1/2"],
          nsith: ["1/2", "1/2", "1/2"],
          toad: 0,
        });
        services[0].rotate();
        services[1].rotate();
        const user = hby.makeHab("replacement");
        const members = [...services, user];
        for (let index = 0; index < members.length; index++) {
          if (!retained.includes(index)) hby.habs.delete(members[index].pre);
        }
        const rotation = hby.rotateGroupHab("account", [...mids, user.pre], [...mids, user.pre], {
          isith: ["0", "0", "0", "1"],
          nsith: [{ "1": ["1/2", "1/2", "1/2"] }, "1"],
          toad: 0,
        });
        assertEquals(rotation.sigers.map((siger) => siger.index), retained);
        assertEquals(group.hab.kever?.sn, 0);
        assertEquals(hby.db.kels.getLast(group.hab.pre, 1), null);
        assertEquals(hby.db.getHab(group.hab.pre)?.smids, mids);
        assertEquals(hby.db.getHab(group.hab.pre)?.rmids, mids);
      } finally {
        yield* hby.close(true);
      }
    });
  }
});
