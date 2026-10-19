import { action, call, type Operation, race, run, spawn, type Task } from "effection";
import { assert, assertEquals, assertExists, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { once } from "node:events";
import { createConnection, type Socket } from "node:net";
import { b, parseBytes, ParserError, WireParseError } from "../../../../cesr/mod.ts";
import { startServer } from "../../../../tufa/src/host/http-server.ts";
import { startWitnessTcpServer } from "../../../../tufa/src/host/witness-tcp.ts";
import {
  createAgentRuntime,
  runAgentRuntime,
  settleRuntimeIngress,
} from "../../../src/app/agent-runtime.ts";
import { buildCesrRequest } from "../../../src/app/cesr-http.ts";
import { httpMailboxPollTransport } from "../../../src/app/forwarding.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { envelopesFromFrames } from "../../../src/app/parsering.ts";
import { createProtocolProcessor } from "../../../src/app/protocol-processing.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";

import { socketBytes } from "../../../src/app/socket-source.ts";
import { Receiptor } from "../../../src/app/witnessing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { Schemes } from "../../../src/core/schemes.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { fetchOp, sleepOp, textOp, waitForServer, waitForTaskHalt } from "../../effection-http.ts";

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

/** Inspect a finite witness proof through the progressive parser and KERI projection. */
function* firstEnvelope(bytes: Uint8Array): Operation<ReturnType<typeof envelopesFromFrames>[number]> {
  const frames = yield* call(() => parseBytes(bytes));
  const envelopes = envelopesFromFrames(frames, false);
  const envelope = envelopes[0];
  if (!envelope) {
    throw new Error("Expected one parsed CESR envelope.");
  }
  return envelope;
}

function* bytesOp(response: Response): Operation<Uint8Array> {
  const buffer = yield* action<ArrayBuffer>((resolve, reject) => {
    response.arrayBuffer().then(resolve).catch(reject);
    return () => {};
  });
  return new Uint8Array(buffer);
}

function* seedWitnessHostState(
  hby: Habery,
  witness: Hab,
  hostUrl: string,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, httpMailboxPollTransport, {
    enableMailboxStore: true,
  });
  try {
    yield* settleRuntimeIngress(runtime, [
      witness.makeLocScheme(hostUrl, witness.pre, Schemes.http),
      witness.makeEndRole(witness.pre, EndpointRoles.controller, true),
      witness.makeEndRole(witness.pre, EndpointRoles.witness, true),
      witness.makeEndRole(witness.pre, EndpointRoles.mailbox, true),
    ]);
  } finally {
    yield* runtime.close();
  }
}

function* seedRemoteWitnessLocation(
  hby: Habery,
  witness: Hab,
  url: string,
  scheme: string,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, httpMailboxPollTransport, {
    enableMailboxStore: true,
  });
  try {
    for (const message of witness.db.clonePreIter(witness.pre, 0)) {
      yield* settleRuntimeIngress(runtime, [message]);
    }
    yield* settleRuntimeIngress(runtime, [witness.makeLocScheme(url, witness.pre, scheme)]);
  } finally {
    yield* runtime.close();
  }
}

