/**
 * Mailbox runtime end-to-end unit scenarios.
 *
 * These tests exercise the mailbox stack as a cooperating runtime slice rather
 * than as isolated helpers:
 * - mailbox add/list/update/debug command flows
 * - base-path-relative mailbox and OOBI hosting
 * - mailbox-polled challenge verification
 * - `/fwd` authorization before provider-side storage
 */
import { type Operation, run, spawn } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { concatBytes } from "../../../../cesr/mod.ts";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
} from "../../../src/app/agent-runtime.ts";
import { agentCommand } from "../../../src/app/cli/agent.ts";
import {
  challengeRespondCommand,
  challengeVerifyCommand,
} from "../../../src/app/cli/challenge.ts";
import { setupHby } from "../../../src/app/cli/common/existing.ts";
import { createConfiger } from "../../../src/app/configing.ts";
import {
  mailboxAddCommand,
  mailboxDebugCommand,
  mailboxListCommand,
  mailboxRemoveCommand,
  mailboxStartCommand,
  mailboxUpdateCommand,
} from "../../../src/app/cli/mailbox.ts";
import {
  oobiGenerateCommand,
  oobiResolveCommand,
} from "../../../src/app/cli/oobi.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { startServer } from "../../../src/app/server.ts";
import {
  makeEmbeddedExchangeMessage,
  makeExchangeSerder,
} from "../../../src/core/messages.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import {
  fetchOp,
  textOp,
  waitForServer,
  waitForTaskHalt,
} from "../../effection-http.ts";
import { CLITestHarness, testCLICommand } from "../../utils.ts";

/** Return a random localhost port for ephemeral mailbox and OOBI hosts. */
function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

/**
 * Start a minimal static OOBI host used by the mailbox tests.
 *
 * This deliberately avoids the full runtime host so the tests can control the
 * exact controller OOBI bytes served from the remote endpoint.
 */
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

/**
 * Seed one non-transferable mailbox provider habitat with location and end-role
 * state.
 */
async function seedMailboxHost(
  name: string,
  headDirPath: string,
  alias: string,
  url: string,
): Promise<string> {
  let pre = "";

  await run(function* () {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      pre = hab.pre;
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
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

  return pre;
}

/**
 * Seed one hosted transferable controller and capture its controller OOBI
 * response bytes for later static serving.
 */
async function seedHostedController(
  name: string,
  headDirPath: string,
  alias: string,
  url: string,
): Promise<{ pre: string; controllerBytes: Uint8Array }> {
  let pre = "";
  let controllerBytes = new Uint8Array();

  await run(function* () {
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
      controllerBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.controller),
      );
    } finally {
      yield* hby.close();
    }
  });

  return { pre, controllerBytes };
}

/** Seed one local transferable controller used as a mailbox client in tests. */
async function seedLocalController(
  name: string,
  headDirPath: string,
  alias: string,
): Promise<string> {
  let pre = "";

  await run(function* () {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      pre = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
    } finally {
      yield* hby.close();
    }
  });

  return pre;
}

/**
 * Build one `/fwd` message carrying an embedded `/challenge/response` payload.
 *
 * The authorization test uses this helper to exercise mailbox storage without
 * depending on the higher-level challenge CLI path.
 */
function* buildForwardMessage(
  senderName: string,
  senderHeadDirPath: string,
  recipientPre: string,
): Operation<Uint8Array> {
  const hby = yield* createHabery({
    name: senderName,
    headDirPath: senderHeadDirPath,
    skipConfig: true,
  });

  try {
    let sender = hby.habByName("sender");
    if (!sender) {
      sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
    }

    const embedded = sender.endorse(
      makeExchangeSerder("/challenge/response", {
        i: sender.pre,
        words: ["able", "baker"],
      }, {
        sender: sender.pre,
        recipient: recipientPre,
      }),
    );
    const wrapped = makeEmbeddedExchangeMessage("/fwd", {}, {
      sender: sender.pre,
      modifiers: { pre: recipientPre, topic: "challenge" },
      embeds: { evt: embedded },
    });
    return concatBytes(
      sender.replyEndRole(sender.pre),
      sender.endorse(wrapped.serder),
      wrapped.attachments,
    );
  } finally {
    yield* hby.close();
  }
}

/** Post one raw CESR mailbox-forwarding request and return the HTTP status. */
function* postForward(url: string, body: Uint8Array): Operation<number> {
  const response = yield* fetchOp(url, {
    method: "POST",
    headers: { "Content-Type": "application/cesr" },
    body: new TextDecoder().decode(body),
  });
  return response.status;
}

