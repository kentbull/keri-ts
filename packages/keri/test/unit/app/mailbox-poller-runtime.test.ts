// @file-test-lane runtime-medium

import { type Operation, run, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { createAgentRuntime, processMailboxTurn } from "../../../src/app/agent-runtime.ts";
import { findVerifiedChallengeResponse } from "../../../src/app/challenging.ts";
import { MailboxPoller, type MailboxPollingTimeoutPolicy } from "../../../src/app/forwarding.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import type { MailboxSseMessage } from "../../../src/app/mailbox-sse.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { runtimeTurn } from "../../../src/app/runtime-turn.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";
import { Roles } from "../../../src/core/roles.ts";
import { waitForTaskHalt } from "../../effection-http.ts";
import {
  FakeMailboxPollTransport,
  fakeRuntimeServices,
  ManualRuntimeClock,
} from "../../support/runtime-service-fakes.ts";

function makeExchangeSerder(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  return exchangeMessage(route, payload, args)[0];
}

function makeTransferableHab(hby: Habery, alias: string): Hab {
  return hby.makeHab(alias, undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  });
}

function seedMailboxEndpoint(
  hby: Habery,
  recipientPre: string,
  label: string,
): { eid: string; url: string } {
  const eid = `mailbox-${label}-${crypto.randomUUID()}`;
  const url = `http://${label}.mailbox.test/`;
  hby.db.locs.pin([eid, "http"], { url });
  hby.db.ends.pin([recipientPre, Roles.mailbox, eid], { allowed: true });
  return { eid, url };
}

function mailboxMessage(
  message: string,
  {
    topic = "/challenge",
    idx = 0,
  }: {
    topic?: string;
    idx?: number;
  } = {},
): MailboxSseMessage {
  return { topic, idx, msg: new TextEncoder().encode(message) };
}

function mailboxBytes(
  msg: Uint8Array,
  {
    topic = "/challenge",
    idx = 0,
  }: {
    topic?: string;
    idx?: number;
  } = {},
): MailboxSseMessage {
  return { topic, idx, msg };
}

function makePollerFixture(
  hby: Habery,
  {
    endpointCount = 1,
    transport,
    clock = new ManualRuntimeClock(),
    timeouts,
  }: {
    endpointCount?: number;
    transport: FakeMailboxPollTransport;
    clock?: ManualRuntimeClock;
    timeouts?: Partial<MailboxPollingTimeoutPolicy>;
  },
) {
  const hab = makeTransferableHab(hby, "bob");
  const endpoints = Array.from(
    { length: endpointCount },
    (_, index) => seedMailboxEndpoint(hby, hab.pre, `remote-${index + 1}`),
  );
  const poller = new MailboxPoller(
    hby,
    new MailboxDirector(hby),
    {
      timeouts,
      services: fakeRuntimeServices({ clock }),
      pollTransport: transport,
    },
  );
  poller.registerTopic("/challenge");
  return { hab, poller, endpoints };
}

function* waitForCondition(
  condition: () => boolean,
  message: string,
): Operation<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    yield* runtimeTurn();
  }
  throw new Error(message);
}

/**
 * Proves the request-open timeout is separate from the SSE read duration.
 *
 * If response headers never arrive before the request timeout, mailbox polling
 * should treat that as "no messages yet" instead of hanging or throwing.
 */