Deno.test("Witness runtime serves KERIpy-style receipts, KEL query replay, and combined mailbox OOBIs", async () => {
  const sourceName = `witness-runtime-source-${crypto.randomUUID()}`;
  const providerName = `witness-runtime-provider-${crypto.randomUUID()}`;
  const port = randomPort();
  const hostUrl = `http://127.0.0.1:${port}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const witness = providerHby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = sourceHby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = sourceHby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event?.said);
      const message = [...sourceHby.db.clonePreIter(controller.pre, 0)][0];
      assertExists(message);

      yield* seedWitnessHostState(providerHby, witness, hostUrl);
      const runtime = yield* createAgentRuntime(
        providerHby,
        new FetchHttpClient(),
        systemClock,
        httpMailboxPollTransport,
        { enableMailboxStore: true },
      );
      const serverTask = yield* spawn(function*() {
        yield* startServer(port, undefined, runtime, {
          hostname: "127.0.0.1",
          hostedPrefixes: [witness.pre],
          serviceHab: witness,
          witnessHab: witness,
        });
      });

      try {
        yield* waitForServer(port);

        const request = buildCesrRequest(message, {
          destination: witness.pre,
        });
        const receiptResponse = yield* fetchOp(`${hostUrl}/receipts`, {
          method: "POST",
          headers: request.headers,
          body: request.body,
        });
        assertEquals(receiptResponse.status, 200);
        const receiptBytes = yield* bytesOp(receiptResponse);
        const receiptEnvelope = yield* firstEnvelope(receiptBytes);
        assertEquals(receiptEnvelope.cigars.length, 1);
        assertEquals(receiptEnvelope.wigers.length, 0);
        assertEquals(
          providerHby.db.wigs.get(dgKey(controller.pre, event.said)).length,
          1,
        );

        const makeLoc = witness.makeLocScheme;
        let freshCalls = 0;
        witness.makeLocScheme = function(...args) {
          freshCalls++;
          return makeLoc.apply(this, args);
        };
        try {
          assertEquals([...witness.replyToOobiMessages(controller.pre, EndpointRoles.witness)].length > 0, true);
          assertEquals(freshCalls, 1);
        } finally {
          witness.makeLocScheme = makeLoc;
        }

        const storedResponse = yield* fetchOp(
          `${hostUrl}/receipts?pre=${controller.pre}&sn=0`,
        );
        assertEquals(storedResponse.status, 200);
        const storedBytes = yield* bytesOp(storedResponse);
        const storedEnvelope = yield* firstEnvelope(storedBytes);
        assertEquals(storedEnvelope.cigars.length, 0);
        assertEquals(storedEnvelope.wigers.length, 1);

        const queryResponse = yield* fetchOp(
          `${hostUrl}/query?typ=kel&pre=${controller.pre}`,
        );
        assertEquals(queryResponse.status, 200);
        const queryBytes = yield* bytesOp(queryResponse);
        assertEquals((yield* call(() => parseBytes(queryBytes))).length, 1);
        assertEquals((yield* firstEnvelope(queryBytes)).serder.pre, controller.pre);

        const mailboxOobi = yield* fetchOp(
          `${hostUrl}/oobi/${witness.pre}/mailbox/${witness.pre}`,
        );
        assertEquals(mailboxOobi.status, 200);
        const mailboxBytes = yield* bytesOp(mailboxOobi);
        assertEquals(mailboxBytes.length > 0, true);

        const mailboxAdmin = yield* fetchOp(`${hostUrl}/mailboxes`, {
          method: "POST",
        });
        assertEquals(
          mailboxAdmin.status === 406 || mailboxAdmin.status === 400,
          true,
        );
        yield* textOp(mailboxAdmin);
      } finally {
        yield* waitForTaskHalt(serverTask);
        yield* runtime.close();
      }
    } finally {
      yield* providerHby.close();
      yield* sourceHby.close();
    }
  });
});

Deno.test("Witness runtime returns 202 for receipting before the prior KEL state arrives", async () => {
  const sourceName = `witness-escrow-source-${crypto.randomUUID()}`;
  const providerName = `witness-escrow-provider-${crypto.randomUUID()}`;
  const port = randomPort();
  const hostUrl = `http://127.0.0.1:${port}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const witness = providerHby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = sourceHby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      controller.rotate({
        ncount: 1,
        nsith: "1",
      });
      const rotation = [...sourceHby.db.clonePreIter(controller.pre, 1)][0];
      assertExists(rotation);

      yield* seedWitnessHostState(providerHby, witness, hostUrl);
      const runtime = yield* createAgentRuntime(
        providerHby,
        new FetchHttpClient(),
        systemClock,
        httpMailboxPollTransport,
        { enableMailboxStore: true },
      );
      const serverTask = yield* spawn(function*() {
        yield* startServer(port, undefined, runtime, {
          hostname: "127.0.0.1",
          hostedPrefixes: [witness.pre],
          serviceHab: witness,
          witnessHab: witness,
        });
      });

      try {
        yield* waitForServer(port);
        const request = buildCesrRequest(rotation, {
          destination: witness.pre,
        });
        const response = yield* fetchOp(`${hostUrl}/receipts`, {
          method: "POST",
          headers: request.headers,
          body: request.body,
        });
        assertEquals(response.status, 202);
        yield* textOp(response);
      } finally {
        yield* waitForTaskHalt(serverTask);
        yield* runtime.close();
      }
    } finally {
      yield* providerHby.close();
      yield* sourceHby.close();
    }
  });
});

