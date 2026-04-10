// @file-test-lane runtime-slow

import { action, run, spawn } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { Diger, Prefixer, Seqner, SerderKERI } from "../../../../cesr/mod.ts";
import { startServer } from "../../../../tufa/src/host/http-server.ts";
import {
  createAgentRuntime,
  enqueueOobi,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
  runtimeHasWellKnownAuth,
  runtimeOobiConverged,
  runtimeOobiTerminalState,
  runtimePendingState,
} from "../../../src/app/agent-runtime.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { locAddCommand } from "../../../src/app/cli/loc.ts";
import { oobiGenerateCommand, oobiResolveCommand } from "../../../src/app/cli/oobi.ts";
import { createConfiger } from "../../../src/app/configing.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { fetchResponseHandle } from "../../../src/app/httping.ts";
import { readMailboxSseBody } from "../../../src/app/mailbox-sse.ts";
import { isWellKnownOobiUrl, parseOobiUrl } from "../../../src/app/oobiery.ts";
import { queryTransportSink } from "../../../src/app/query-transport.ts";
import { witnessReceiptPost } from "../../../src/app/witnessing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { makeReplySerder } from "../../../src/core/messages.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import { fetchOp, textOp, waitForServer, waitForTaskHalt } from "../../effection-http.ts";
import { reserveTcpPort } from "../../http-test-support.ts";
import { assertOperationThrows, testCLICommand } from "../../utils.ts";

const textDecoder = new TextDecoder();

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

function replySigGroupFor(
  hab: {
    pre: string;
    kever: { sner: TransIdxSigGroup["seqner"]; said: string };
    sign: (ser: Uint8Array) => TransIdxSigGroup["sigers"];
  },
  serder: SerderKERI,
): TransIdxSigGroup {
  return new TransIdxSigGroup(
    new Prefixer({ qb64: hab.pre }),
    hab.kever.sner,
    new Diger({ qb64: hab.kever.said }),
    hab.sign(serder.raw),
  );
}

Deno.test("Gate E - mailbox and agent OOBIs generate and resolve through shared runtime", async () => {
  const sourceName = `gate-e-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-dst-${crypto.randomUUID()}`;
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      const url = `http://127.0.0.1:${port}`;
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.agent, true),
      );
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
      );
      yield* processRuntimeTurn(runtime, { hab });
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
    const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

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
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
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

Deno.test("Gate E - well-known auth converges through rmfa and wkas with honest pending state", async () => {
  const sourceName = `gate-e-auth-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-auth-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-auth-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-auth-dst-${crypto.randomUUID()}`;
  const port = reserveTcpPort();
  const hostUrl = `http://127.0.0.1:${port}`;
  let pre = "";
  let controllerUrl = "";
  let wellKnownUrl = "";
  let failingWellKnownUrl = "";
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
      failingWellKnownUrl = `${hostUrl}/.well-known/keri/oobi/${pre}?mode=fail`;

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(hostUrl, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });

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
        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        enqueueOobi(runtime, { url: controllerUrl });
        enqueueOobi(runtime, { url: wellKnownUrl });

        yield* processRuntimeTurn(runtime);
        assertEquals(hby.db.roobi.get(controllerUrl)?.state, "resolved");
        assertEquals(runtimePendingState(runtime).authQueued, false);
        assertEquals(runtimePendingState(runtime).authInFlight, true);
        assertEquals(runtimeOobiConverged(runtime, wellKnownUrl), false);

        yield* processRuntimeTurn(runtime);
        assertEquals(hby.db.rmfa.get(wellKnownUrl)?.state, "resolved");
        assertEquals(runtimeHasWellKnownAuth(runtime, wellKnownUrl), true);
        assertEquals(
          runtimeOobiTerminalState(runtime, wellKnownUrl).status,
          "resolved",
        );
        assertEquals(runtimeOobiConverged(runtime, wellKnownUrl), true);

        enqueueOobi(runtime, { url: failingWellKnownUrl });
        yield* processRuntimeTurn(runtime);
        assertEquals(runtimePendingState(runtime).authInFlight, true);
        yield* processRuntimeTurn(runtime);
        assertEquals(hby.db.rmfa.get(failingWellKnownUrl)?.state, "http-404");
        assertEquals(
          runtimeOobiTerminalState(runtime, failingWellKnownUrl).status,
          "failed",
        );
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

Deno.test("Gate E - controller and witness OOBIs generate and resolve through shared runtime", async () => {
  const sourceName = `gate-e-controller-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-controller-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-controller-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-controller-dst-${crypto.randomUUID()}`;
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        witnessHab.makeLocScheme(url, witnessHab.pre, "http"),
      );
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });
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
    const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

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
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
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

