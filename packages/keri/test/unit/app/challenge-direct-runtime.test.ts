// @file-test-lane runtime-medium

import { type Operation, run, spawn } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
} from "../../../src/app/agent-runtime.ts";
import { challengeRespondCommand, challengeVerifyCommand } from "../../../src/app/cli/challenge.ts";
import { oobiResolveCommand } from "../../../src/app/cli/oobi.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { waitForTaskHalt } from "../../effection-http.ts";
import { controllerOobiResponse, startStaticHttpHost } from "../../http-test-support.ts";
import { startTestServer } from "../../runtime-test-hosts.ts";
import { testCLICommand } from "../../utils.ts";
import { seedHostedIdentifier, seedLocalIdentifier } from "./challenge-runtime-support.ts";

Deno.test("challenge respond and verify round-trip through direct controller delivery", async () => {
  const aliceName = `challenge-direct-alice-${crypto.randomUUID()}`;
  const bobName = `challenge-direct-bob-${crypto.randomUUID()}`;
  const aliceHeadDirPath = `/tmp/tufa-challenge-direct-alice-${crypto.randomUUID()}`;
  const bobHeadDirPath = `/tmp/tufa-challenge-direct-bob-${crypto.randomUUID()}`;
  const words = ["baba", "coco", "dede"];

  let alice!: Awaited<ReturnType<typeof seedHostedIdentifier>>;
  const aliceHost = startStaticHttpHost((_request, url) => {
    if (url.pathname === `/oobi/${alice.pre}/controller`) {
      return controllerOobiResponse(alice.pre, alice.controllerBytes);
    }
    return new Response("Not Found", { status: 404 });
  });
  alice = await seedHostedIdentifier(
    aliceName,
    aliceHeadDirPath,
    "alice",
    aliceHost.origin,
  );
  await seedLocalIdentifier(bobName, bobHeadDirPath, "bob");

  try {
    const aliceResolved = await run(() =>
      testCLICommand(
        oobiResolveCommand({
          name: bobName,
          headDirPath: bobHeadDirPath,
          url: `${aliceHost.origin}/oobi/${alice.pre}/controller`,
          oobiAlias: "alice",
        }),
      )
    );
    assertEquals(
      aliceResolved.output.at(-1),
      `${aliceHost.origin}/oobi/${alice.pre}/controller`,
    );

    await run(function*(): Operation<void> {
      const hby = yield* createHabery({
        name: bobName,
        headDirPath: bobHeadDirPath,
        skipConfig: true,
      });
      const hab = hby.habByName("bob");
      if (!hab) {
        throw new Error("Expected bob habitat.");
      }

      const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
      const runtimeTask = yield* spawn(function*() {
        yield* runAgentRuntime(runtime, { hab });
      });
      const { address, task: serverTask } = yield* startTestServer(runtime);

      try {
        const bobUrl = `http://${address.hostname}:${address.port}`;
        ingestKeriBytes(runtime, hab.makeLocScheme(bobUrl, hab.pre, "http"));
        ingestKeriBytes(
          runtime,
          hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        );
        yield* processRuntimeTurn(runtime, { hab });

        const bobResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: aliceName,
            headDirPath: aliceHeadDirPath,
            url: `${bobUrl}/oobi/${hab.pre}/controller`,
            oobiAlias: "bob",
          }),
        );
        assertEquals(
          bobResolved.output.at(-1),
          `${bobUrl}/oobi/${hab.pre}/controller`,
        );

        const responded = yield* testCLICommand(
          challengeRespondCommand({
            name: aliceName,
            headDirPath: aliceHeadDirPath,
            alias: "alice",
            recipient: "bob",
            words: JSON.stringify(words),
            transport: "direct",
          }),
        );
        assertEquals(responded.output[0], "Sent EXN message");
      } finally {
        yield* waitForTaskHalt(serverTask);
        yield* waitForTaskHalt(runtimeTask);
        yield* runtime.close();
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
          pollDelayMs: 25,
        }),
      )
    );
    assertStringIncludes(verified.output.at(-1) ?? "", alice.pre);

    await run(function*(): Operation<void> {
      const hby = yield* createHabery({
        name: bobName,
        headDirPath: bobHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertEquals(hby.db.cfld.get([alice.pre, "alias"]), "alice");
        assertEquals(hby.db.reps.get([alice.pre]).length > 0, true);
        assertEquals(hby.db.chas.get([alice.pre]).length > 0, true);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await aliceHost.close();
  }
});
