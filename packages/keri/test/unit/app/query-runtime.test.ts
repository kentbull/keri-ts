import { run, sleep, spawn } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";

import { startServer } from "../../../../tufa/src/host/http-server.ts";
import {
  createAgentRuntime,
  runAgentRuntime,
  settleRuntimeIngress,
} from "../../../src/app/agent-runtime.ts";

import { createHabery } from "../../../src/app/habbing.ts";
import { fetchResponseHandle } from "../../../src/app/httping.ts";
import { readMailboxSseBody } from "../../../src/app/mailbox-sse.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";

import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { witnessReceiptPost } from "../../../src/app/witnessing.ts";

import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

import { fetchOp, textOp, waitForServer, waitForTaskHalt } from "../../effection-http.ts";
import { reserveTcpPort } from "../../http-test-support.ts";

const textDecoder = new TextDecoder();

Deno.test("tufa agent host stays protocol-only", async () => {
  const name = `runtime-protocol-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-runtime-protocol-${crypto.randomUUID()}`;
  const alias = "alice";
  const port = reserveTcpPort();
  const url = `http://127.0.0.1:${port}`;
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
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
      pre = hab.pre;
      const runtime = yield* createAgentRuntime(hby);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(url, hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      ]);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    const hab = hby.habByName(alias);
    const runtime = yield* createAgentRuntime(hby, { enableMailboxStore: true });
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      const health = yield* fetchOp(`${url}/health`);
      assertEquals(health.status, 200);
      assertEquals(yield* textOp(health), "ok");

      const controller = yield* fetchOp(`${url}/oobi/${pre}/controller`);
      assertEquals(controller.status, 200);
      yield* textOp(controller);

      for (
        const blockedPath of ["/admin", "/admin/queue", "/rpc", "/control"]
      ) {
        const blocked = yield* fetchOp(`${url}${blockedPath}`);
        assertEquals(blocked.status, 404);
        yield* textOp(blocked);
      }
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* hby.close();
    }
  });
});

Deno.test("mailbox host returns 204 for posted `logs`/`ksn` and streams `/reply` and `/replay` only through `mbx`", async () => {
  const name = `runtime-mailbox-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-runtime-mailbox-${crypto.randomUUID()}`;
  const alias = "alice";
  const port = reserveTcpPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
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
      const runtime = yield* createAgentRuntime(hby);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(baseUrl, hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
      ]);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    const hab = hby.habByName(alias);
    const runtime = yield* createAgentRuntime(hby, { enableMailboxStore: true });
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, {
        hab: hab ?? undefined,
      });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime);
    });

    try {
      if (!hab) {
        throw new Error("Missing local habitat.");
      }
      yield* waitForServer(port);

      const ksnQuery = hab.query(hab.pre, hab.pre, { route: "ksn", q: {} });
      const posted = yield* fetchOp(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: textDecoder.decode(ksnQuery),
      });
      assertEquals(posted.status, 204);
      assertEquals(posted.headers.get("Content-Type"), "application/json");

      const mailboxQuery = hab.query(
        hab.pre,
        hab.pre,
        { route: "mbx", q: { topics: { "/reply": 0 } } },
      );
      const { response: streamed, controller } = yield* fetchResponseHandle(
        baseUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/cesr" },
          body: textDecoder.decode(mailboxQuery),
        },
      );
      assertEquals(streamed.status, 200);
      const body = yield* readMailboxSseBody(streamed, controller, {
        idleTimeoutMs: 500,
        maxDurationMs: 5_000,
      });
      assertStringIncludes(body, "event: /reply");
      assertStringIncludes(body, `/ksn/${hab.pre}`);

      const logsQuery = hab.query(
        hab.pre,
        hab.pre,
        { route: "logs", q: { s: "0", fn: "0" } },
      );
      const logsPosted = yield* fetchOp(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: textDecoder.decode(logsQuery),
      });
      assertEquals(logsPosted.status, 204);
      assertEquals(logsPosted.headers.get("Content-Type"), "application/json");

      const replayQuery = hab.query(
        hab.pre,
        hab.pre,
        { route: "mbx", q: { topics: { "/replay": 0 } } },
      );
      const { response: replayStream, controller: replayController } = yield* fetchResponseHandle(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: textDecoder.decode(replayQuery),
      });
      assertEquals(replayStream.status, 200);
      const replayBody = yield* readMailboxSseBody(
        replayStream,
        replayController,
        {
          idleTimeoutMs: 500,
          maxDurationMs: 5_000,
        },
      );
      assertStringIncludes(replayBody, "event: /replay");
      assertStringIncludes(replayBody, hab.pre);
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* hby.close();
    }
  });
});

