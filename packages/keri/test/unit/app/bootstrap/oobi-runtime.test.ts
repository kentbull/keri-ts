import { call, run, spawn } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals, assertStringIncludes } from "jsr:@std/assert";
import { concatBytes, Diger, Prefixer, SerderKERI } from "../../../../../cesr/mod.ts";
import { startServer } from "../../../../../tufa/src/host/http-server.ts";
import { createProtocolHandler } from "../../../../../tufa/src/http/protocol-handler.ts";
import { resolveBootstrap } from "../../../../src/app/bootstrap/bootstrapping.ts";
import { oobiTerminalState } from "../../../../src/app/bootstrap/oobiery.ts";
import { createProtocolProcessor } from "../../../../src/app/protocol/protocol-processing.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import {
  createAgentRuntime,
  enqueueOobi,
  runAgentRuntime,
  runAgentRuntimeUntil,
  runtimeOobiConverged,
  runtimePendingState,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { processCuesOnce } from "../../../../src/app/runtime/cue-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { httpClient } from "../../../support/http-client.ts";

import { inceptCommand } from "../../../../src/cli/identity/incept.ts";
import { initCommand } from "../../../../src/cli/identity/init.ts";

import { Authenticator, hasWellKnownAuth } from "../../../../src/app/bootstrap/authenticating.ts";
import { createConfiger } from "../../../../src/app/identity/configing.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../../src/app/identity/habbing.ts";
import { oobiGenerateCommand, oobiResolveCommand } from "../../../../src/cli/endpoints/oobi.ts";

import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { reply as makeReplySerder } from "../../../../src/core/protocol-eventing.ts";
import { EndpointRoles } from "../../../../src/core/roles.ts";

import { waitForServer, waitForTaskHalt } from "../../../effection-http.ts";
import { reserveTcpPort } from "../../../http-test-support.ts";
import { testCLICommand } from "../../../utils.ts";

const textDecoder = new TextDecoder();

/** Serve static OOBI responses until the owning test finishes. */
function startStaticOobiHost(
  port: number,
  handler: (request: Request, url: URL) => Response | Promise<Response>,
): { close: () => Promise<void> } {
  const controller = new AbortController();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port,
    signal: controller.signal,
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return await handler(request, url);
  });

  return {
    async close() {
      controller.abort();
      try {
        await server.finished;
      } catch {
        // Abort-driven shutdown is expected here.
      }
    },
  };
}

/** Attach the real signing habitat's establishment seal to a reply. */
function replySigGroupFor(
  hab: {
    pre: string;
    kever: { sner: TransIdxSigGroup["seqner"]; said: string } | null;
    sign: (ser: Uint8Array, indexed: true) => TransIdxSigGroup["sigers"];
  },
  serder: SerderKERI,
): TransIdxSigGroup {
  assertExists(hab.kever);
  return new TransIdxSigGroup(
    new Prefixer({ qb64: hab.pre }),
    hab.kever.sner,
    new Diger({ qb64: hab.kever.said }),
    hab.sign(serder.raw, true),
  );
}