Deno.test("mailbox start provisions a mailbox from config and serves base-path routes", async () => {
  const name = `mailbox-start-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-mailbox-start-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}/relay`;
  const configPath = `${headDirPath}/mailbox-start.json`;
  Deno.mkdirSync(headDirPath, { recursive: true });
  Deno.writeTextFileSync(
    configPath,
    JSON.stringify({
      relay: {
        dt: "2026-04-06T12:00:00.000Z",
        curls: [url],
      },
    }),
  );

  await run(function* (): Operation<void> {
    const harness = new CLITestHarness();
    harness.captureOutput();
    const serverTask = yield* spawn(function* () {
      yield* mailboxStartCommand({
        name,
        alias: "relay",
        headDirPath,
        configFile: configPath,
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });

    try {
      const prefixLine = harness.getOutput().find((line) =>
        line.startsWith("Mailbox Prefix")
      );
      assertEquals(!!prefixLine, true);
      const pre = prefixLine!.split(/\s+/).at(-1)!;

      const rootOobi = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${pre}/mailbox/${pre}`,
      );
      assertEquals(rootOobi.status, 200);
      yield* textOp(rootOobi);

      const hostedOobi = yield* fetchOp(`${url}/oobi/${pre}/mailbox/${pre}`);
      assertEquals(hostedOobi.status, 200);
      yield* textOp(hostedOobi);

      const admin = yield* fetchOp(`${url}/mailboxes`, {
        method: "POST",
        body: new FormData(),
      });
      assertEquals(admin.status, 400);
      yield* textOp(admin);
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
      harness.restoreOutput();
    }

    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const hab = [...hby.habs.values()].find((current) =>
        current.name === "relay"
      );
      assertEquals(!!hab, true);
      const pre = hab!.pre;
      assertEquals(hab!.kever?.transferable, false);
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.controller, pre])?.allowed,
        true,
      );
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.mailbox, pre])?.allowed,
        true,
      );
      assertEquals(hab!.fetchUrls(pre, "http").http, url);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("agent command uses explicit config-file controller curls and does not synthesize agent role", async () => {
  const name = `agent-config-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-agent-${crypto.randomUUID()}`;
  const configDir = `/tmp/tufa-agent-config-${crypto.randomUUID()}`;
  const configFile = "agent-start";
  const port = randomPort();
  const configuredUrl = `http://localhost:${port}`;
  let pre = "";

  await run(function* () {
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
      pre = hab.pre;
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.controller, pre]),
        null,
      );
    } finally {
      yield* hby.close();
    }
  });

  await run(function* () {
    const cf = yield* createConfiger({
      name: configFile,
      headDirPath: configDir,
      temp: false,
    });
    try {
      cf.put({
        alice: {
          dt: "2026-04-06T14:00:00.000Z",
          curls: [configuredUrl],
        },
      });
    } finally {
      yield* cf.close();
    }
  });

  await run(function* (): Operation<void> {
    const serverTask = yield* spawn(function* () {
      yield* agentCommand({
        name,
        headDirPath,
        configDir,
        configFile,
        port,
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });

    try {
      const hosted = yield* fetchOp(`${configuredUrl}/oobi/${pre}/controller`);
      assertEquals(hosted.status, 200);
      yield* textOp(hosted);

      const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
        readonly: true,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        const hab = hby.habByName("alice");
        assertEquals(hab?.fetchUrls(pre, "http").http, configuredUrl);
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.controller, pre])?.allowed,
          true,
        );
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.agent, pre]),
          null,
        );
      } finally {
        yield* hby.close();
      }
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});

Deno.test("agent command falls back to synthesized controller state only when config is absent", async () => {
  const name = `agent-fallback-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-agent-${crypto.randomUUID()}`;
  const port = randomPort();
  const fallbackUrl = `http://127.0.0.1:${port}`;
  let pre = "";

  await run(function* () {
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
      pre = hab.pre;
    } finally {
      yield* hby.close();
    }
  });

  await run(function* (): Operation<void> {
    const serverTask = yield* spawn(function* () {
      yield* agentCommand({
        name,
        headDirPath,
        port,
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });

    try {
      const hosted = yield* fetchOp(`${fallbackUrl}/oobi/${pre}/controller`);
      assertEquals(hosted.status, 200);
      yield* textOp(hosted);

      const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
        readonly: true,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        const hab = hby.habByName("alice");
        assertEquals(hab?.fetchUrls(pre, "http").http, fallbackUrl);
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.controller, pre])?.allowed,
          true,
        );
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.agent, pre]),
          null,
        );
      } finally {
        yield* hby.close();
      }
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});

