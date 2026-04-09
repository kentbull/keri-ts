import { action, type Operation, run, spawn } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { createParser } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { buildCesrRequest, splitCesrStream } from "../../../src/app/cesr-http.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { envelopesFromFrames } from "../../../src/app/parsering.ts";
import { startServer } from "../../../src/app/server.ts";
import { Receiptor, startWitnessTcpServer } from "../../../src/app/witnessing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { Schemes } from "../../../src/core/schemes.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { fetchOp, sleepOp, textOp, waitForServer, waitForTaskHalt } from "../../effection-http.ts";

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

function firstEnvelope(bytes: Uint8Array): ReturnType<typeof envelopesFromFrames>[number] {
  const parser = createParser({
    framed: false,
    attachmentDispatchMode: "compat",
  });
  const envelopes = envelopesFromFrames(parser.feed(bytes), false);
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
  const runtime = yield* createAgentRuntime(hby, {
    mode: "both",
    enableMailboxStore: true,
  });
  try {
    ingestKeriBytes(
      runtime,
      witness.makeLocScheme(hostUrl, witness.pre, Schemes.http),
    );
    ingestKeriBytes(
      runtime,
      witness.makeEndRole(witness.pre, EndpointRoles.controller, true),
    );
    ingestKeriBytes(
      runtime,
      witness.makeEndRole(witness.pre, EndpointRoles.witness, true),
    );
    ingestKeriBytes(
      runtime,
      witness.makeEndRole(witness.pre, EndpointRoles.mailbox, true),
    );
    yield* processRuntimeTurn(runtime, { hab: witness, pollMailbox: false });
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
  const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
  try {
    for (const message of witness.db.clonePreIter(witness.pre, 0)) {
      ingestKeriBytes(runtime, message);
    }
    ingestKeriBytes(runtime, witness.makeLocScheme(url, witness.pre, scheme));
    yield* processRuntimeTurn(runtime, { pollMailbox: false });
    yield* processRuntimeTurn(runtime, { pollMailbox: false });
  } finally {
    yield* runtime.close();
  }
}

Deno.test("Witness runtime serves KERIpy-style receipts, KEL query replay, and combined mailbox OOBIs", async () => {
  const sourceName = `witness-runtime-source-${crypto.randomUUID()}`;
  const providerName = `witness-runtime-provider-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-witness-runtime-src-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-witness-runtime-provider-${crypto.randomUUID()}`;
  const port = randomPort();
  const hostUrl = `http://127.0.0.1:${port}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
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
      const runtime = yield* createAgentRuntime(providerHby, {
        mode: "both",
        enableMailboxStore: true,
      });
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
        const receiptEnvelope = firstEnvelope(receiptBytes);
        assertEquals(receiptEnvelope.cigars.length, 1);
        assertEquals(receiptEnvelope.wigers.length, 0);
        assertEquals(
          providerHby.db.wigs.get(dgKey(controller.pre, event.said)).length,
          1,
        );

        const storedResponse = yield* fetchOp(
          `${hostUrl}/receipts?pre=${controller.pre}&sn=0`,
        );
        assertEquals(storedResponse.status, 200);
        const storedBytes = yield* bytesOp(storedResponse);
        const storedEnvelope = firstEnvelope(storedBytes);
        assertEquals(storedEnvelope.cigars.length, 0);
        assertEquals(storedEnvelope.wigers.length, 1);

        const queryResponse = yield* fetchOp(
          `${hostUrl}/query?typ=kel&pre=${controller.pre}`,
        );
        assertEquals(queryResponse.status, 200);
        const queryBytes = yield* bytesOp(queryResponse);
        assertEquals(splitCesrStream(queryBytes).length, 1);
        assertEquals(firstEnvelope(queryBytes).serder.pre, controller.pre);

        const mailboxOobi = yield* fetchOp(
          `${hostUrl}/oobi/${witness.pre}/mailbox/${witness.pre}`,
        );
        assertEquals(mailboxOobi.status, 200);
        const mailboxBytes = yield* bytesOp(mailboxOobi);
        assertEquals(mailboxBytes.length > 0, true);

        const mailboxAdmin = yield* fetchOp(`${hostUrl}/mailboxes`, {
          method: "POST",
        });
        assertEquals(mailboxAdmin.status === 406 || mailboxAdmin.status === 400, true);
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
  const sourceHeadDirPath = `/tmp/tufa-witness-escrow-src-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-witness-escrow-provider-${crypto.randomUUID()}`;
  const port = randomPort();
  const hostUrl = `http://127.0.0.1:${port}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
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
      const runtime = yield* createAgentRuntime(providerHby, {
        mode: "both",
        enableMailboxStore: true,
      });
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
  const sourceHeadDirPath = `/tmp/tufa-witness-reject-src-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-witness-reject-provider-${crypto.randomUUID()}`;
  const port = randomPort();
  const hostUrl = `http://127.0.0.1:${port}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
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
      const runtime = yield* createAgentRuntime(providerHby, {
        mode: "both",
        enableMailboxStore: true,
      });
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

Deno.test("Receiptor catchup falls back to TCP witness transport when only tcp is advertised", async () => {
  const sourceName = `witness-tcp-source-${crypto.randomUUID()}`;
  const providerName = `witness-tcp-provider-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-witness-tcp-src-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-witness-tcp-provider-${crypto.randomUUID()}`;
  const tcpPort = randomPort();
  const tcpUrl = `tcp://127.0.0.1:${tcpPort}`;

  await run(function*() {
    const sourceHby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
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
      yield* seedRemoteWitnessLocation(sourceHby, witness, tcpUrl, Schemes.tcp);

      const runtime = yield* createAgentRuntime(providerHby, { mode: "local" });
      const tcpTask = yield* spawn(function*() {
        yield* startWitnessTcpServer(
          tcpPort,
          "127.0.0.1",
          runtime,
          witness,
        );
      });

      try {
        yield* sleepOp(50);
        const receiptor = new Receiptor(sourceHby);
        yield* receiptor.catchup(controller.pre, witness.pre);
        yield* sleepOp(50);
        assertEquals(providerHby.db.getKever(controller.pre)?.sn, 0);
      } finally {
        yield* waitForTaskHalt(tcpTask);
        yield* runtime.close();
      }
    } finally {
      yield* providerHby.close();
      yield* sourceHby.close();
    }
  });
});