Deno.test("mailbox and agent OOBIs generate and resolve through shared runtime", async () => {
  const sourceName = `runtime-source-${crypto.randomUUID()}`;
  const targetName = `runtime-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-runtime-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-runtime-dst-${crypto.randomUUID()}`;
  const alias = "source";
  const port = reserveTcpPort();
  let pre = "";
  let mailboxUrl = "";
  let agentUrl = "";

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
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
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      const url = `http://127.0.0.1:${port}`;
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(url, hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        hab.makeEndRole(hab.pre, EndpointRoles.agent, true),
        hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
      ]);
      const handler = createProtocolHandler(runtime);
      const request = new Request(`${url}/oobi/${pre}/agent/${pre}`);
      const read = hby.db.getEvt;
      let hydrations = 0;
      hby.db.getEvt = function(...args) {
        hydrations++;
        return read.apply(this, args);
      };
      try {
        const response = yield* call(() => handler(request));
        assertEquals(response.status, 200);
        assertEquals(response.headers.get("KERI-AID"), pre);
        assertEquals(hydrations, 1); // Primed KEL only; stored replies remain lazy.
        yield* call(() => response.body!.cancel());
        assertEquals(hydrations, 1);
      } finally {
        hby.db.getEvt = read;
      }
    } finally {
      yield* hby.close();
    }
  });

  const mailboxGenerated = await run(() =>
    testCLICommand(
      oobiGenerateCommand({
        name: sourceName,
        headDirPath: sourceHeadDirPath,
        alias,
        role: EndpointRoles.mailbox,
      }),
    )
  );
  mailboxUrl = mailboxGenerated.output.at(-1) ?? "";
  assertStringIncludes(mailboxUrl, `/oobi/${pre}/mailbox/${pre}`);

  const agentGenerated = await run(() =>
    testCLICommand(
      oobiGenerateCommand({
        name: sourceName,
        headDirPath: sourceHeadDirPath,
        alias,
        role: EndpointRoles.agent,
      }),
    )
  );
  agentUrl = agentGenerated.output.at(-1) ?? "";
  assertStringIncludes(agentUrl, `/oobi/${pre}/agent/${pre}`);

  await run(function*() {
    const hby = yield* createHabery({
      name: targetName,
      headDirPath: targetHeadDirPath,
      skipConfig: true,
    });
    try {
      // create target store only
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    const hab = hby.habByName(alias);
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      enableMailboxStore: true,
    });
    // Open the advertised provider before its runtime can start loopback polling.
    const serverTask = yield* spawn(() => startServer(port, undefined, runtime));
    yield* waitForServer(port);
    const runtimeTask = yield* spawn(() => runAgentRuntime(runtime, { hab: hab ?? undefined }));

    try {
      const mailboxResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          url: mailboxUrl,
        }),
      );
      assertEquals(mailboxResolved.output.at(-1), mailboxUrl);

      const agentResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          url: agentUrl,
        }),
      );
      assertEquals(agentResolved.output.at(-1), agentUrl);
    } finally {
      yield* waitForTaskHalt(runtimeTask);
      yield* waitForTaskHalt(serverTask);
      yield* runtime.close();
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: targetName,
      headDirPath: targetHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.db.getState(pre)?.i, pre);
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.mailbox, pre])?.allowed,
        true,
      );
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.agent, pre])?.allowed,
        true,
      );
      assertEquals(
        hby.db.locs.get([pre, "http"])?.url,
        `http://127.0.0.1:${port}`,
      );
      assertEquals(hby.db.roobi.get(mailboxUrl)?.state, "resolved");
      assertEquals(hby.db.roobi.get(agentUrl)?.state, "resolved");
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("well-known auth converges through rmfa and wkas with honest pending state", async () => {
  const sourceName = `runtime-auth-source-${crypto.randomUUID()}`;
  const targetName = `runtime-auth-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-runtime-auth-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-runtime-auth-dst-${crypto.randomUUID()}`;
  const port = reserveTcpPort();
  const hostUrl = `http://127.0.0.1:${port}`;
  let pre = "";
  let controllerUrl = "";
  let wellKnownUrl = "";
  let failingWellKnownUrl = "";
  let controllerBytes = new Uint8Array();
  let authRequests = 0;

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("source", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      controllerUrl = `${hostUrl}/oobi/${pre}/controller`;
      wellKnownUrl = `${hostUrl}/.well-known/keri/oobi/${pre}?name=Root`;
      failingWellKnownUrl = `${hostUrl}/.well-known/keri/oobi/${pre}?mode=fail`;

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(hostUrl, hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      ]);

      controllerBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.controller),
      );
    } finally {
      yield* hby.close();
    }
  });

  const host = startStaticOobiHost(port, (_request, url) => {
    if (url.pathname === `/oobi/${pre}/controller`) {
      return new Response(controllerBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/cesr",
          "Oobi-Aid": pre,
        },
      });
    }
    if (url.pathname === `/.well-known/keri/oobi/${pre}`) {
      authRequests++;
      if (url.searchParams.get("mode") === "fail") {
        return new Response("missing", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response(controllerBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/cesr",
          "Oobi-Aid": pre,
        },
      });
    }
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  });

  try {
    await run(() => waitForServer(port));

    await run(function*() {
      const hby = yield* createHabery({
        name: targetName,
        headDirPath: targetHeadDirPath,
        skipConfig: true,
      });
      try {
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        enqueueOobi(runtime, { url: controllerUrl });
        enqueueOobi(runtime, { url: wellKnownUrl });

        yield* runtime.oobiery.processOnce();
        yield* runtime.authenticator.processOnce();
        assertEquals(hby.db.roobi.get(controllerUrl)?.state, "resolved");
        assertEquals(runtimePendingState(runtime).authQueued, false);
        assertEquals(runtimePendingState(runtime).authInFlight, true);
        assertEquals(runtimeOobiConverged(runtime, wellKnownUrl), false);
        yield* runtime.authenticator.processOnce();
        yield* processCuesOnce(runtime);
        assertEquals(hby.db.rmfa.get(wellKnownUrl)?.state, "resolved");
        assertEquals(hasWellKnownAuth(runtime.hby.db, wellKnownUrl), true);
        assertEquals(
          oobiTerminalState(runtime.hby.db, wellKnownUrl).status,
          "resolved",
        );
        assertEquals(runtimeOobiConverged(runtime, wellKnownUrl), true);

        enqueueOobi(runtime, { url: failingWellKnownUrl });
        yield* runtime.authenticator.processOnce();
        assertEquals(runtimePendingState(runtime).authInFlight, true);
        yield* runtime.authenticator.processOnce();
        assertEquals(hby.db.rmfa.get(failingWellKnownUrl)?.state, "http-404");
        assertEquals(
          oobiTerminalState(runtime.hby.db, failingWellKnownUrl).status,
          "failed",
        );

        const cleanupUrl = `${wellKnownUrl}&cleanup=1`;
        const cleanupFailure = new Error("well-known response cleanup failed");
        let finishCleanup!: () => void, cleanupStarted!: () => void;
        const cleaning = new Promise<void>((resolve) => finishCleanup = resolve);
        const started = new Promise<void>((resolve) => cleanupStarted = resolve);
        const signals: AbortSignal[] = [];
        const auth = new Authenticator(
          hby,
          httpClient((_url, init) => {
            signals.push(init!.signal!);
            return Promise.resolve(
              new Response(
                new ReadableStream({
                  cancel() {
                    cleanupStarted();
                    return cleaning.then(() => {
                      throw cleanupFailure;
                    });
                  },
                }),
              ),
            );
          }),
        );
        hby.db.mfa.pin(cleanupUrl, { cid: pre, state: "auth-pending" });
        const task = run(() => auth.processOnce());
        try {
          yield* call(() => started);

          const halted = task.halt();
          let joined = false;
          void halted.then(() => joined = true, () => joined = true);
          yield* call(() => new Promise((resolve) => setTimeout(resolve, 0)));
          assertEquals(joined, false, "cancellation must join the pending body cleanup");
          assertEquals(hby.db.rmfa.get(cleanupUrl), null, "cleanup cannot publish authorization");
          finishCleanup();
          assertStrictEquals(yield* call(() => assertRejects(() => halted)), cleanupFailure);
          assertEquals(signals[0].aborted, true);

          assertEquals(hby.db.mfa.get(cleanupUrl)?.state, "auth-pending");
          assertEquals(hby.db.rmfa.get(cleanupUrl), null);
        } finally {
          finishCleanup();
          yield* call(() =>
            task.halt().catch((error) => {
              if (error !== cleanupFailure) throw error;
            })
          );
        }
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

Deno.test("controller and witness OOBIs generate and resolve through shared runtime", async () => {
  const sourceName = `runtime-controller-source-${crypto.randomUUID()}`;
  const targetName = `runtime-controller-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-runtime-controller-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-runtime-controller-dst-${crypto.randomUUID()}`;
  const alias = "controller";
  const witnessAlias = "witness";
  const port = reserveTcpPort();
  const url = `http://127.0.0.1:${port}`;
  let pre = "";
  let witnessPre = "";
  let controllerUrl = "";
  let witnessUrl = "";
  let wellKnownUrl = "";

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    try {
      const witnessHab = hby.makeHab(witnessAlias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      witnessPre = witnessHab.pre;

      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      hby.db.pinState(pre, {
        ...hby.db.getState(pre),
        b: [witnessPre],
        bt: "1",
      });
      if (hab.kever) {
        hab.kever.wits = [witnessPre];
      }

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(url, hab.pre, "http"),
        witnessHab.makeLocScheme(url, witnessHab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      ]);
    } finally {
      yield* hby.close();
    }
  });

  const controllerGenerated = await run(() =>
    testCLICommand(
      oobiGenerateCommand({
        name: sourceName,
        headDirPath: sourceHeadDirPath,
        alias,
        role: EndpointRoles.controller,
      }),
    )
  );
  controllerUrl = controllerGenerated.output.at(-1) ?? "";
  assertStringIncludes(controllerUrl, `/oobi/${pre}/controller`);
  wellKnownUrl = `${url}/.well-known/keri/oobi/${pre}?name=Root`;

  const witnessGenerated = await run(() =>
    testCLICommand(
      oobiGenerateCommand({
        name: sourceName,
        headDirPath: sourceHeadDirPath,
        alias,
        role: EndpointRoles.witness,
      }),
    )
  );
  witnessUrl = witnessGenerated.output.at(-1) ?? "";
  assertStringIncludes(witnessUrl, `/oobi/${pre}/witness/${witnessPre}`);

  await run(function*() {
    const hby = yield* createHabery({
      name: targetName,
      headDirPath: targetHeadDirPath,
      skipConfig: true,
    });
    try {
      // create target store only
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    const hab = hby.habByName(alias);
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      enableMailboxStore: true,
    });
    // Open the advertised provider before its runtime can start loopback polling.
    const serverTask = yield* spawn(() => startServer(port, undefined, runtime));
    yield* waitForServer(port);
    const runtimeTask = yield* spawn(() => runAgentRuntime(runtime, { hab: hab ?? undefined }));

    try {
      const controllerResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          url: controllerUrl,
        }),
      );
      assertEquals(controllerResolved.output.at(-1), controllerUrl);

      const witnessResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          url: witnessUrl,
        }),
      );
      assertEquals(witnessResolved.output.at(-1), witnessUrl);

      const wellKnownResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          url: wellKnownUrl,
        }),
      );
      assertEquals(wellKnownResolved.output.at(-1), wellKnownUrl);
    } finally {
      yield* waitForTaskHalt(runtimeTask);
      yield* waitForTaskHalt(serverTask);
      yield* runtime.close();
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: targetName,
      headDirPath: targetHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.db.getState(pre)?.i, pre);
      assertEquals(hby.db.locs.get([pre, "http"])?.url, url);
      assertEquals(hby.db.locs.get([witnessPre, "http"])?.url, url);
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.witness, witnessPre])?.allowed,
        true,
      );
      assertEquals(hby.db.roobi.get(controllerUrl)?.state, "resolved");
      assertEquals(hby.db.roobi.get(witnessUrl)?.state, "resolved");
      assertEquals(hby.db.rmfa.get(wellKnownUrl)?.state, "resolved");
      assertEquals(
        hby.db.wkas.get(pre).some((record) => record.url === wellKnownUrl),
        true,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("config preload bootstrap URLs resolve through shared runtime queues", async () => {
  const sourceName = `runtime-config-source-${crypto.randomUUID()}`;
  const targetName = `runtime-config-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-runtime-config-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-runtime-config-dst-${crypto.randomUUID()}`;
  const port = reserveTcpPort();
  const url = `http://127.0.0.1:${port}`;
  let iPre = "";
  let dPre = "";
  let iurl = "";
  let durl = "";
  let wurl = "";

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    try {
      const iHab = hby.makeHab("bootstrap-init", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const dHab = hby.makeHab("bootstrap-delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      iPre = iHab.pre;
      dPre = dHab.pre;
      iurl = `${url}/oobi/${iPre}/controller`;
      durl = `${url}/oobi/${dPre}/controller`;
      wurl = `${url}/.well-known/keri/oobi/${iPre}?name=Root`;

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      for (const hab of [iHab, dHab]) {
        yield* settleRuntimeIngress(runtime, [
          hab.makeLocScheme(url, hab.pre, "http"),
          hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        ]);
      }
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const cf = yield* createConfiger({
      name: targetName,
      headDirPath: targetHeadDirPath,
      reopen: true,
    });
    try {
      cf.put({
        dt: new Date().toISOString(),
        iurls: [iurl],
        durls: [durl],
        wurls: [wurl],
      });
    } finally {
      yield* cf.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    const hab = hby.habByName("bootstrap-init");
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      enableMailboxStore: true,
    });
    // Open the advertised provider before its runtime can start loopback polling.
    const serverTask = yield* spawn(() => startServer(port, undefined, runtime));
    yield* waitForServer(port);
    const runtimeTask = yield* spawn(() => runAgentRuntime(runtime, { hab: hab ?? undefined }));

    try {
      const target = yield* createHabery({
        name: targetName,
        headDirPath: targetHeadDirPath,
        skipSignator: true,
      });
      try {
        const targetRuntime = yield* createAgentRuntime(
          target,
          new FetchHttpClient(),
          systemClock,
        );
        yield* runAgentRuntimeUntil(targetRuntime, () =>
          target.db.roobi.get(iurl)?.state === "resolved"
          && target.db.roobi.get(durl)?.state === "resolved"
          && target.db.rmfa.get(wurl)?.state === "resolved", { timeoutMs: 5_000, pollMailbox: false });

        assertEquals(target.db.roobi.get(iurl)?.state, "resolved");
        assertEquals(target.db.roobi.get(durl)?.state, "resolved");
        assertEquals(target.db.rmfa.get(wurl)?.state, "resolved");
        assertEquals(target.db.getState(iPre)?.i, iPre);
        assertEquals(target.db.getState(dPre)?.i, dPre);
        assertEquals(target.db.locs.get([iPre, "http"])?.url, url);
        assertEquals(target.db.locs.get([dPre, "http"])?.url, url);
        assertEquals(
          target.db.wkas.get(iPre).some((record) => record.url === wurl),
          true,
        );
      } finally {
        yield* target.close();
      }
    } finally {
      yield* waitForTaskHalt(runtimeTask);
      yield* waitForTaskHalt(serverTask);
      yield* runtime.close();
      yield* hby.close();
    }
  });
});

Deno.test("init command waits for configured well-known auth before exit", async () => {
  const sourceName = `runtime-init-source-${crypto.randomUUID()}`;
  const targetName = `runtime-init-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-runtime-init-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-runtime-init-dst-${crypto.randomUUID()}`;
  const port = reserveTcpPort();
  const hostUrl = `http://127.0.0.1:${port}`;
  let pre = "";
  let controllerUrl = "";
  let wellKnownUrl = "";
  let controllerBytes = new Uint8Array();

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("source", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      controllerUrl = `${hostUrl}/oobi/${pre}/controller`;
      wellKnownUrl = `${hostUrl}/.well-known/keri/oobi/${pre}?name=Root`;

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(hostUrl, hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      ]);

      controllerBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.controller),
      );
    } finally {
      yield* hby.close();
    }
  });

  const host = startStaticOobiHost(port, (_request, url) => {
    if (
      url.pathname === `/oobi/${pre}/controller`
      || url.pathname === `/.well-known/keri/oobi/${pre}`
    ) {
      return new Response(controllerBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/cesr",
          "Oobi-Aid": pre,
        },
      });
    }
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  });

  try {
    await run(() => waitForServer(port));

    await run(function*() {
      const cf = yield* createConfiger({
        name: targetName,
        headDirPath: targetHeadDirPath,
        reopen: true,
      });
      try {
        cf.put({
          dt: new Date().toISOString(),
          iurls: [controllerUrl],
          wurls: [wellKnownUrl],
        });
      } finally {
        yield* cf.close();
      }
    });

    await run(() =>
      testCLICommand(
        initCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          configDir: targetHeadDirPath,
          configFile: targetName,
          nopasscode: true,
        }),
      )
    );

    await run(function*() {
      const hby = yield* createHabery({
        name: targetName,
        headDirPath: targetHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertEquals(hby.db.roobi.get(controllerUrl)?.state, "resolved");
        assertEquals(hby.db.rmfa.get(wellKnownUrl)?.state, "resolved");
        assertEquals(
          hby.db.wkas.get(pre).some((record) => record.url === wellKnownUrl),
          true,
        );
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

Deno.test("incept command waits for configured well-known auth before inception", async () => {
  const sourceName = `runtime-incept-source-${crypto.randomUUID()}`;
  const targetName = `runtime-incept-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-runtime-incept-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-runtime-incept-dst-${crypto.randomUUID()}`;
  const port = reserveTcpPort();
  const hostUrl = `http://127.0.0.1:${port}`;
  let pre = "";
  let controllerUrl = "";
  let wellKnownUrl = "";
  let controllerBytes = new Uint8Array();

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("source", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      controllerUrl = `${hostUrl}/oobi/${pre}/controller`;
      wellKnownUrl = `${hostUrl}/.well-known/keri/oobi/${pre}?name=Root`;

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(hostUrl, hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      ]);

      controllerBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.controller),
      );
    } finally {
      yield* hby.close();
    }
  });

  const host = startStaticOobiHost(port, (_request, url) => {
    if (
      url.pathname === `/oobi/${pre}/controller`
      || url.pathname === `/.well-known/keri/oobi/${pre}`
    ) {
      return new Response(controllerBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/cesr",
          "Oobi-Aid": pre,
        },
      });
    }
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  });

  try {
    await run(() => waitForServer(port));

    await run(() =>
      testCLICommand(
        initCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          nopasscode: true,
        }),
      )
    );

    await run(function*() {
      const cf = yield* createConfiger({
        name: targetName,
        headDirPath: targetHeadDirPath,
        reopen: true,
      });
      try {
        cf.put({
          dt: new Date().toISOString(),
          iurls: [controllerUrl],
          wurls: [wellKnownUrl],
        });
      } finally {
        yield* cf.close();
      }
    });

    await run(() =>
      testCLICommand(
        inceptCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          configDir: targetHeadDirPath,
          configFile: targetName,
          alias: "target",
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        }),
      )
    );

    await run(function*() {
      const hby = yield* createHabery({
        name: targetName,
        headDirPath: targetHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertExists(hby.habByName("target"));
        assertEquals(hby.db.roobi.get(controllerUrl)?.state, "resolved");
        assertEquals(hby.db.rmfa.get(wellKnownUrl)?.state, "resolved");
        assertEquals(
          hby.db.wkas.get(pre).some((record) => record.url === wellKnownUrl),
          true,
        );
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

Deno.test("reply-based `/oobi/controller` JSON fans out child OOBIs through moobi", async () => {
  const sourceName = `runtime-multi-controller-source-${crypto.randomUUID()}`;
  const targetName = `runtime-multi-controller-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-runtime-multi-controller-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-runtime-multi-controller-dst-${crypto.randomUUID()}`;
  const port = reserveTcpPort();
  const hostUrl = `http://127.0.0.1:${port}`;
  let pre = "";
  let parentUrl = "";
  let childUrls: string[] = [];
  let controllerBytes = new Uint8Array();

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("source", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      parentUrl = `${hostUrl}/oobi/${pre}/controller?mode=multi`;
      childUrls = [
        `${hostUrl}/oobi/${pre}/controller?slot=1`,
        `${hostUrl}/oobi/${pre}/controller?slot=2`,
      ];

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(hostUrl, hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      ]);

      controllerBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.controller),
      );
    } finally {
      yield* hby.close();
    }
  });

  const parentReply = makeReplySerder("/oobi/controller", {
    aid: pre,
    urls: childUrls,
  });
  const host = startStaticOobiHost(port, (_request, url) => {
    if (url.pathname === `/oobi/${pre}/controller`) {
      if (url.searchParams.get("mode") === "multi") {
        return new Response(new Blob([new Uint8Array(parentReply.raw)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(controllerBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/cesr",
          "Oobi-Aid": pre,
        },
      });
    }
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  });

  try {
    await run(() => waitForServer(port));

    await run(function*() {
      const hby = yield* createHabery({
        name: targetName,
        headDirPath: targetHeadDirPath,
        skipConfig: true,
      });
      try {
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        enqueueOobi(runtime, { url: parentUrl });

        yield* runtime.oobiery.processOnce();
        assertEquals(hby.db.moobi.get(parentUrl)?.state, "pending-multi-oobi");
        assertEquals(runtimePendingState(runtime).multiPending, true);
        assertEquals(runtimePendingState(runtime).oobiQueued, true);
        assertEquals(runtimeOobiConverged(runtime, parentUrl), false);

        yield* runtime.oobiery.processOnce();
        yield* runtime.oobiery.processOnce();
        assertEquals(runtimePendingState(runtime).multiPending, true);
        assertEquals(runtimeOobiConverged(runtime, parentUrl), false);

        yield* runtime.oobiery.processOnce();
        assertEquals(hby.db.moobi.get(parentUrl), null);
        assertEquals(hby.db.roobi.get(parentUrl)?.state, "resolved");
        for (const childUrl of childUrls) {
          assertEquals(hby.db.roobi.get(childUrl)?.state, "resolved");
        }
        assertEquals(
          oobiTerminalState(runtime.hby.db, parentUrl).status,
          "resolved",
        );
        yield* processCuesOnce(runtime);
        assertEquals(runtimeOobiConverged(runtime, parentUrl), true);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

Deno.test("reply-based `/oobi/witness` JSON fans out child OOBIs through moobi", async () => {
  const sourceName = `runtime-multi-witness-source-${crypto.randomUUID()}`;
  const targetName = `runtime-multi-witness-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-runtime-multi-witness-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-runtime-multi-witness-dst-${crypto.randomUUID()}`;
  const port = reserveTcpPort();
  const hostUrl = `http://127.0.0.1:${port}`;
  let pre = "";
  let witnessPre = "";
  let parentUrl = "";
  let childUrls: string[] = [];
  let witnessBytes = new Uint8Array();

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    try {
      const witnessHab = hby.makeHab("witness", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      witnessPre = witnessHab.pre;

      const hab = hby.makeHab("source", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      parentUrl = `${hostUrl}/oobi/${pre}/witness/${witnessPre}?mode=multi`;
      childUrls = [
        `${hostUrl}/oobi/${pre}/witness/${witnessPre}?slot=1`,
        `${hostUrl}/oobi/${pre}/witness/${witnessPre}?slot=2`,
      ];

      hby.db.pinState(pre, {
        ...hby.db.getState(pre),
        b: [witnessPre],
        bt: "1",
      });
      if (hab.kever) {
        hab.kever.wits = [witnessPre];
      }

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(hostUrl, hab.pre, "http"),
        witnessHab.makeLocScheme(hostUrl, witnessHab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      ]);

      witnessBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.witness, [witnessPre]),
      );
    } finally {
      yield* hby.close();
    }
  });

  const parentReply = makeReplySerder("/oobi/witness", {
    aid: pre,
    urls: childUrls,
  });
  const host = startStaticOobiHost(port, (_request, url) => {
    if (url.pathname === `/oobi/${pre}/witness/${witnessPre}`) {
      if (url.searchParams.get("mode") === "multi") {
        return new Response(new Blob([new Uint8Array(parentReply.raw)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(witnessBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/cesr",
          "Oobi-Aid": pre,
        },
      });
    }
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  });

  try {
    await run(() => waitForServer(port));

    await run(function*() {
      const hby = yield* createHabery({
        name: targetName,
        headDirPath: targetHeadDirPath,
        skipConfig: true,
      });
      try {
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        enqueueOobi(runtime, { url: parentUrl });

        yield* runtime.oobiery.processOnce();
        assertEquals(hby.db.moobi.get(parentUrl)?.state, "pending-multi-oobi");
        assertEquals(runtimePendingState(runtime).multiPending, true);
        assertEquals(runtimePendingState(runtime).oobiQueued, true);
        assertEquals(runtimeOobiConverged(runtime, parentUrl), false);

        yield* runtime.oobiery.processOnce();
        yield* runtime.oobiery.processOnce();
        yield* runtime.oobiery.processOnce();

        assertEquals(hby.db.roobi.get(parentUrl)?.state, "resolved");
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.witness, witnessPre])?.allowed,
          true,
        );
        for (const childUrl of childUrls) {
          assertEquals(hby.db.roobi.get(childUrl)?.state, "resolved");
        }
        assertEquals(
          oobiTerminalState(runtime.hby.db, parentUrl).status,
          "resolved",
        );
        yield* processCuesOnce(runtime);
        assertEquals(runtimeOobiConverged(runtime, parentUrl), true);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

Deno.test("finite bootstrap resumes in-flight/multi/auth work without waiting on unrelated protocol state", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `bootstrap-source-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const target = yield* createHabery({
      name: `bootstrap-target-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const controller = source.makeHab("controller", undefined, { transferable: true });
      const other = source.makeHab("other", undefined, { transferable: true, icount: 2, isith: "2" });
      const protocol = createProtocolProcessor(target);
      const input = new Reactor(protocol);
      yield* input.processBytes(acceptedEventReplayMessage(source, other.pre, 0).message);
      const unrelated = makeReplySerder("/loc/scheme", {
        eid: other.pre,
        scheme: "http",
        url: "http://unrelated.test",
      });
      const group = replySigGroupFor(other, unrelated);
      group.sigers.splice(1);
      yield* input.processBytes(messagize(unrelated, { tsgs: [group] }));
      assertEquals(target.db.rpes.cnt(), 1);
      target.db.dune.pin([other.pre, "0"], acceptedEventReplayMessage(source, other.pre, 0).serder);
      const historical = `http://history.test/oobi/${other.pre}/controller`;
      target.db.eoobi.pin(historical, { state: "http-404" });

      const parent = `http://bootstrap.test/oobi/${controller.pre}/controller?parent`;
      const child = `http://bootstrap.test/oobi/${controller.pre}/controller?a-proof`;
      const kel = `http://bootstrap.test/oobi/${controller.pre}/controller?b-kel`;
      const location = "http://controller.test";
      const proof = controller.makeLocScheme(location, controller.pre, "http");
      const auth = `http://bootstrap.test/.well-known/keri/oobi/${controller.pre}`;
      target.db.moobi.pin(parent, { cid: controller.pre, urls: [child, kel, auth], state: "pending-multi-oobi" });
      target.db.oobis.pin(child, { cid: controller.pre, state: "queued" });
      target.db.coobi.pin(kel, { cid: controller.pre, state: "streaming" });
      target.db.mfa.pin(auth, { cid: controller.pre, state: "auth-pending" });
      const requested: string[] = [];
      const http = httpClient(async url => {
        requested.push(url);
        let body: Uint8Array<ArrayBuffer> | null = null;
        if (url === child) body = new Uint8Array(proof);
        else if (url === kel) {
          // Ensure reply escrow is replayed while the signer's KEL is missing.
          await new Promise(resolve => setTimeout(resolve, 25));
          body = new Uint8Array(acceptedEventReplayMessage(source, controller.pre, 0).message);
        }
        return new Response(body, { headers: { "Content-Type": "application/cesr" } });
      });
      assertEquals(yield* resolveBootstrap(target, http, { timeoutMs: 2_000 }), { kind: "complete" });
      assertEquals(new Set(requested), new Set([child, kel, auth]));
      assertExists(target.db.getKever(controller.pre));
      assertEquals(target.db.roobi.get(parent)?.state, "resolved");
      protocol.processKelReplyEscrowsOnce();
      assertEquals(target.db.locs.get([controller.pre, "http"])?.url, location);
      assertEquals(hasWellKnownAuth(target.db, auth), true);
      assertEquals(target.db.rpes.cnt(), 1, "the unrelated partial reply still needs its own second signature");
      assertEquals(target.db.dune.cnt(), 1);
      assertEquals(target.db.eoobi.get(historical)?.state, "http-404");

      // KERIpy also permits a well-known URL in the introduction queue.
      // An old auth refusal must not replace this ordinary fetch's own result.
      target.db.oobis.pin(auth, { cid: controller.pre, state: "queued" });
      target.db.rmfa.pin(auth, { cid: controller.pre, state: "http-403" });
      assertEquals(
        yield* resolveBootstrap(
          target,
          httpClient(() =>
            new Response(
              new Uint8Array(acceptedEventReplayMessage(source, controller.pre, 0).message),
              { headers: { "Content-Type": "application/cesr" } },
            )
          ),
        ),
        { kind: "complete" },
      );
      assertEquals(target.db.roobi.get(auth)?.state, "resolved");

      target.db.oobis.pin(auth, { cid: controller.pre, state: "queued" });
      target.db.woobi.pin(auth, { cid: controller.pre, state: "queued" });
      assertEquals(
        yield* resolveBootstrap(
          target,
          httpClient(() =>
            new Response(new Uint8Array(acceptedEventReplayMessage(source, controller.pre, 0).message), {
              headers: { "Content-Type": "application/cesr" },
            })
          ),
        ),
        { kind: "complete" },
      );
      assertEquals(target.db.roobi.get(auth)?.state, "resolved");
      assertEquals(target.db.rmfa.get(auth)?.state, "resolved");
      target.db.woobi.pin(auth, { cid: controller.pre, state: "queued" });
      assertEquals(
        yield* resolveBootstrap(target, httpClient(() => new Response(null, { status: 403 }))),
        {
          kind: "failed",
          failures: [{ url: auth, state: "http-403" }],
        },
      );
      assertEquals(
        hasWellKnownAuth(target.db, auth),
        true,
        "historical authorization remains, but cannot mask this refusal",
      );

      target.db.oobis.pin(child, { cid: controller.pre, state: "queued" });
      target.db.eoobi.pin(child, { state: "http-404" });
      assertEquals(yield* resolveBootstrap(target, http), { kind: "complete" });
      assertEquals(target.db.roobi.get(child)?.state, "resolved");
    } finally {
      yield* target.close();
      yield* source.close();
    }
  });
});

Deno.test("finite bootstrap resolves a response while its reply proof awaits protocol acceptance", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `bootstrap-proof-source-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const target = yield* createHabery({
      name: `bootstrap-proof-target-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const controller = source.makeHab("controller", undefined, { transferable: true, icount: 2, isith: "2" });
      const url = `http://bootstrap.test/oobi/${controller.pre}/controller`;
      const reply = makeReplySerder("/loc/scheme", {
        eid: controller.pre,
        scheme: "http",
        url: "http://controller.test",
      });
      const group = replySigGroupFor(controller, reply);
      group.sigers.splice(1);
      const bytes = concatBytes(
        acceptedEventReplayMessage(source, controller.pre, 0).message,
        messagize(reply, { tsgs: [group] }),
      );
      target.db.oobis.pin(url, { state: "queued" });
      const result = yield* resolveBootstrap(
        target,
        httpClient(() =>
          new Response(new Uint8Array(bytes), {
            headers: { "Content-Type": "application/cesr" },
          })
        ),
        { timeoutMs: 100 },
      );
      assertEquals(result, { kind: "complete" });
      assertExists(target.db.getKever(controller.pre));
      assertEquals(target.db.roobi.get(url)?.state, "resolved");
      assertEquals(target.db.rpes.cnt(), 1);
      assertEquals(target.db.locs.get([controller.pre, "http"]), null);

      // An older partial proof for this SAME identifier is independent of a
      // fresh resolution. Fetching its KEL again must not require that proof.
      target.db.oobis.pin(url, { state: "queued" });
      assertEquals(
        yield* resolveBootstrap(
          target,
          httpClient(() =>
            new Response(new Uint8Array(acceptedEventReplayMessage(source, controller.pre, 0).message), {
              headers: { "Content-Type": "application/cesr" },
            })
          ),
        ),
        { kind: "complete" },
      );
      assertEquals(target.db.rpes.cnt(), 1);
      assertEquals(target.db.locs.get([controller.pre, "http"]), null);

      // The ordinary protocol owner accepts the actual missing contribution.
      const protocol = createProtocolProcessor(target);
      const input = new Reactor(protocol);
      yield* input.processBytes(messagize(reply, { tsgs: [replySigGroupFor(controller, reply)] }));
      protocol.processKelReplyEscrowsOnce();
      assertEquals(target.db.rpes.cnt(), 0);
      assertEquals(target.db.locs.get([controller.pre, "http"])?.url, "http://controller.test");
    } finally {
      yield* target.close();
      yield* source.close();
    }
  });
});

for (const stop of ["deadline", "cancellation"] as const) {
  Deno.test(`finite bootstrap ${stop} joins blocked HTTP cleanup and retains retry ownership`, async () => {
    const hby = await run(() =>
      createHabery({ name: `bootstrap-deadline-${crypto.randomUUID()}`, temp: true, skipConfig: true })
    );
    let release!: () => void, cleaning!: () => void, reading!: () => void;
    const cleanup = new Promise<void>(resolve => release = resolve);
    const receiving = new Promise<void>(resolve => reading = resolve);
    const started = new Promise<void>(resolve => cleaning = resolve);
    const url = "http://bootstrap.test/oobi";
    const signals: AbortSignal[] = [];
    hby.db.oobis.pin(url, { state: "queued" });
    const task = run(() =>
      resolveBootstrap(
        hby,
        httpClient((_url, init) => {
          signals.push(init!.signal!);
          return new Response(
            new ReadableStream({
              pull() {
                reading();
              },
              cancel() {
                cleaning();
                return cleanup;
              },
            }),
            {
              headers: { "Content-Type": "application/cesr" },
            },
          );
        }),
        { timeoutMs: stop === "deadline" ? 25 : 30_000 },
      )
    );
    try {
      await receiving;
      const completion = stop === "cancellation" ? Promise.resolve(task.halt()) : task;
      await started;
      let joined = false;
      void completion.then(() => joined = true, () => joined = true);
      await new Promise(resolve => setTimeout(resolve, 0));
      assertEquals(joined, false, "deadline must join pending response cleanup before returning");
      release();
      const result = await completion;
      if (stop === "deadline") assertEquals(result, { kind: "timeout", pending: [url] });
      assertEquals(signals[0].aborted, true);
      assertEquals(hby.db.oobis.get(url)?.state, "queued");
      assertEquals(hby.db.coobi.get(url), null);
    } finally {
      release();
      await task.halt();
      await run(() => hby.close());
    }
  });
}

Deno.test("finite bootstrap preserves HTTP cleanup failure at its deadline", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `bootstrap-cleanup-failure-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const url = "http://bootstrap.test/oobi";
    const failure = new Error("response cleanup failed");
    hby.db.oobis.pin(url, { state: "queued" });
    try {
      const error = yield* call(() =>
        assertRejects(() =>
          run(() =>
            resolveBootstrap(
              hby,
              httpClient(() => {
                return new Response(
                  new ReadableStream({
                    cancel() {
                      throw failure;
                    },
                  }),
                  {
                    headers: { "Content-Type": "application/cesr" },
                  },
                );
              }),
              { timeoutMs: 25 },
            )
          )
        )
      );
      assertStrictEquals(error, failure);
      assertEquals(hby.db.oobis.get(url)?.state, "queued");
    } finally {
      yield* hby.close();
    }
  });
});