Deno.test("MailboxPoller.processOnce returns cleanly when the request-open timeout expires before headers arrive", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `mailbox-open-timeout-client-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const clock = new ManualRuntimeClock();
    const transport = new FakeMailboxPollTransport([{ advanceMs: 20 }], clock);

    try {
      const { poller } = makePollerFixture(hby, {
        clock,
        transport,
        timeouts: {
          requestOpenTimeoutMs: 20,
          maxPollDurationMs: 120,
          commandLocalBudgetMs: 40,
        },
      });

      const batches = yield* poller.processOnce();

      assertEquals(batches, []);
      assertEquals(transport.polls.length, 1);
      assertEquals(transport.polls[0]!.timeouts.requestOpenTimeoutMs, 20);
      assertEquals(clock.now(), 20);
    } finally {
      yield* hby.close();
    }
  });
});

/**
 * Proves SSE reads can legitimately outlive the request-open timeout.
 *
 * Once headers arrive, the client should keep reading for the longer
 * mailbox poll duration and persist the consumed mailbox cursor.
 */
Deno.test("MailboxPoller.processOnce allows SSE reads to outlive the request-open timeout", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `mailbox-read-duration-client-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const clock = new ManualRuntimeClock();
    const transport = new FakeMailboxPollTransport([{
      advanceMs: 40,
      messages: [mailboxMessage("mailbox-message")],
    }], clock);

    try {
      const { hab, poller, endpoints } = makePollerFixture(hby, {
        clock,
        transport,
        timeouts: {
          requestOpenTimeoutMs: 20,
          maxPollDurationMs: 100,
          commandLocalBudgetMs: 150,
        },
      });

      const batches = yield* poller.processOnce({ budgetMs: 150 });
      const received = batches.flatMap((batch) => batch.messages);

      assertEquals(received.length, 1);
      assertEquals(new TextDecoder().decode(received[0]), "mailbox-message");
      assertEquals(transport.polls.length, 1);
      assertEquals(clock.now(), 40);
      assertEquals(
        hby.db.tops.get([hab.pre, endpoints[0]!.eid])?.topics["/challenge"],
        0,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("processMailboxTurn settles complete body-only mailbox records", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `mailbox-complete-record-client-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const clock = new ManualRuntimeClock();
    const transport = new FakeMailboxPollTransport([], clock);

    try {
      const hab = makeTransferableHab(hby, "bob");
      const endpoint = seedMailboxEndpoint(hby, hab.pre, "remote");
      transport.enqueue({
        advanceMs: 40,
        messages: [
          mailboxBytes(hab.makeEndRole(hab.pre, Roles.mailbox, true), {
            topic: "/reply",
            idx: 0,
          }),
        ],
      });
      const runtime = yield* createAgentRuntime(hby, {
        services: fakeRuntimeServices({ clock }),
        mailboxPollTransport: transport,
      });
      try {
        const batches = yield* processMailboxTurn(runtime, {
          hab,
          budgetMs: 150,
        });

        assertEquals(batches.length, 1);
        assertEquals(
          hby.db.tops.get([hab.pre, endpoint.eid])?.topics["/reply"],
          0,
        );
        assertEquals(
          hby.db.ends.get([hab.pre, Roles.mailbox, hab.pre])?.allowed,
          true,
        );
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close();
    }
  });
});

/**
 * Proves bounded command-local polling stays sequential and budgeted.
 *
 * The first slow endpoint may consume the whole bounded budget, in which case
 * `processOnce()` must stop without serializing on later endpoints.
 */
Deno.test("MailboxPoller.processOnce stops after the bounded command-local budget is exhausted", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `mailbox-budget-client-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const clock = new ManualRuntimeClock();
    const transport = new FakeMailboxPollTransport([{ advanceMs: 60 }], clock);

    try {
      const { poller } = makePollerFixture(hby, {
        endpointCount: 2,
        clock,
        transport,
        timeouts: {
          requestOpenTimeoutMs: 50,
          maxPollDurationMs: 200,
          commandLocalBudgetMs: 50,
        },
      });

      yield* poller.processOnce();

      assertEquals(transport.polls.length, 1);
      assertEquals(transport.polls[0]!.timeouts.requestOpenTimeoutMs, 50);
    } finally {
      yield* hby.close();
    }
  });
});

/**
 * Proves long-lived mailbox polling now keeps one remote worker per endpoint.
 *
 * This is the TS-native equivalent of KERIpy's concurrent `Poller` doers: two
 * remote endpoints should both receive their initial `mbx` request promptly,
 * rather than being serialized behind one long poll.
 */
Deno.test("MailboxPoller.pollDo starts one concurrent long-lived worker per remote endpoint", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `mailbox-concurrency-client-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const clock = new ManualRuntimeClock();
    const transport = new FakeMailboxPollTransport([], clock);

    try {
      const { poller, endpoints } = makePollerFixture(hby, {
        endpointCount: 2,
        clock,
        transport,
        timeouts: {
          requestOpenTimeoutMs: 20,
          maxPollDurationMs: 80,
          commandLocalBudgetMs: 20,
        },
      });

      const task = yield* spawn(function*() {
        yield* poller.pollDo((_batch) => {});
      });

      try {
        yield* waitForCondition(
          () => {
            const polledEids = new Set(
              transport.polls.map((poll) => poll.endpoint.eid),
            );
            return endpoints.every((endpoint) => polledEids.has(endpoint.eid));
          },
          "Expected two concurrent mailbox poll requests.",
        );
      } finally {
        yield* waitForTaskHalt(task);
      }
    } finally {
      yield* hby.close();
    }
  });
});

/**
 * Proves the shared mailbox-turn helper owns local mailbox batch settlement.
 *
 * The helper should preserve batch boundaries, return the consumed batches,
 * and settle each batch far enough for challenge-response visibility.
 */
Deno.test("processMailboxTurn settles local mailbox batches and returns them", async () => {
  const clientName = `mailbox-turn-client-${crypto.randomUUID()}`;
  const wordsA = ["able", "baker"];
  const wordsB = ["charlie", "delta"];

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: clientName,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });

    try {
      const alice = makeTransferableHab(hby, "alice");
      const bob = makeTransferableHab(hby, "bob");
      const senderA = makeTransferableHab(hby, "sender-a");
      const senderB = makeTransferableHab(hby, "sender-b");
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