Deno.test("Gate E - config preload bootstrap URLs resolve through shared runtime queues", async () => {
  const sourceName = `gate-e-config-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-config-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-config-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-config-dst-${crypto.randomUUID()}`;
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      for (const hab of [iHab, dHab]) {
        ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
        ingestKeriBytes(
          runtime,
          hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        );
      }
      yield* processRuntimeTurn(runtime, { hab: iHab });
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
    const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      const target = yield* createHabery({
        name: targetName,
        headDirPath: targetHeadDirPath,
        skipSignator: true,
      });
      try {
        const targetRuntime = yield* createAgentRuntime(target, {
          mode: "local",
        });
        for (let i = 0; i < 6; i += 1) {
          yield* processRuntimeTurn(targetRuntime);
        }

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
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* hby.close();
    }
  });
});

Deno.test("Gate E - init command waits for configured well-known auth before exit", async () => {
  const sourceName = `gate-e-init-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-init-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-init-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-init-dst-${crypto.randomUUID()}`;
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(hostUrl, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });

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

Deno.test("Gate E - incept command waits for configured well-known auth before inception", async () => {
  const sourceName = `gate-e-incept-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-incept-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-incept-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-incept-dst-${crypto.randomUUID()}`;
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(hostUrl, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });

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

Deno.test("Gate E - reply-based `/oobi/controller` JSON fans out child OOBIs through moobi", async () => {
  const sourceName = `gate-e-multi-controller-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-multi-controller-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-multi-controller-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-multi-controller-dst-${crypto.randomUUID()}`;
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(hostUrl, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });

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
        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        enqueueOobi(runtime, { url: parentUrl });

        yield* processRuntimeTurn(runtime);
        assertEquals(hby.db.moobi.get(parentUrl)?.state, "pending-multi-oobi");
        assertEquals(runtimePendingState(runtime).multiPending, true);
        assertEquals(runtimePendingState(runtime).oobiQueued, true);
        assertEquals(runtimeOobiConverged(runtime, parentUrl), false);

        yield* processRuntimeTurn(runtime);
        yield* processRuntimeTurn(runtime);
        assertEquals(runtimePendingState(runtime).multiPending, true);
        assertEquals(runtimeOobiConverged(runtime, parentUrl), false);

        yield* processRuntimeTurn(runtime);
        assertEquals(hby.db.moobi.get(parentUrl), null);
        assertEquals(hby.db.roobi.get(parentUrl)?.state, "resolved");
        for (const childUrl of childUrls) {
          assertEquals(hby.db.roobi.get(childUrl)?.state, "resolved");
        }
        assertEquals(
          runtimeOobiTerminalState(runtime, parentUrl).status,
          "resolved",
        );
        assertEquals(runtimeOobiConverged(runtime, parentUrl), true);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

Deno.test("Gate E - reply-based `/oobi/witness` JSON fans out child OOBIs through moobi", async () => {
  const sourceName = `gate-e-multi-witness-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-multi-witness-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-multi-witness-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-multi-witness-dst-${crypto.randomUUID()}`;
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(hostUrl, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        witnessHab.makeLocScheme(hostUrl, witnessHab.pre, "http"),
      );
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });

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
        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        enqueueOobi(runtime, { url: parentUrl });

        yield* processRuntimeTurn(runtime);
        assertEquals(hby.db.moobi.get(parentUrl)?.state, "pending-multi-oobi");
        assertEquals(runtimePendingState(runtime).multiPending, true);
        assertEquals(runtimePendingState(runtime).oobiQueued, true);
        assertEquals(runtimeOobiConverged(runtime, parentUrl), false);

        yield* processRuntimeTurn(runtime);
        yield* processRuntimeTurn(runtime);
        yield* processRuntimeTurn(runtime);

        assertEquals(hby.db.roobi.get(parentUrl)?.state, "resolved");
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.witness, witnessPre])?.allowed,
          true,
        );
        for (const childUrl of childUrls) {
          assertEquals(hby.db.roobi.get(childUrl)?.state, "resolved");
        }
        assertEquals(
          runtimeOobiTerminalState(runtime, parentUrl).status,
          "resolved",
        );
        assertEquals(runtimeOobiConverged(runtime, parentUrl), true);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

