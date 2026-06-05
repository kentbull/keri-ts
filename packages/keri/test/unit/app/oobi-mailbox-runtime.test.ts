// @file-test-lane runtime-slow

import { type Operation, run, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { mailboxAddCommand } from "../../../../tufa/src/cli/mailbox.ts";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
} from "../../../src/app/agent-runtime.ts";
import { exchangeSendCommand } from "../../../src/app/cli/exchange.ts";
import {
  oobiGenerateCommand,
  oobiResolveCommand,
} from "../../../src/app/cli/oobi.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { OOBI_MAILBOX_TOPIC } from "../../../src/core/mailbox-topics.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { waitForTaskHalt } from "../../effection-http.ts";
import {
  controllerOobiResponse,
  startStaticHttpHost,
} from "../../http-test-support.ts";
import { startTestServer } from "../../runtime-test-hosts.ts";
import { testCLICommand } from "../../utils.ts";
import {
  seedHostedIdentifier,
  seedLocalIdentifier,
} from "./challenge-runtime-support.ts";

async function seedMailboxProvider(
  name: string,
  headDirPath: string,
  alias: string,
): Promise<string> {
  let pre = "";

  await run(function* (): Operation<void> {
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

Deno.test("generic exchange send routes '/oobis' through '/oobi' mailbox storage and the receiver can process the stored message", async () => {
  const providerName = `oobi-indirect-provider-${crypto.randomUUID()}`;
  const recipientName = `oobi-indirect-recipient-${crypto.randomUUID()}`;
  const senderName = `oobi-indirect-sender-${crypto.randomUUID()}`;
  const providerHeadDirPath =
    `/tmp/tufa-oobi-indirect-provider-${crypto.randomUUID()}`;
  const recipientHeadDirPath =
    `/tmp/tufa-oobi-indirect-recipient-${crypto.randomUUID()}`;
  const senderHeadDirPath =
    `/tmp/tufa-oobi-indirect-sender-${crypto.randomUUID()}`;

  const providerPre = await seedMailboxProvider(
    providerName,
    providerHeadDirPath,
    "mbx",
  );
  const recipientPre = await seedLocalIdentifier(
    recipientName,
    recipientHeadDirPath,
    "recipient",
  );
  let sender!: Awaited<ReturnType<typeof seedHostedIdentifier>>;
  const senderHost = startStaticHttpHost((_request, url) => {
    if (url.pathname === `/oobi/${sender.pre}/controller`) {
      return controllerOobiResponse(sender.pre, sender.controllerBytes);
    }
    return new Response("Not Found", { status: 404 });
  });
  sender = await seedHostedIdentifier(
    senderName,
    senderHeadDirPath,
    "sender",
    senderHost.origin,
  );
  const senderPre = sender.pre;
  const requestedOobi =
    `https://resolver.example/oobi/${senderPre}/controller?name=Requested`;

  try {
    await run(function* (): Operation<void> {
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
      const runtimeTask = yield* spawn(function* () {
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
            name: recipientName,
            headDirPath: recipientHeadDirPath,
            url: `${providerUrl}/oobi/${providerPre}/controller`,
            oobiAlias: "mbx",
          }),
        );
        assertEquals(
          providerResolved.output.at(-1),
          `${providerUrl}/oobi/${providerPre}/controller`,
        );

        const senderResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: recipientName,
            headDirPath: recipientHeadDirPath,
            url: `${senderHost.origin}/oobi/${senderPre}/controller`,
            oobiAlias: "sender",
          }),
        );
        assertEquals(
          senderResolved.output.at(-1),
          `${senderHost.origin}/oobi/${senderPre}/controller`,
        );

        const mailboxAdded = yield* testCLICommand(
          mailboxAddCommand({
            name: recipientName,
            headDirPath: recipientHeadDirPath,
            alias: "recipient",
            mailbox: providerPre,
          }),
        );
        assertEquals(mailboxAdded.output.at(-1), `added ${providerPre}`);

        const mailboxOobi = yield* testCLICommand(
          oobiGenerateCommand({
            name: recipientName,
            headDirPath: recipientHeadDirPath,
            alias: "recipient",
            role: "mailbox",
          }),
        );
        assertEquals(
          mailboxOobi.output.at(-1),
          `${providerUrl}/oobi/${recipientPre}/mailbox/${providerPre}`,
        );

        const recipientResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: senderName,
            headDirPath: senderHeadDirPath,
            url: `${providerUrl}/oobi/${recipientPre}/mailbox/${providerPre}`,
            oobiAlias: "recipient",
          }),
        );
        assertEquals(
          recipientResolved.output.at(-1),
          `${providerUrl}/oobi/${recipientPre}/mailbox/${providerPre}`,
        );

        const sent = yield* testCLICommand(
          exchangeSendCommand({
            name: senderName,
            headDirPath: senderHeadDirPath,
            sender: "sender",
            recipient: recipientPre,
            route: "/oobis",
            data: [
              `dest=${recipientPre}`,
              `oobi=${requestedOobi}`,
            ],
          }),
        );
        assertEquals(sent.output[0], "Sent EXN message");
        const storedMessages = mailboxer.getTopicMsgs(
          mailboxTopicKey(recipientPre, OOBI_MAILBOX_TOPIC),
        );
        assertEquals(
          storedMessages.length > 0,
          true,
        );
        const storedMessage = storedMessages.at(-1);
        assertExists(storedMessage);

        const recipientHby = yield* createHabery({
          name: recipientName,
          headDirPath: recipientHeadDirPath,
          skipConfig: true,
        });
        try {
          const recipientHab = recipientHby.habByName("recipient");
          if (!recipientHab) {
            throw new Error("Expected recipient habitat.");
          }
          const recipientRuntime = yield* createAgentRuntime(recipientHby, {
            mode: "local",
          });

          try {
            ingestKeriBytes(recipientRuntime, storedMessage);
            recipientRuntime.reactor.processOnce();
            recipientRuntime.reactor.processEscrowsOnce();

            const requestedRecord = recipientHby.db.oobis.get(requestedOobi);
            const requestedNotice = (recipientRuntime.notifier?.list() ?? [])
              .find(
                (notice) => notice.attrs["oobi"] === requestedOobi,
              );

            assertExists(requestedRecord);
            assertEquals(requestedRecord.state, "queued");
            assertExists(requestedNotice);
            assertEquals(requestedNotice.attrs["r"], "/oobi");
            assertEquals(requestedNotice.attrs["src"], senderPre);
            assertEquals(requestedNotice.attrs["oobi"], requestedOobi);
            assertExists(recipientRuntime.noter);
          } finally {
            yield* recipientRuntime.close();
          }
        } finally {
          yield* recipientHby.close();
        }
      } finally {
        yield* waitForTaskHalt(serverTask);
        yield* waitForTaskHalt(runtimeTask);
        yield* runtime.close();
        yield* providerHby.close();
      }
    });
  } finally {
    await senderHost.close();
  }
});