Deno.test("mailbox start on a multi-AID keystore serves only the selected local mailbox alias", async () => {
  const name = `mailbox-start-multi-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-mailbox-start-multi-${crypto.randomUUID()}`;
  const port = randomPort();
  const startupUrl = `http://127.0.0.1:${port}`;
  let otherPre = "";

  await run(function* () {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      otherPre = hby.makeHab("other", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
    } finally {
      yield* hby.close();
    }
  });

  await run(function* (): Operation<void> {
    const harness = new CLITestHarness();
    harness.captureOutput();
    const serverTask = yield* spawn(function* () {
      yield* mailboxStartCommand({
        name,
        alias: "relay",
        headDirPath,
        url: startupUrl,
        datetime: "2026-04-06T13:00:00.000Z",
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });

    try {
      const prefixLine = harness.getOutput().find((line) =>
        line.startsWith("Mailbox Prefix")
      );
      assertEquals(!!prefixLine, true);
      const relayPre = prefixLine!.split(/\s+/).at(-1)!;

      const selected = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${relayPre}/mailbox/${relayPre}`,
      );
      assertEquals(selected.status, 200);
      yield* textOp(selected);

      const unrelated = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${otherPre}/controller`,
      );
      assertEquals(unrelated.status, 404);
      yield* textOp(unrelated);
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
      harness.restoreOutput();
    }
  });
});

/**
 * Proves the full local mailbox operator workflow against a live remote mailbox
 * host:
 * - resolve mailbox OOBI
 * - add mailbox
 * - list and debug mailbox state
 * - update topic cursor state
 * - remove mailbox
 */
Deno.test("mailbox CLI add/remove/list/update/debug round-trips against remote mailbox host", async () => {
  const providerName = `mailbox-provider-${crypto.randomUUID()}`;
  const clientName = `mailbox-client-${crypto.randomUUID()}`;
  const providerHeadDirPath =
    `/tmp/tufa-mailbox-provider-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-client-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}`;
  const providerPre = await seedMailboxHost(
    providerName,
    providerHeadDirPath,
    "mbx",
    url,
  );
  const clientPre = await seedLocalController(
    clientName,
    clientHeadDirPath,
    "alice",
  );

  await run(function* () {
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
    });
    const hab = providerHby.habByName("mbx");
    const runtime = yield* createAgentRuntime(providerHby, {
      mode: "indirect",
    });
    const mailboxer = runtime.mailboxer;
    if (!mailboxer) {
      throw new Error("Expected provider runtime mailboxer.");
    }
    const runtimeTask = yield* spawn(function* () {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function* () {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      const resolved = yield* testCLICommand(
        oobiResolveCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          url: `${url}/oobi/${providerPre}/mailbox/${providerPre}`,
          oobiAlias: "mbx",
        }),
      );
      assertEquals(
        resolved.output.at(-1),
        `${url}/oobi/${providerPre}/mailbox/${providerPre}`,
      );

      const added = yield* testCLICommand(
        mailboxAddCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          mailbox: "mbx",
        }),
      );
      assertEquals(added.output.at(-1), `added ${providerPre}`);

      mailboxer.storeMsg(
        mailboxTopicKey(clientPre, "/challenge"),
        new TextEncoder().encode("challenge-msg"),
      );

      const listed = yield* testCLICommand(
        mailboxListCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
        }),
      );
      assertStringIncludes(listed.output.join("\n"), providerPre);

      const updated = yield* testCLICommand(
        mailboxUpdateCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          witness: providerPre,
          topic: "/challenge",
          index: 5,
        }),
      );
      assertEquals(updated.output.at(-1), `${providerPre} /challenge 5`);

      const debugged = yield* testCLICommand(
        mailboxDebugCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          witness: providerPre,
        }),
      );
      assertStringIncludes(debugged.output.join("\n"), "Configured Mailboxes");
      assertStringIncludes(debugged.output.join("\n"), "/challenge");

      const removed = yield* testCLICommand(
        mailboxRemoveCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          mailbox: providerPre,
        }),
      );
      assertEquals(removed.output.at(-1), `removed ${providerPre}`);
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* providerHby.close();
    }
  });

  await run(function* () {
    const clientHby = yield* createHabery({
      name: clientName,
      headDirPath: clientHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });

    try {
      assertEquals(
        clientHby.db.ends.get([clientPre, EndpointRoles.mailbox, providerPre])
          ?.allowed,
        false,
      );
      assertEquals(
        providerHby.db.ends.get([clientPre, EndpointRoles.mailbox, providerPre])
          ?.allowed,
        false,
      );
      assertEquals(
        clientHby.db.tops.get([clientPre, providerPre])?.topics["/challenge"],
        5,
      );
    } finally {
      yield* providerHby.close();
      yield* clientHby.close();
    }
  });
});