Deno.test("Gate E - tufa agent host stays protocol-only", async () => {
  const name = `gate-e-protocol-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-gate-e-protocol-${crypto.randomUUID()}`;
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });
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
    const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
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

Deno.test("Gate E - mailbox host returns 204 for posted `logs`/`ksn` and streams `/reply` and `/replay` only through `mbx`", async () => {
  const name = `gate-e-mailbox-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-gate-e-mailbox-${crypto.randomUUID()}`;
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(baseUrl, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
      );
      yield* processRuntimeTurn(runtime, {
        hab,
        sink: runtime.respondant.forHab(hab),
      });
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
    const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, {
        hab: hab ?? undefined,
        sink: runtime.respondant.forHab(hab),
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

      const ksnQuery = hab.query(hab.pre, hab.pre, {}, "ksn");
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
        { topics: { "/reply": 0 } },
        "mbx",
      );
      const { response: streamed, controller } = yield* fetchResponseHandle(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: textDecoder.decode(mailboxQuery),
      });
      assertEquals(streamed.status, 200);
      const body = yield* readMailboxSseBody(streamed, controller, {
        idleTimeoutMs: 500,
        maxDurationMs: 5_000,
      });
      assertStringIncludes(body, "event: /reply");
      assertStringIncludes(body, `/ksn/${hab.pre}`);

      const logsQuery = hab.query(hab.pre, hab.pre, { s: "0", fn: "0" }, "logs");
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
        { topics: { "/replay": 0 } },
        "mbx",
      );
      const { response: replayStream, controller: replayController } = yield* fetchResponseHandle(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: textDecoder.decode(replayQuery),
      });
      assertEquals(replayStream.status, 200);
      const replayBody = yield* readMailboxSseBody(replayStream, replayController, {
        idleTimeoutMs: 500,
        maxDurationMs: 5_000,
      });
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