Deno.test("witness anchor logs queries forward `/replay` to a separate relay mailbox", async () => {
  const witnessPort = reserveTcpPort();
  const relayPort = reserveTcpPort();
  const witnessUrl = `http://127.0.0.1:${witnessPort}`;
  const relayUrl = `http://127.0.0.1:${relayPort}`;

  await run(function*() {
    const proxyHby = yield* createHabery({
      name: `runtime-proxy-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const witnessHby = yield* createHabery({
      name: `runtime-witness-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const relayHby = yield* createHabery({
      name: `runtime-relay-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    const proxy = proxyHby.makeHab("proxy", undefined, {
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    });
    const delegate = proxyHby.makeHab("delegate", undefined, {
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    });
    const witness = witnessHby.makeHab("witness", undefined, {
      transferable: false,
      icount: 1,
      isith: "1",
      toad: 0,
    });
    const delegator = witnessHby.makeHab("delegator", undefined, {
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    });
    const relay = relayHby.makeHab("relay", undefined, {
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    });

    const seal = {
      i: delegate.pre,
      s: "0",
      d: delegate.kever?.said ?? "",
    };
    delegator.interact({ data: [seal] });

    const proxyMailboxAuth = proxy.makeEndRole(
      relay.pre,
      EndpointRoles.mailbox,
      true,
    );
    const relayLoc = relay.makeLocScheme(relayUrl, relay.pre, "http");
    const witnessLoc = witness.makeLocScheme(witnessUrl, witness.pre, "http");

    const proxyRuntime = yield* createAgentRuntime(proxyHby);
    const witnessRuntime = yield* createAgentRuntime(witnessHby, {
      enableMailboxStore: true,
    });
    const relayRuntime = yield* createAgentRuntime(relayHby, {
      enableMailboxStore: true,
    });

    const witnessRuntimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(witnessRuntime, {
        hab: witness,
      });
    });
    const relayRuntimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(relayRuntime, { hab: relay });
    });
    const witnessServerTask = yield* spawn(function*() {
      yield* startServer(witnessPort, undefined, witnessRuntime, {
        serviceHab: witness,
        hostedPrefixes: [witness.pre],
      });
    });
    const relayServerTask = yield* spawn(function*() {
      yield* startServer(relayPort, undefined, relayRuntime, {
        serviceHab: relay,
        hostedPrefixes: [relay.pre],
      });
    });

    try {
      for (const msg of relayHby.db.clonePreIter(relay.pre)) {
        yield* settleRuntimeIngress(proxyRuntime, [msg]);
      }
      yield* settleRuntimeIngress(proxyRuntime, [proxyMailboxAuth, relayLoc, witnessLoc]);

      for (const msg of proxyHby.db.clonePreIter(proxy.pre)) {
        yield* settleRuntimeIngress(relayRuntime, [msg]);
      }
      yield* settleRuntimeIngress(relayRuntime, [
        proxyMailboxAuth,
        relayLoc,
        relay.makeEndRole(relay.pre, EndpointRoles.controller, true),
        relay.makeEndRole(relay.pre, EndpointRoles.mailbox, true),
      ]);

      yield* waitForServer(witnessPort);
      yield* waitForServer(relayPort);

      proxyRuntime.querying.enqueueCue({
        kin: "query",
        pre: delegator.pre,
        src: witness.pre,
        route: "logs",
        q: { fn: "0", s: "0", a: seal },
        wits: [witness.pre],
      }, proxy);

      // Network response processing begins only after the cue consumer's guarded turn has ended.
      yield* proxyRuntime.querying.deliverOnce();
      assertExists(witnessRuntime.hby.db.getKever(proxy.pre));
      assertExists(
        witnessRuntime.hby.db.ends.get([
          proxy.pre,
          EndpointRoles.mailbox,
          relay.pre,
        ]),
      );
      assertEquals(
        witness.fetchUrls(relay.pre).http ?? null,
        relayUrl,
      );
      assertEquals(
        Boolean(
          witnessRuntime.hby.db.fetchAllSealingEventByEventSeal(
            delegator.pre,
            seal,
          ),
        ),
        true,
      );
      assertEquals(witnessRuntime.hby.db.qnfs.cnt(), 0);

      const mbx = proxy.query(
        proxy.pre,
        relay.pre,
        { route: "mbx", q: { topics: { "/replay": 0 } } },
      );
      // The query response publishes work; the independent postman completes forwarding later.
      const deadline = Date.now() + 5_000;
      while (
        !relayRuntime.hby.db.getKever(witness.pre)
        || !relayRuntime.mailboxer!.getTopicMsgs(mailboxTopicKey(proxy.pre, "/replay")).length
      ) {
        if (Date.now() >= deadline) throw new Error("Witness replay did not reach the relay mailbox");
        yield* sleep(10);
      }
      assertExists(relayRuntime.hby.db.getKever(witness.pre));
      const { response, controller } = yield* fetchResponseHandle(relayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: textDecoder.decode(mbx),
      });
      assertEquals(response.status, 200);
      const body = yield* readMailboxSseBody(response, controller, {
        idleTimeoutMs: 500,
        maxDurationMs: 5_000,
      });
      assertStringIncludes(body, "event: /replay");
      assertStringIncludes(body, delegator.pre);
    } finally {
      yield* waitForTaskHalt(witnessRuntimeTask);
      yield* waitForTaskHalt(relayRuntimeTask);
      yield* waitForTaskHalt(relayServerTask);
      yield* waitForTaskHalt(witnessServerTask);
      yield* relayRuntime.close();
      yield* witnessRuntime.close();
      yield* proxyRuntime.close();
      yield* relayHby.close(true);
      yield* witnessHby.close(true);
      yield* proxyHby.close(true);
    }
  });
});

Deno.test("reopened witness `logs` queries replay remote accepted KEL state via read-through `getKever`", async () => {
  const witnessName = `runtime-reopen-witness-${crypto.randomUUID()}`;
  const subjectName = `runtime-reopen-subject-${crypto.randomUUID()}`;
  const requesterName = `runtime-reopen-requester-${crypto.randomUUID()}`;
  const witnessHeadDirPath = `/tmp/tufa-runtime-reopen-witness-${crypto.randomUUID()}`;
  const subjectHeadDirPath = `/tmp/tufa-runtime-reopen-subject-${crypto.randomUUID()}`;
  const requesterHeadDirPath = `/tmp/tufa-runtime-reopen-requester-${crypto.randomUUID()}`;
  let witnessPre = "";
  let subjectPre = "";
  let subjectSaid = "";
  let queryBytes = new Uint8Array();

  await run(function*() {
    const witnessHby = yield* createHabery({
      name: witnessName,
      headDirPath: witnessHeadDirPath,
      skipConfig: true,
    });
    const subjectHby = yield* createHabery({
      name: subjectName,
      headDirPath: subjectHeadDirPath,
      skipConfig: true,
    });
    const requesterHby = yield* createHabery({
      name: requesterName,
      headDirPath: requesterHeadDirPath,
      skipConfig: true,
    });

    try {
      const witness = witnessHby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const requester = requesterHby.makeHab("requester", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = subjectHby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });

      witnessPre = witness.pre;
      subjectPre = subject.pre;
      subjectSaid = subject.kever?.said ?? "";
      queryBytes = new Uint8Array(
        requester.query(
          subject.pre,
          requester.pre,
          { route: "logs", q: { fn: "0", s: "0" } },
        ),
      );

      const runtime = yield* createAgentRuntime(witnessHby, {
        enableMailboxStore: true,
      });
      try {
        const message = [...subjectHby.db.clonePreIter(subject.pre, 0)][0];
        assertExists(message);
        const result = yield* witnessReceiptPost(runtime, witness, message);
        assertEquals(result.kind, "accepted");
        assertEquals(
          witnessHby.db.wigs.get(dgKey(subject.pre, subjectSaid)).length,
          1,
        );
        assertExists(witnessHby.db.getState(subject.pre));
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* requesterHby.close(true);
      yield* subjectHby.close(true);
      yield* witnessHby.close();
    }
  });

  await run(function*() {
    const witnessHby = yield* createHabery({
      name: witnessName,
      headDirPath: witnessHeadDirPath,
      skipConfig: true,
    });
    try {
      const witness = witnessHby.habByName("witness");
      assertExists(witness);
      assertExists(witnessHby.db.getState(subjectPre));
      assertEquals(witnessHby.db.kevers.has(subjectPre), false);

      const runtime = yield* createAgentRuntime(witnessHby, {
        enableMailboxStore: true,
      });
      try {
        yield* settleRuntimeIngress(runtime, [queryBytes]);
        const replay = runtime.cues.toArray().find((cue) => cue.kin === "replay");
        assertExists(replay);
        assertEquals([...replay.msgs].length > 0, true);
        yield* processCuesOnce(runtime, { hab: witness });
        assertEquals(witnessHby.db.kevers.has(subjectPre), true);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* witnessHby.close(true);
    }
  });
});