Deno.test("Witness runtime rejects receipting when the hosted witness is not authorized for the event", async () => {
  const sourceName = `witness-reject-source-${crypto.randomUUID()}`;
  const providerName = `witness-reject-provider-${crypto.randomUUID()}`;
  const port = randomPort();
  const hostUrl = `http://127.0.0.1:${port}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const witness = providerHby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = sourceHby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const message = [...sourceHby.db.clonePreIter(controller.pre, 0)][0];
      assertExists(message);

      yield* seedWitnessHostState(providerHby, witness, hostUrl);
      const runtime = yield* createAgentRuntime(
        providerHby,
        new FetchHttpClient(),
        systemClock,
        httpMailboxPollTransport,
        { enableMailboxStore: true },
      );
      const serverTask = yield* spawn(function*() {
        yield* startServer(port, undefined, runtime, {
          hostname: "127.0.0.1",
          hostedPrefixes: [witness.pre],
          serviceHab: witness,
          witnessHab: witness,
        });
      });

      try {
        yield* waitForServer(port);
        const request = buildCesrRequest(message, {
          destination: witness.pre,
        });
        const response = yield* fetchOp(`${hostUrl}/receipts`, {
          method: "POST",
          headers: request.headers,
          body: request.body,
        });
        assertEquals(response.status, 400);
        const body = yield* textOp(response);
        assertStringIncludes(body, "is not an authorized witness");
      } finally {
        yield* waitForTaskHalt(serverTask);
        yield* runtime.close();
      }
    } finally {
      yield* providerHby.close();
      yield* sourceHby.close();
    }
  });
});

Deno.test("Witness runtime accepts root-path catchup before synchronous receipting", async () => {
  const sourceName = `witness-root-catchup-source-${crypto.randomUUID()}`;
  const providerName = `witness-root-catchup-provider-${crypto.randomUUID()}`;
  const port = randomPort();
  const hostUrl = `http://127.0.0.1:${port}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const witness = providerHby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = sourceHby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const inception = [...sourceHby.db.clonePreIter(controller.pre, 0)][0];
      assertExists(inception);
      controller.rotate({
        ncount: 1,
        nsith: "1",
      });
      const rotation = [...sourceHby.db.clonePreIter(controller.pre, 1)][0];
      const latest = sourceHby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(rotation);
      assertExists(latest?.said);

      yield* seedWitnessHostState(providerHby, witness, hostUrl);
      const runtime = yield* createAgentRuntime(
        providerHby,
        new FetchHttpClient(),
        systemClock,
        httpMailboxPollTransport,
        { enableMailboxStore: true },
      );
      const serverTask = yield* spawn(function*() {
        yield* startServer(port, undefined, runtime, {
          hostname: "127.0.0.1",
          hostedPrefixes: [witness.pre],
          serviceHab: witness,
          witnessHab: witness,
        });
      });

      try {
        yield* waitForServer(port);

        const catchupRequest = buildCesrRequest(inception, {
          destination: witness.pre,
        });
        const catchupResponse = yield* fetchOp(hostUrl, {
          method: "POST",
          headers: catchupRequest.headers,
          body: catchupRequest.body,
        });
        assertEquals(catchupResponse.status, 204);
        yield* textOp(catchupResponse);
        assertEquals(providerHby.db.getKever(controller.pre)?.sn, 0);

        const receiptRequest = buildCesrRequest(rotation, {
          destination: witness.pre,
        });
        const receiptResponse = yield* fetchOp(`${hostUrl}/receipts`, {
          method: "POST",
          headers: receiptRequest.headers,
          body: receiptRequest.body,
        });
        assertEquals(receiptResponse.status, 200);
        const receiptBytes = yield* bytesOp(receiptResponse);
        assertEquals(receiptBytes.length > 0, true);
        assertEquals(providerHby.db.getKever(controller.pre)?.sn, 1);
        assertEquals(
          providerHby.db.wigs.get(dgKey(controller.pre, latest.said)).length,
          1,
        );
      } finally {
        yield* waitForTaskHalt(serverTask);
        yield* runtime.close();
      }
    } finally {
      yield* providerHby.close();
      yield* sourceHby.close();
    }
  });
});