Deno.test("Gate E - witness anchor logs queries forward `/replay` to a separate relay mailbox", async () => {
  const witnessPort = reserveTcpPort();
  const relayPort = reserveTcpPort();
  const witnessUrl = `http://127.0.0.1:${witnessPort}`;
  const relayUrl = `http://127.0.0.1:${relayPort}`;

  await run(function*() {
    const proxyHby = yield* createHabery({
      name: `gate-e-proxy-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const witnessHby = yield* createHabery({
      name: `gate-e-witness-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const relayHby = yield* createHabery({
      name: `gate-e-relay-${crypto.randomUUID()}`,
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

    const proxyRuntime = yield* createAgentRuntime(proxyHby, { mode: "local" });
    const witnessRuntime = yield* createAgentRuntime(witnessHby, {
      mode: "indirect",
    });
    const relayRuntime = yield* createAgentRuntime(relayHby, {
      mode: "indirect",
    });

    const witnessSink = witnessRuntime.respondant.forHab(witness);
    const relaySink = relayRuntime.respondant.forHab(relay);
    const witnessRuntimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(witnessRuntime, { hab: witness, sink: witnessSink });
    });
    const relayRuntimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(relayRuntime, { hab: relay, sink: relaySink });
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
        ingestKeriBytes(proxyRuntime, msg);
      }
      ingestKeriBytes(proxyRuntime, proxyMailboxAuth);
      ingestKeriBytes(proxyRuntime, relayLoc);
      ingestKeriBytes(proxyRuntime, witnessLoc);
      yield* processRuntimeTurn(proxyRuntime, { hab: proxy, pollMailbox: false });

      for (const msg of proxyHby.db.clonePreIter(proxy.pre)) {
        ingestKeriBytes(relayRuntime, msg);
      }
      ingestKeriBytes(relayRuntime, proxyMailboxAuth);
      ingestKeriBytes(relayRuntime, relayLoc);
      ingestKeriBytes(
        relayRuntime,
        relay.makeEndRole(relay.pre, EndpointRoles.controller, true),
      );
      ingestKeriBytes(
        relayRuntime,
        relay.makeEndRole(relay.pre, EndpointRoles.mailbox, true),
      );
      yield* processRuntimeTurn(relayRuntime, { hab: relay, sink: relaySink, pollMailbox: false });

      yield* waitForServer(witnessPort);
      yield* waitForServer(relayPort);

      const query = proxy.query(
        delegator.pre,
        witness.pre,
        { fn: "0", s: "0", a: seal },
        "logs",
      );
      const sink = queryTransportSink(proxyRuntime, proxyHby, proxy);
      yield* sink.send({
        kind: "wire",
        cue: {
          kin: "query",
          pre: delegator.pre,
          src: witness.pre,
          route: "logs",
          query: { fn: "0", s: "0", a: seal },
          wits: [witness.pre],
        },
        msgs: [query],
      });

      assertExists(witnessRuntime.hby.db.getKever(proxy.pre));
      assertExists(
        witnessRuntime.hby.db.ends.get([proxy.pre, EndpointRoles.mailbox, relay.pre]),
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
        { topics: { "/replay": 0 } },
        "mbx",
      );
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
      yield* waitForTaskHalt(relayServerTask);
      yield* waitForTaskHalt(witnessServerTask);
      yield* waitForTaskHalt(relayRuntimeTask);
      yield* waitForTaskHalt(witnessRuntimeTask);
      yield* relayRuntime.close();
      yield* witnessRuntime.close();
      yield* proxyRuntime.close();
      yield* relayHby.close(true);
      yield* witnessHby.close(true);
      yield* proxyHby.close(true);
    }
  });
});

Deno.test("Gate E - reopened witness `logs` queries replay remote accepted KEL state via read-through `getKever`", async () => {
  const witnessName = `gate-e-reopen-witness-${crypto.randomUUID()}`;
  const subjectName = `gate-e-reopen-subject-${crypto.randomUUID()}`;
  const requesterName = `gate-e-reopen-requester-${crypto.randomUUID()}`;
  const witnessHeadDirPath = `/tmp/tufa-gate-e-reopen-witness-${crypto.randomUUID()}`;
  const subjectHeadDirPath = `/tmp/tufa-gate-e-reopen-subject-${crypto.randomUUID()}`;
  const requesterHeadDirPath = `/tmp/tufa-gate-e-reopen-requester-${crypto.randomUUID()}`;
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
        requester.query(subject.pre, requester.pre, { fn: "0", s: "0" }, "logs"),
      );

      const runtime = yield* createAgentRuntime(witnessHby, { mode: "indirect" });
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

      const runtime = yield* createAgentRuntime(witnessHby, { mode: "indirect" });
      const emissions: Array<{ kind: string; kin: string; msgs: number; dest: string | null }> = [];
      try {
        ingestKeriBytes(runtime, queryBytes);
        yield* processRuntimeTurn(runtime, {
          hab: witness,
          pollMailbox: false,
          sink: {
            *send(emission) {
              emissions.push({
                kind: emission.kind,
                kin: emission.cue.kin,
                msgs: emission.msgs.length,
                dest: emission.cue.kin === "replay" ? emission.cue.dest ?? null : null,
              });
            },
          },
        });

        assertEquals(
          emissions.some((emission) =>
            emission.kind === "wire"
            && emission.kin === "replay"
            && emission.msgs > 0
          ),
          true,
        );
        assertEquals(witnessHby.db.kevers.has(subjectPre), true);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* witnessHby.close(true);
    }
  });
});
