// @file-test-lane runtime-slow

import { type Operation, run, spawn } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { mailboxAddCommand } from "../../../../tufa/src/cli/mailbox.ts";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
} from "../../../src/app/agent-runtime.ts";
import { challengeRespondCommand, challengeVerifyCommand } from "../../../src/app/cli/challenge.ts";
import { oobiGenerateCommand, oobiResolveCommand } from "../../../src/app/cli/oobi.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { waitForTaskHalt } from "../../effection-http.ts";
import { controllerOobiResponse, startStaticHttpHost } from "../../http-test-support.ts";
import { startTestServer } from "../../runtime-test-hosts.ts";
import { testCLICommand } from "../../utils.ts";
import { seedHostedIdentifier, seedLocalIdentifier } from "./challenge-runtime-support.ts";

async function seedMailboxProvider(
  name: string,
  headDirPath: string,
  alias: string,
): Promise<string> {
  let pre = "";

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      pre = hby.makeHab(alias, undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      }).pre;
    } finally {
      yield* hby.close();
    }
  });

  return pre;
}

Deno.test("exchange send can deliver challenge responses through mailbox-authorized transport", async () => {
  const providerName = `challenge-indirect-provider-${crypto.randomUUID()}`;
  const bobName = `challenge-indirect-bob-${crypto.randomUUID()}`;
  const aliceName = `challenge-indirect-alice-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-challenge-indirect-provider-${crypto.randomUUID()}`;
  const bobHeadDirPath = `/tmp/tufa-challenge-indirect-bob-${crypto.randomUUID()}`;
  const aliceHeadDirPath = `/tmp/tufa-challenge-indirect-alice-${crypto.randomUUID()}`;
  const words = ["fafa", "gogo", "haha"];

  const providerPre = await seedMailboxProvider(
    providerName,
    providerHeadDirPath,
    "mbx",
  );
  const bobPre = await seedLocalIdentifier(
    bobName,
    bobHeadDirPath,
    "bob",
  );
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

  try {
    await run(function*(): Operation<void> {
      const providerHby = yield* createHabery({
        name: providerName,
        headDirPath: providerHeadDirPath,
        skipConfig: true,
      });
      const hab = providerHby.habByName("mbx");
      if (!hab) {
        throw new Error("Expected mailbox provider habitat.");
      }

      const runtime = yield* createAgentRuntime(providerHby, {
        mode: "indirect",
      });
      const mailboxer = runtime.mailboxer;
      if (!mailboxer) {
        throw new Error("Expected provider runtime mailboxer.");
      }
      const runtimeTask = yield* spawn(function*() {
        yield* runAgentRuntime(runtime, { hab });
      });
      const { address, task: serverTask } = yield* startTestServer(runtime);

      try {
        const providerUrl = `http://${address.hostname}:${address.port}`;
        ingestKeriBytes(
          runtime,
          hab.makeLocScheme(providerUrl, hab.pre, "http"),
        );
        ingestKeriBytes(
          runtime,
          hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        );
        ingestKeriBytes(
          runtime,
          hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
        );
        yield* processRuntimeTurn(runtime, { hab });

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
            url: `${aliceHost.origin}/oobi/${alice.pre}/controller`,
            oobiAlias: "alice",
          }),
        );
        assertEquals(
          aliceResolved.output.at(-1),
          `${aliceHost.origin}/oobi/${alice.pre}/controller`,
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
          mailboxer.getTopicMsgs(mailboxTopicKey(bobPre, "/challenge")).length
            > 0,
          true,
        );

        const verified = yield* testCLICommand(
          challengeVerifyCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            signer: alice.pre,
            words: JSON.stringify(words),
            timeout: 5,
            pollDelayMs: 25,
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

    await run(function*(): Operation<void> {
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
