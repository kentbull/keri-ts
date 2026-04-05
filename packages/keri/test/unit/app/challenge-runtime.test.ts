import { run, spawn } from "effection";
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
} from "../../../src/app/agent-runtime.ts";
import {
  challengeGenerateCommand,
  challengeRespondCommand,
  challengeVerifyCommand,
} from "../../../src/app/cli/challenge.ts";
import { exchangeSendCommand } from "../../../src/app/cli/exchange.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { startServer } from "../../../src/app/server.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { waitForServer, waitForTaskHalt } from "../../effection-http.ts";
import { testCLICommand } from "../../utils.ts";
import { oobiResolveCommand } from "../../../src/app/cli/oobi.ts";

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

interface SeededHab {
  pre: string;
  controllerBytes: Uint8Array;
}

async function seedHostedIdentifier(
  name: string,
  headDirPath: string,
  alias: string,
  url: string,
  { mailbox = false }: { mailbox?: boolean } = {},
): Promise<SeededHab> {
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

      const runtime = createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      if (mailbox) {
        ingestKeriBytes(
          runtime,
          hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
        );
      }
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

Deno.test("challenge generate emits JSON, string, and newline-delimited outputs", async () => {
  const json = await run(() =>
    testCLICommand(challengeGenerateCommand({ strength: 128, out: "json" }))
  );
  const jsonWords = JSON.parse(json.output.at(-1) ?? "[]");
  assertEquals(Array.isArray(jsonWords), true);
  assertEquals(jsonWords.length >= 1, true);

  const string = await run(() =>
    testCLICommand(challengeGenerateCommand({ strength: 128, out: "string" }))
  );
  assertStringIncludes(string.output.at(-1) ?? "", " ");

  const words = await run(() =>
    testCLICommand(challengeGenerateCommand({ strength: 128, out: "words" }))
  );
  assertStringIncludes(words.output.at(-1) ?? "", "\n");
});

Deno.test("challenge respond and verify round-trip through direct controller delivery", async () => {
  const aliceName = `challenge-direct-alice-${crypto.randomUUID()}`;
  const bobName = `challenge-direct-bob-${crypto.randomUUID()}`;
  const aliceHeadDirPath =
    `/tmp/tufa-challenge-direct-alice-${crypto.randomUUID()}`;
  const bobHeadDirPath =
    `/tmp/tufa-challenge-direct-bob-${crypto.randomUUID()}`;
  const aliceUrl = "http://127.0.0.1:8921";
  const bobUrl = "http://127.0.0.1:8922";
  const words = ["baba", "coco", "dede"];

  const alice = await seedHostedIdentifier(
    aliceName,
    aliceHeadDirPath,
    "alice",
    aliceUrl,
  );
  const bob = await seedHostedIdentifier(
    bobName,
    bobHeadDirPath,
    "bob",
    bobUrl,
  );

  const aliceHost = startStaticOobiHost(8921, (_request, url) => {
    if (url.pathname === `/oobi/${alice.pre}/controller`) {
      return new Response(new Uint8Array(alice.controllerBytes).buffer, {
        status: 200,
        headers: { "Content-Type": "application/cesr", "Oobi-Aid": alice.pre },
      });
    }
    return new Response("Not Found", { status: 404 });
  });

  try {
    await run(() => waitForServer(8921));
    const aliceResolved = await run(() =>
      testCLICommand(
        oobiResolveCommand({
          name: bobName,
          headDirPath: bobHeadDirPath,
          url: `${aliceUrl}/oobi/${alice.pre}/controller`,
        }),
      )
    );
    assertEquals(
      aliceResolved.output.at(-1),
      `${aliceUrl}/oobi/${alice.pre}/controller`,
    );
  } finally {
    await aliceHost.close();
  }

  await run(function* () {
    const hby = yield* createHabery({
      name: bobName,
      headDirPath: bobHeadDirPath,
      skipConfig: true,
    });
    const hab = hby.habByName("bob");
    const runtime = createAgentRuntime(hby, { mode: "indirect" });
    const runtimeTask = yield* spawn(function* () {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function* () {
      yield* startServer(8922, undefined, runtime);
    });

    try {
      yield* waitForServer(8922);

      const bobResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: aliceName,
          headDirPath: aliceHeadDirPath,
          url: `${bobUrl}/oobi/${bob.pre}/controller`,
        }),
      );
      assertEquals(
        bobResolved.output.at(-1),
        `${bobUrl}/oobi/${bob.pre}/controller`,
      );

      const responded = yield* testCLICommand(
        challengeRespondCommand({
          name: aliceName,
          headDirPath: aliceHeadDirPath,
          alias: "alice",
          recipient: bob.pre,
          words: JSON.stringify(words),
          transport: "direct",
        }),
      );
      assertStringIncludes(responded.output.at(-1) ?? "", bobUrl);
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* hby.close();
    }
  });

  const verified = await run(() =>
    testCLICommand(
      challengeVerifyCommand({
        name: bobName,
        headDirPath: bobHeadDirPath,
        signer: alice.pre,
        words: JSON.stringify(words),
        timeout: 1,
      }),
    )
  );
  assertStringIncludes(verified.output.at(-1) ?? "", alice.pre);

  await run(function* () {
    const hby = yield* createHabery({
      name: bobName,
      headDirPath: bobHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.db.reps.get([alice.pre]).length > 0, true);
      assertEquals(hby.db.chas.get([alice.pre]).length > 0, true);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("exchange send can deliver challenge responses through mailbox-authorized transport", async () => {
  const aliceName = `challenge-indirect-alice-${crypto.randomUUID()}`;
  const bobName = `challenge-indirect-bob-${crypto.randomUUID()}`;
  const aliceHeadDirPath =
    `/tmp/tufa-challenge-indirect-alice-${crypto.randomUUID()}`;
  const bobHeadDirPath =
    `/tmp/tufa-challenge-indirect-bob-${crypto.randomUUID()}`;
  const aliceUrl = "http://127.0.0.1:8931";
  const bobUrl = "http://127.0.0.1:8932";
  const words = ["fafa", "gogo", "haha"];

  const alice = await seedHostedIdentifier(
    aliceName,
    aliceHeadDirPath,
    "alice",
    aliceUrl,
  );
  const bob = await seedHostedIdentifier(
    bobName,
    bobHeadDirPath,
    "bob",
    bobUrl,
    { mailbox: true },
  );

  const aliceHost = startStaticOobiHost(8931, (_request, url) => {
    if (url.pathname === `/oobi/${alice.pre}/controller`) {
      return new Response(new Uint8Array(alice.controllerBytes).buffer, {
        status: 200,
        headers: { "Content-Type": "application/cesr", "Oobi-Aid": alice.pre },
      });
    }
    return new Response("Not Found", { status: 404 });
  });

  try {
    await run(() => waitForServer(8931));
    const aliceResolved = await run(() =>
      testCLICommand(
        oobiResolveCommand({
          name: bobName,
          headDirPath: bobHeadDirPath,
          url: `${aliceUrl}/oobi/${alice.pre}/controller`,
        }),
      )
    );
    assertEquals(
      aliceResolved.output.at(-1),
      `${aliceUrl}/oobi/${alice.pre}/controller`,
    );
  } finally {
    await aliceHost.close();
  }

  await run(function* () {
    const hby = yield* createHabery({
      name: bobName,
      headDirPath: bobHeadDirPath,
      skipConfig: true,
    });
    const hab = hby.habByName("bob");
    const runtime = createAgentRuntime(hby, { mode: "indirect" });
    const runtimeTask = yield* spawn(function* () {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function* () {
      yield* startServer(8932, undefined, runtime);
    });

    try {
      yield* waitForServer(8932);

      const mailboxResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: aliceName,
          headDirPath: aliceHeadDirPath,
          url: `${bobUrl}/oobi/${bob.pre}/mailbox/${bob.pre}`,
        }),
      );
      assertEquals(
        mailboxResolved.output.at(-1),
        `${bobUrl}/oobi/${bob.pre}/mailbox/${bob.pre}`,
      );

      const sent = yield* testCLICommand(
        exchangeSendCommand({
          name: aliceName,
          headDirPath: aliceHeadDirPath,
          alias: "alice",
          recipient: bob.pre,
          route: "/challenge/response",
          payload: JSON.stringify({ i: alice.pre, words }),
          transport: "indirect",
        }),
      );
      assertStringIncludes(sent.output.at(-1) ?? "", bobUrl);
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* hby.close();
    }
  });

  const verified = await run(() =>
    testCLICommand(
      challengeVerifyCommand({
        name: bobName,
        headDirPath: bobHeadDirPath,
        signer: alice.pre,
        words: JSON.stringify(words),
        timeout: 1,
      }),
    )
  );
  assertStringIncludes(verified.output.at(-1) ?? "", alice.pre);

  await run(function* () {
    const hby = yield* createHabery({
      name: bobName,
      headDirPath: bobHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertExists(hby.db.ends.get([bob.pre, EndpointRoles.mailbox, bob.pre]));
      assertEquals(hby.db.reps.get([alice.pre]).length > 0, true);
      assertEquals(hby.db.chas.get([alice.pre]).length > 0, true);
    } finally {
      yield* hby.close();
    }
  });
});