/**
 * Proves that `challenge verify` is mailbox-driven, not just local DB polling,
 * and that provider routes work beneath a non-root base path.
 */
Deno.test("challenge verify polls a remote mailbox provider through base-path OOBI and mailbox admin routes", async () => {
  const providerName = `mailbox-base-provider-${crypto.randomUUID()}`;
  const bobName = `mailbox-base-bob-${crypto.randomUUID()}`;
  const aliceName = `mailbox-base-alice-${crypto.randomUUID()}`;
  const providerHeadDirPath =
    `/tmp/tufa-mailbox-base-provider-${crypto.randomUUID()}`;
  const bobHeadDirPath = `/tmp/tufa-mailbox-base-bob-${crypto.randomUUID()}`;
  const aliceHeadDirPath =
    `/tmp/tufa-mailbox-base-alice-${crypto.randomUUID()}`;
  const port = randomPort();
  const alicePort = randomPort();
  const providerUrl = `http://127.0.0.1:${port}/relay`;
  const aliceUrl = `http://127.0.0.1:${alicePort}`;
  const words = ["able", "baker", "charlie"];
  const providerPre = await seedMailboxHost(
    providerName,
    providerHeadDirPath,
    "mbx",
    providerUrl,
  );
  const bobPre = await seedLocalController(
    bobName,
    bobHeadDirPath,
    "bob",
  );
  const alice = await seedHostedController(
    aliceName,
    aliceHeadDirPath,
    "alice",
    aliceUrl,
  );
  const aliceHost = startStaticOobiHost(alicePort, (_request, url) => {
    if (url.pathname === `/oobi/${alice.pre}/controller`) {
      return new Response(new Uint8Array(alice.controllerBytes).buffer, {
        status: 200,
        headers: { "Content-Type": "application/cesr", "Oobi-Aid": alice.pre },
      });
    }
    return new Response("Not Found", { status: 404 });
  });

  try {
    await run(function* () {
      const providerHby = yield* createHabery({
        name: providerName,
        headDirPath: providerHeadDirPath,
        skipConfig: true,
      });
      const hab = providerHby.habByName("mbx");
      const runtime = yield* createAgentRuntime(providerHby, {
        mode: "indirect",
      });
      const mailboxer = runtime.mailboxer;
      if (!mailboxer) {
        throw new Error("Expected provider runtime mailboxer.");
      }
      const runtimeTask = yield* spawn(function* () {
        yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
      });
      const serverTask = yield* spawn(function* () {
        yield* startServer(port, undefined, runtime);
      });

      try {
        yield* waitForServer(port);
        yield* waitForServer(alicePort);

        const providerResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            url: `${providerUrl}/oobi/${providerPre}/controller`,
            oobiAlias: "mbx",
          }),
        );
        assertEquals(
          providerResolved.output.at(-1),
          `${providerUrl}/oobi/${providerPre}/controller`,
        );

        const aliceResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            url: `${aliceUrl}/oobi/${alice.pre}/controller`,
            oobiAlias: "alice",
          }),
        );
        assertEquals(
          aliceResolved.output.at(-1),
          `${aliceUrl}/oobi/${alice.pre}/controller`,
        );

        const added = yield* testCLICommand(
          mailboxAddCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            alias: "bob",
            mailbox: providerPre,
          }),
        );
        assertEquals(added.output.at(-1), `added ${providerPre}`);

        const mailboxOobi = yield* testCLICommand(
          oobiGenerateCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            alias: "bob",
            role: "mailbox",
          }),
        );
        assertEquals(
          mailboxOobi.output.at(-1),
          `${providerUrl}/oobi/${bobPre}/mailbox/${providerPre}`,
        );

        const bobResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: aliceName,
            headDirPath: aliceHeadDirPath,
            url: `${providerUrl}/oobi/${bobPre}/mailbox/${providerPre}`,
            oobiAlias: "bob",
          }),
        );
        assertEquals(
          bobResolved.output.at(-1),
          `${providerUrl}/oobi/${bobPre}/mailbox/${providerPre}`,
        );

        const responded = yield* testCLICommand(
          challengeRespondCommand({
            name: aliceName,
            headDirPath: aliceHeadDirPath,
            alias: "alice",
            recipient: bobPre,
            words: JSON.stringify(words),
            transport: "indirect",
          }),
        );
        assertEquals(responded.output[0], "Sent EXN message");
        assertEquals(
          mailboxer.getTopicMsgs(mailboxTopicKey(bobPre, "/challenge"))
            .length > 0,
          true,
        );

        const verified = yield* testCLICommand(
          challengeVerifyCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            signer: alice.pre,
            words: JSON.stringify(words),
            timeout: 5,
          }),
        );
        assertStringIncludes(verified.output.at(-1) ?? "", alice.pre);
      } finally {
        yield* waitForTaskHalt(serverTask);
        yield* waitForTaskHalt(runtimeTask);
        yield* runtime.close();
        yield* providerHby.close();
      }
    });

    await run(function* () {
      const bobHby = yield* createHabery({
        name: bobName,
        headDirPath: bobHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertEquals(bobHby.db.reps.get([alice.pre]).length > 0, true);
        assertEquals(bobHby.db.chas.get([alice.pre]).length > 0, true);
        assertEquals(
          bobHby.db.ends.get([bobPre, EndpointRoles.mailbox, providerPre])
            ?.allowed,
          true,
        );
      } finally {
        yield* bobHby.close();
      }
    });
  } finally {
    await aliceHost.close();
  }
});