Deno.test("Receiptor catchup falls back to TCP witness transport when only tcp is advertised", async () => {
  const sourceName = `witness-tcp-source-${crypto.randomUUID()}`;
  const providerName = `witness-tcp-provider-${crypto.randomUUID()}`;
  const tcpPort = randomPort();
  const tcpUrl = `tcp://127.0.0.1:${tcpPort}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const witness = providerHby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = sourceHby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 1,
        wits: [witness.pre],
      });
      yield* seedRemoteWitnessLocation(sourceHby, witness, tcpUrl, Schemes.tcp);

      const drains: number[] = [];
      const runtime = yield* createAgentRuntime(providerHby, new FetchHttpClient(), {
        ...systemClock,
        setTimeout(callback, ms) {
          if (ms === 200) drains.push(ms);
          return setTimeout(callback, ms);
        },
      }, httpMailboxPollTransport);
      const refusals: string[] = [];
      const sockets: Socket[] = [];
      const failed = Promise.withResolvers<unknown>();
      const serve = function*(): Operation<void> {
        try {
          yield* startWitnessTcpServer(
            tcpPort,
            "127.0.0.1",
            runtime,
            witness,
            { drainTimeoutMs: 200, onRefusal: (reason) => refusals.push(reason) },
          );
        } catch (error) {
          failed.resolve(error);
        }
      };
      let tcpTask = yield* spawn(serve);
      const receiver = yield* createAgentRuntime(
        sourceHby,
        new FetchHttpClient(),
        systemClock,
        httpMailboxPollTransport,
        { enableMailboxStore: true },
      );
      let replayed = 0, foreignReplay = false;
      let driver: Task<void> | undefined;
      let stoppingReceiver = false, receiveTask: Task<void> | undefined;

      try {
        yield* sleepOp(50);
        const receiptor = new Receiptor(
          sourceHby,
          createProtocolProcessor(sourceHby),
          new FetchHttpClient(),
          systemClock,
        );
        yield* receiptor.catchup(controller.pre, witness.pre);
        yield* sleepOp(50);
        assertEquals(providerHby.db.getKever(controller.pre)?.sn, 0);

        controller.interact();
        const message = acceptedEventReplayMessage(sourceHby, controller.pre, 1).message;
        for (const reset of [false, true]) {
          const rejected = createConnection({ port: tcpPort, host: "127.0.0.1" });
          sockets.push(rejected);
          rejected.on("error", () => {});
          rejected.resume();
          const closed = new Promise<void>((resolve) => rejected.once("close", resolve));
          yield* call(() => once(rejected, "connect"));
          if (reset) {
            rejected.write(message.slice(0, 20));
            yield* sleepOp(10);
            rejected.resetAndDestroy();
          } else rejected.end(b("-ZZZ"));
          yield* race([
            call(() => closed),
            (function*() {
              yield* sleepOp(2000);
              throw new Error("Rejected input did not close");
            })(),
          ]);
          yield* sleepOp(10);
          assertEquals(providerHby.db.getKever(controller.pre)?.sn, 0);
        }
        assertEquals(refusals, ["wire", "peer"]);
        // Actual signed replay is accepted while the producer deliberately leaves the connection open.
        const active = createConnection({ port: tcpPort, host: "127.0.0.1" });
        sockets.push(active);
        active.on("error", () => {});
        const processEvent = receiver.reactor.kvy.processEvent.bind(receiver.reactor.kvy);
        receiver.reactor.kvy.processEvent = (envelope) => {
          if (envelope.serder.pre === controller.pre) replayed++;
          else foreignReplay = true;
          return processEvent(envelope);
        };
        receiveTask = yield* spawn(function*() {
          try {
            yield* receiver.reactor.process((signal) => socketBytes(active, { signal }), { local: true });
          } catch (error) {
            if (!stoppingReceiver) throw error;
          }
        });
        yield* call(() => once(active, "connect"));
        const latest = controller.kever!.serder;
        runtime.cues.push({ kin: "receipt", serder: latest });
        active.write(witness.endorse(latest)); // Correct body/SAID, but no controller authorization.
        for (let attempt = 0; attempt < 200 && runtime.cues.length; attempt++) yield* sleepOp(10);
        assertEquals(providerHby.db.getKever(controller.pre)?.sn, 0);
        assertEquals(
          sourceHby.db.wigs.get(dgKey(controller.pre, latest.said!)).length,
          0,
          "a stale matching receipt cannot override the current escrow/reject decision",
        );
        runtime.cues.push({
          kin: "replay",
          querySaid: "another-query",
          msgs: [acceptedEventReplayMessage(providerHby, witness.pre, 0).message],
        });
        active.write(message);
        for (let attempt = 0; attempt < 200 && providerHby.db.getKever(controller.pre)?.sn !== 1; attempt++) {
          yield* sleepOp(10);
        }
        assertEquals(providerHby.db.getKever(controller.pre)?.sn, 1);
        for (
          let attempt = 0;
          attempt < 200 && !sourceHby.db.wigs.get(dgKey(controller.pre, latest.said!)).length;
          attempt++
        ) {
          yield* sleepOp(10);
        }
        assertEquals(
          sourceHby.db.wigs.get(dgKey(controller.pre, latest.said!)).length,
          1,
          "same-socket receipt is verified and persisted before client EOF",
        );
        assertEquals(active.writableEnded, false);
        const idle = createConnection({ port: tcpPort, host: "127.0.0.1" });
        sockets.push(idle);
        idle.on("error", () => {});
        idle.resume();
        yield* call(() => once(idle, "connect"));
        controller.interact();
        const next = controller.kever!.serder;
        active.write(acceptedEventReplayMessage(sourceHby, controller.pre, 2).message);
        for (
          let attempt = 0;
          attempt < 200 && !sourceHby.db.wigs.get(dgKey(controller.pre, next.said!)).length;
          attempt++
        ) yield* sleepOp(10);
        assertEquals(
          sourceHby.db.wigs.get(dgKey(controller.pre, next.said!)).length,
          1,
          "same-socket receipts progress while the second connection remains idle",
        );
        active.write(controller.query(controller.pre, witness.pre, { route: "logs", q: { s: "0" } }));
        for (let attempt = 0; attempt < 200 && replayed !== 3; attempt++) yield* sleepOp(10);
        assertEquals(replayed, 3, "correlated query replay drains on its existing socket before EOF");
        assertEquals(foreignReplay, false, "shared cues from another request cannot leak to this socket");
        const extra = createConnection({ port: tcpPort, host: "127.0.0.1" });
        sockets.push(extra);
        extra.on("error", () => {});
        extra.resume();
        yield* call(() => once(extra, "connect"));
        const another = sourceHby.makeHab("third-controller", undefined, { wits: [witness.pre], toad: 1 });
        extra.write(acceptedEventReplayMessage(sourceHby, another.pre, 0).message);
        for (let attempt = 0; attempt < 200 && !providerHby.db.getKever(another.pre); attempt++) yield* sleepOp(10);
        assertEquals(
          providerHby.db.getKever(another.pre)?.sn,
          0,
          "a third connection progresses alongside active and idle peers",
        );
        assertEquals(refusals, ["wire", "peer"]);
        const priorDrains = drains.length;
        driver = yield* spawn(() => runAgentRuntime(runtime, { hab: witness }));
        active.write(controller.query(controller.pre, witness.pre, { route: "logs", q: { s: "3" } }));
        for (let attempt = 0; attempt < 200 && providerHby.db.qnfs.cnt() !== 1; attempt++) yield* sleepOp(10);
        assertEquals(providerHby.db.qnfs.cnt(), 1, "missing sequence is the actual KERIpy query-not-found escrow");
        controller.interact();
        idle.write(acceptedEventReplayMessage(sourceHby, controller.pre, 3).message);
        for (let attempt = 0; attempt < 200 && replayed !== 7; attempt++) yield* sleepOp(10);
        assertEquals(
          replayed,
          7,
          "the default runtime escrow driver wakes deferred replay while this socket RX is idle",
        );
        assertEquals(providerHby.db.qnfs.cnt(), 0);
        assertEquals(drains.length, priorDrains, "activity cannot start or refresh the receive-EOF deadline");
        yield* driver.halt();
        driver = undefined;
        active.end();
        yield* receiveTask;

        if (!active.destroyed) {
          yield* race([
            call(() => once(active, "close")),
            (function*() {
              yield* sleepOp(2000);
              throw new Error("Receive EOF did not close the drained socket");
            })(),
          ]);
        }
        assertEquals(drains.length, priorDrains + 1, "one absolute deadline starts at genuine receive EOF");
        // A missing query keeps TX available after RX EOF; a native reset stays connection-local.
        const reset = createConnection({ port: tcpPort, host: "127.0.0.1" });
        sockets.push(reset);
        reset.on("error", () => {});
        reset.resume();
        yield* call(() => once(reset, "connect"));
        reset.end(controller.query(controller.pre, witness.pre, { route: "logs", q: { s: "99" } }));
        for (let attempt = 0; attempt < 200 && drains.length !== priorDrains + 2; attempt++) yield* sleepOp(10);
        assertEquals(drains.length, priorDrains + 2, "the pending reply outlives real receive EOF");
        reset.resetAndDestroy();
        for (let attempt = 0; attempt < 200 && refusals.length !== 3; attempt++) yield* sleepOp(10);
        assertEquals(refusals.at(-1), "peer", "native reset after RX EOF cannot fail the listener");
        const expires = createConnection({ port: tcpPort, host: "127.0.0.1" });
        sockets.push(expires);
        expires.on("error", () => {});
        expires.resume();
        yield* call(() => once(expires, "connect"));
        const expired = new Promise<void>((resolve) => expires.once("close", resolve));
        expires.end(controller.query(controller.pre, witness.pre, { route: "logs", q: { s: "100" } }));
        yield* race([
          call(() => expired),
          (function*() {
            yield* sleepOp(2000);
            throw new Error("Pending query drain deadline stalled");
          })(),
        ]);
        assertEquals(refusals.at(-1), "peer");
        assertEquals(drains.length, priorDrains + 3, "the deadline is not refreshed while a query stays unresolved");
        const busy = createConnection({ port: tcpPort, host: "127.0.0.1" });
        sockets.push(busy);
        busy.on("error", () => {});
        busy.resume();
        yield* call(() => once(busy, "connect"));
        const busyClosed = new Promise<void>((resolve) => busy.once("close", resolve));
        busy.write(controller.query(controller.pre, witness.pre, { route: "logs", q: { s: "101" } }));
        busy.write(controller.query(controller.pre, witness.pre, { route: "logs", q: { s: "102" } }));
        yield* race([
          call(() => busyClosed),
          (function*() {
            yield* sleepOp(2000);
            throw new Error("Pending query saturation stalled");
          })(),
        ]);
        assertEquals(
          refusals.at(-1),
          "peer",
          "a second unresolved query violates the connection exchange order",
        );
        stoppingReceiver = true;
        yield* waitForTaskHalt(tcpTask);
        if (receiveTask) yield* receiveTask.halt();
        yield* receiver.close();
        assert(sockets.every((socket) => socket.destroyed));

        assertEquals(
          refusals,
          ["wire", "peer", "peer", "peer", "peer"],
          "cancellation is distinct from peer refusal",
        );
        tcpTask = yield* spawn(serve);
        yield* sleepOp(50);
        const damaged = createConnection({ port: tcpPort, host: "127.0.0.1" });
        sockets.push(damaged);
        damaged.on("error", () => {});
        damaged.resume();
        yield* call(() => once(damaged, "connect"));
        // Durable verifier corruption is a host failure, not a peer wire refusal.
        const state = providerHby.db.getState(controller.pre);
        assertExists(state);
        providerHby.db.pinState(controller.pre, { ...state, k: ["!"] });
        providerHby.db.kevers.delete(controller.pre);
        controller.interact();
        damaged.write(acceptedEventReplayMessage(sourceHby, controller.pre, 4).message);
        const failure = yield* race([
          call(() => failed.promise),
          (function*() {
            yield* sleepOp(2000);
            throw new Error("Storage failure did not reach the host owner");
          })(),
        ]);
        assert(failure instanceof ParserError);
        assert(!(failure instanceof WireParseError));
        assertEquals(refusals, ["wire", "peer", "peer", "peer", "peer"]);
      } finally {
        if (driver) yield* driver.halt();
        stoppingReceiver = true;
        yield* waitForTaskHalt(tcpTask);
        if (receiveTask) yield* receiveTask.halt();
        yield* receiver.close();
        assert(sockets.every((socket) => socket.destroyed), "host shutdown must close its active peers");

        yield* runtime.close();
      }
    } finally {
      yield* providerHby.close();
      yield* sourceHby.close();
    }
  });
});
