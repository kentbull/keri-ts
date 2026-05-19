// @file-test-lane runtime-medium

import { type Operation, run, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { createAgentRuntime, processMailboxTurn } from "../../../src/app/agent-runtime.ts";
import { findVerifiedChallengeResponse } from "../../../src/app/challenging.ts";
import { MailboxPoller } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";
import { waitForTaskHalt } from "../../effection-http.ts";
import { controllerOobiResponse, startStaticHttpHost } from "../../http-test-support.ts";
import {
  authorizeMailboxPollTarget,
  delayForRequest,
  seedHostedController,
  seedLocalController,
  waitForCondition,
} from "./mailbox-runtime-support.ts";

function makeExchangeSerder(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  return exchangeMessage(route, payload, args)[0];
}

/**
 * Proves the request-open timeout is separate from the SSE read duration.
 *
 * If response headers never arrive before the request timeout, mailbox polling
 * should treat that as "no messages yet" instead of hanging or throwing.
 */
Deno.test("MailboxPoller.processOnce returns cleanly when the request-open timeout expires before headers arrive", async () => {
  const providerName = `mailbox-open-timeout-provider-${crypto.randomUUID()}`;
  const clientName = `mailbox-open-timeout-client-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-open-timeout-provider-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-open-timeout-client-${crypto.randomUUID()}`;
  let postCount = 0;
  let provider!: Awaited<ReturnType<typeof seedHostedController>>;

  const host = startStaticHttpHost(async (request, url) => {
    if (url.pathname === `/oobi/${provider.pre}/controller`) {
      return controllerOobiResponse(provider.pre, provider.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      await delayForRequest(60, request.signal);
      if (request.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      return new Response("retry: 5000\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response("Not Found", { status: 404 });
  });
  provider = await seedHostedController(
    providerName,
    providerHeadDirPath,
    "mbx",
    host.origin,
  );
  await seedLocalController(clientName, clientHeadDirPath, "bob");

  try {
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      provider.pre,
      host.origin,
    );

    await run(function*(): Operation<void> {
      const hby = yield* createHabery({
        name: clientName,
        headDirPath: clientHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });

      try {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          {
            timeouts: {
              requestOpenTimeoutMs: 20,
              maxPollDurationMs: 120,
              commandLocalBudgetMs: 40,
            },
          },
        );
        poller.registerTopic("/challenge");

        const received: Uint8Array[] = [];
        const started = Date.now();
        const batches = yield* poller.processOnce();
        received.push(...batches.flatMap((batch) => batch.messages));
        const elapsed = Date.now() - started;

        assertEquals(received.length, 0);
        assertEquals(postCount, 1);
        assertEquals(elapsed >= 15 && elapsed < 80, true);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

/**
 * Proves SSE reads can legitimately outlive the request-open timeout.
 *
 * Once headers arrive, the client should keep reading for the longer
 * mailbox poll duration and persist the consumed mailbox cursor.
 */
Deno.test("MailboxPoller.processOnce allows SSE reads to outlive the request-open timeout", async () => {
  const providerName = `mailbox-read-duration-provider-${crypto.randomUUID()}`;
  const clientName = `mailbox-read-duration-client-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-read-duration-provider-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-read-duration-client-${crypto.randomUUID()}`;
  let postCount = 0;
  let provider!: Awaited<ReturnType<typeof seedHostedController>>;

  const host = startStaticHttpHost((request, url) => {
    if (url.pathname === `/oobi/${provider.pre}/controller`) {
      return controllerOobiResponse(provider.pre, provider.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clearTimer = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
      request.signal.addEventListener("abort", clearTimer, { once: true });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("retry: 5000\n\n"));
            timer = setTimeout(() => {
              request.signal.removeEventListener("abort", clearTimer);
              controller.enqueue(
                encoder.encode(
                  "id: 0\nevent: /challenge\ndata: mailbox-message\n\n",
                ),
              );
              timer = undefined;
            }, 40);
          },
          cancel() {
            request.signal.removeEventListener("abort", clearTimer);
            clearTimer();
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }
    return new Response("Not Found", { status: 404 });
  });
  provider = await seedHostedController(
    providerName,
    providerHeadDirPath,
    "mbx",
    host.origin,
  );
  const clientPre = await seedLocalController(
    clientName,
    clientHeadDirPath,
    "bob",
  );

  try {
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      provider.pre,
      host.origin,
    );

    await run(function*(): Operation<void> {
      const hby = yield* createHabery({
        name: clientName,
        headDirPath: clientHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });

      try {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          {
            timeouts: {
              requestOpenTimeoutMs: 20,
              maxPollDurationMs: 100,
              commandLocalBudgetMs: 150,
            },
          },
        );
        poller.registerTopic("/challenge");

        const received: Uint8Array[] = [];
        const started = Date.now();
        const batches = yield* poller.processOnce({ budgetMs: 150 });
        received.push(...batches.flatMap((batch) => batch.messages));
        const elapsed = Date.now() - started;

        assertEquals(received.length, 1);
        assertEquals(new TextDecoder().decode(received[0]), "mailbox-message");
        assertEquals(postCount, 1);
        assertEquals(elapsed >= 40 && elapsed < 180, true);
        assertEquals(
          hby.db.tops.get([clientPre, provider.pre])?.topics["/challenge"],
          0,
        );
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

/**
 * Proves bounded command-local polling stays sequential and budgeted.
 *
 * The first slow endpoint may consume the whole bounded budget, in which case
 * `processOnce()` must stop without serializing on later endpoints.
 */
Deno.test("MailboxPoller.processOnce stops after the bounded command-local budget is exhausted", async () => {
  const clientName = `mailbox-budget-client-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-budget-client-${crypto.randomUUID()}`;
  await seedLocalController(clientName, clientHeadDirPath, "bob");

  let seeded1!: Awaited<ReturnType<typeof seedHostedController>>;
  let seeded2!: Awaited<ReturnType<typeof seedHostedController>>;
  let postCount = 0;

  const host1 = startStaticHttpHost(async (request, url) => {
    if (url.pathname === `/oobi/${seeded1.pre}/controller`) {
      return controllerOobiResponse(seeded1.pre, seeded1.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      await delayForRequest(60, request.signal);
      if (request.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      return new Response("retry: 5000\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response("Not Found", { status: 404 });
  });
  const host2 = startStaticHttpHost(async (request, url) => {
    if (url.pathname === `/oobi/${seeded2.pre}/controller`) {
      return controllerOobiResponse(seeded2.pre, seeded2.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      await delayForRequest(60, request.signal);
      if (request.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      return new Response("retry: 5000\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response("Not Found", { status: 404 });
  });
  seeded1 = await seedHostedController(
    `mailbox-budget-provider-a-${crypto.randomUUID()}`,
    `/tmp/tufa-mailbox-budget-provider-a-${crypto.randomUUID()}`,
    "mbx",
    host1.origin,
  );
  seeded2 = await seedHostedController(
    `mailbox-budget-provider-b-${crypto.randomUUID()}`,
    `/tmp/tufa-mailbox-budget-provider-b-${crypto.randomUUID()}`,
    "mbx",
    host2.origin,
  );

  try {
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      seeded1.pre,
      host1.origin,
    );
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      seeded2.pre,
      host2.origin,
    );

    await run(function*(): Operation<void> {
      const hby = yield* createHabery({
        name: clientName,
        headDirPath: clientHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });

      try {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          {
            timeouts: {
              requestOpenTimeoutMs: 50,
              maxPollDurationMs: 200,
              commandLocalBudgetMs: 50,
            },
          },
        );
        poller.registerTopic("/challenge");
        yield* poller.processOnce();

        assertEquals(postCount, 1);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host1.close();
    await host2.close();
  }
});

/**
 * Proves long-lived mailbox polling now keeps one remote worker per endpoint.
 *
 * This is the TS-native equivalent of KERIpy's concurrent `Poller` doers: two
 * remote endpoints should both receive their initial `mbx` request promptly,
 * rather than being serialized behind one long poll.
 */
Deno.test("MailboxPoller.pollDo starts one concurrent long-lived worker per remote endpoint", async () => {
  const clientName = `mailbox-concurrency-client-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-concurrency-client-${crypto.randomUUID()}`;
  await seedLocalController(clientName, clientHeadDirPath, "bob");

  let seeded1!: Awaited<ReturnType<typeof seedHostedController>>;
  let seeded2!: Awaited<ReturnType<typeof seedHostedController>>;
  let postCount = 0;

  const host1 = startStaticHttpHost((request, url) => {
    if (url.pathname === `/oobi/${seeded1.pre}/controller`) {
      return controllerOobiResponse(seeded1.pre, seeded1.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("retry: 5000\n\n"));
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }
    return new Response("Not Found", { status: 404 });
  });
  const host2 = startStaticHttpHost((request, url) => {
    if (url.pathname === `/oobi/${seeded2.pre}/controller`) {
      return controllerOobiResponse(seeded2.pre, seeded2.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("retry: 5000\n\n"));
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }
    return new Response("Not Found", { status: 404 });
  });
  seeded1 = await seedHostedController(
    `mailbox-concurrency-provider-a-${crypto.randomUUID()}`,
    `/tmp/tufa-mailbox-concurrency-provider-a-${crypto.randomUUID()}`,
    "mbx",
    host1.origin,
  );
  seeded2 = await seedHostedController(
    `mailbox-concurrency-provider-b-${crypto.randomUUID()}`,
    `/tmp/tufa-mailbox-concurrency-provider-b-${crypto.randomUUID()}`,
    "mbx",
    host2.origin,
  );

  try {
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      seeded1.pre,
      host1.origin,
    );
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      seeded2.pre,
      host2.origin,
    );

    await run(function*(): Operation<void> {
      const hby = yield* createHabery({
        name: clientName,
        headDirPath: clientHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });

      try {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          {
            timeouts: {
              requestOpenTimeoutMs: 20,
              maxPollDurationMs: 80,
              commandLocalBudgetMs: 20,
            },
          },
        );
        poller.registerTopic("/challenge");

        const task = yield* spawn(function*() {
          yield* poller.pollDo((_batch) => {});
        });

        try {
          yield* waitForCondition(() => postCount >= 2, {
            timeoutMs: 120,
            retryDelayMs: 5,
            message: "Expected two concurrent mailbox poll requests.",
          });
        } finally {
          yield* waitForTaskHalt(task);
        }
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host1.close();
    await host2.close();
  }
});

/**
 * Proves the shared mailbox-turn helper owns local mailbox batch settlement.
 *
 * The helper should preserve batch boundaries, return the consumed batches,
 * and settle each batch far enough for challenge-response visibility.
 */
Deno.test("processMailboxTurn settles local mailbox batches and returns them", async () => {
  const clientName = `mailbox-turn-client-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-turn-client-${crypto.randomUUID()}`;
  const wordsA = ["able", "baker"];
  const wordsB = ["charlie", "delta"];

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: clientName,
      headDirPath: clientHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });

    try {
      const alice = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const bob = hby.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const senderA = hby.makeHab("sender-a", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const senderB = hby.makeHab("sender-b", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = yield* createAgentRuntime(hby, {
        mode: "local",
        enableMailboxStore: true,
      });
      const mailboxer = runtime.mailboxer;
      if (!mailboxer) {
        throw new Error("Expected local mailboxer for mailbox turn test.");
      }

      runtime.mailboxDirector.topics.clear();
      runtime.mailboxDirector.registerTopic("/challenge");

      const first = {
        senderPre: senderA.pre,
        message: senderA.endorse(
          makeExchangeSerder("/challenge/response", {
            i: senderA.pre,
            words: [...wordsA],
          }, {
            sender: senderA.pre,
            recipient: alice.pre,
          }),
        ),
      };
      const second = {
        senderPre: senderB.pre,
        message: senderB.endorse(
          makeExchangeSerder("/challenge/response", {
            i: senderB.pre,
            words: [...wordsB],
          }, {
            sender: senderB.pre,
            recipient: bob.pre,
          }),
        ),
      };

      mailboxer.storeMsg(
        mailboxTopicKey(alice.pre, "/challenge"),
        first.message,
      );
      mailboxer.storeMsg(
        mailboxTopicKey(bob.pre, "/challenge"),
        second.message,
      );

      const batches = yield* processMailboxTurn(runtime);

      assertEquals(
        batches.map((batch) => ({ source: batch.source, pre: batch.pre })),
        [
          { source: "local", pre: alice.pre },
          { source: "local", pre: bob.pre },
        ],
      );
      assertExists(
        findVerifiedChallengeResponse(hby.db, first.senderPre, wordsA),
      );
      assertExists(
        findVerifiedChallengeResponse(hby.db, second.senderPre, wordsB),
      );
    } finally {
      yield* hby.close();
    }
  });
});