/**
 * Proves the inbound mailbox authorization boundary on `/fwd`.
 *
 * A mailbox host must not store forwarded traffic until the recipient has
 * authorized that mailbox provider.
 */
Deno.test("mailbox host only stores forwarded payloads after mailbox authorization", async () => {
  const providerName = `mailbox-auth-provider-${crypto.randomUUID()}`;
  const senderName = `mailbox-auth-sender-${crypto.randomUUID()}`;
  const clientName = `mailbox-auth-client-${crypto.randomUUID()}`;
  const providerHeadDirPath =
    `/tmp/tufa-mailbox-auth-provider-${crypto.randomUUID()}`;
  const senderHeadDirPath =
    `/tmp/tufa-mailbox-auth-sender-${crypto.randomUUID()}`;
  const clientHeadDirPath =
    `/tmp/tufa-mailbox-auth-client-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}`;
  const providerPre = await seedMailboxHost(
    providerName,
    providerHeadDirPath,
    "mbx",
    url,
  );
  const recipientPre = await seedLocalController(
    clientName,
    clientHeadDirPath,
    "alice",
  );

  await run(function* () {
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
    });
    const hab = providerHby.habByName("mbx");
    const runtime = yield* createAgentRuntime(providerHby, {
      mode: "indirect",
    });
    const mailboxer = runtime.mailboxer;
    if (!mailboxer) {
      throw new Error("Expected provider runtime mailboxer.");
    }
    const runtimeTask = yield* spawn(function* () {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function* () {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      const unauthorized = yield* buildForwardMessage(
        senderName,
        senderHeadDirPath,
        recipientPre,
      );
      const first = yield* postForward(url, unauthorized);
      assertEquals(first, 204);
      assertEquals(
        mailboxer.getTopicMsgs(
          mailboxTopicKey(recipientPre, "/challenge"),
        ).length,
        0,
      );

      const resolved = yield* testCLICommand(
        oobiResolveCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          url: `${url}/oobi/${providerPre}/mailbox/${providerPre}`,
          oobiAlias: "mbx",
        }),
      );
      assertEquals(
        resolved.output.at(-1),
        `${url}/oobi/${providerPre}/mailbox/${providerPre}`,
      );

      const added = yield* testCLICommand(
        mailboxAddCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          mailbox: providerPre,
        }),
      );
      assertEquals(added.output.at(-1), `added ${providerPre}`);

      const authorized = yield* buildForwardMessage(
        senderName,
        senderHeadDirPath,
        recipientPre,
      );
      const second = yield* postForward(url, authorized);
      assertEquals(second, 204);
      assertEquals(
        mailboxer.getTopicMsgs(
          mailboxTopicKey(recipientPre, "/challenge"),
        ).length,
        1,
      );
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* providerHby.close();
    }
  });
});
