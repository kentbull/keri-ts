import { call, type Operation, run, spawn, suspend } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { createAgentRuntime, settleMailboxPollBatch } from "../../../src/app/agent-runtime.ts";
import { findVerifiedChallengeResponse } from "../../../src/app/challenging.ts";
import { type MailboxPollBatch, MailboxPoller, type MailboxPollingTimeoutPolicy } from "../../../src/app/forwarding.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import type { MailboxSseMessage } from "../../../src/app/mailbox-sse.ts";
import { mailboxDeliveryEndpoints, mailboxPollEndpoints, mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";
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
  const deadline = performance.now() + 1_000;
  while (performance.now() < deadline) {
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
Deno.test("MailboxPoller.pollDo keeps HTTP endpoint selection and request-open timeouts separate", async () => {
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
      const { hab, poller, endpoints } = makePollerFixture(hby, {
        clock,
        transport,
        timeouts: {
          requestOpenTimeoutMs: 20,
          maxPollDurationMs: 120,
        },
      });

      const mailbox = endpoints[0]!, tcp = "tcp://remote.mailbox.test:5620";
      const witness = "available-witness", witnessUrl = "https://available.witness.test/";
      hby.db.ends.pin([hab.pre, Roles.witness, witness], { allowed: true });
      hby.db.locs.pin([witness, "https"], { url: witnessUrl });
      hby.db.locs.rem([mailbox.eid, "http"]);
      hby.db.locs.pin([mailbox.eid, "tcp"], { url: tcp });
      assertEquals(mailboxDeliveryEndpoints(hab, hab.pre), [{ eid: mailbox.eid, url: tcp }]);
      assertEquals(mailboxPollEndpoints(hby, hab), [], "TCP-only mailbox must retain precedence over HTTP witness");
      const batches: MailboxPollBatch[] = [];
      const worker = yield* spawn(() =>
        poller.pollDo((batch) => {
          batches.push(batch);
        })
      );
      try {
        yield* runtimeTurn();
        assertEquals(transport.polls.length, 0, "SSE must not attempt a TCP endpoint");
        const defaultPoller = new MailboxPoller(hby, new MailboxDirector(hby));
        defaultPoller.registerTopic("/challenge");
        const defaultWorker = yield* spawn(() => defaultPoller.pollDo((_batch) => {}));
        yield* runtimeTurn();
        yield* waitForTaskHalt(defaultWorker);
        hby.db.locs.pin([mailbox.eid, "http"], { url: mailbox.url });
        yield* waitForCondition(
          () => transport.polls.length > 0,
          "Expected the newly available HTTP endpoint to be polled.",
        );
        assertEquals(batches, []);
        assertEquals(transport.polls[0]!.timeouts.requestOpenTimeoutMs, 20);
        assertEquals(clock.now(), 20);
        assertEquals(transport.polls[0]!.endpoint.url, mailbox.url);
        const https = "https://remote.mailbox.test/";
        hby.db.locs.pin([mailbox.eid, "https"], { url: https });
        assertEquals(mailboxPollEndpoints(hby, hab)[0].url, https);
        assertEquals(mailboxDeliveryEndpoints(hab, hab.pre)[0].url, https);
        hby.db.ends.rem([hab.pre, Roles.mailbox, mailbox.eid]);
        assertEquals(mailboxPollEndpoints(hby, hab)[0].url, witnessUrl);
        hby.db.locs.rem([witness, "https"]);
        hby.db.locs.pin([witness, "tcp"], { url: "tcp://available.witness.test:5620" });
        assertEquals(mailboxPollEndpoints(hby, hab), [], "TCP-only witness has no SSE transport");
      } finally {
        yield* waitForTaskHalt(worker);
      }
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
Deno.test("MailboxPoller.pollDo allows SSE reads to outlive the request-open timeout", async () => {
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
        },
      });

      const batches: MailboxPollBatch[] = [];
      const worker = yield* spawn(() =>
        poller.pollDo((batch) => {
          batches.push(batch);
        })
      );
      try {
        yield* waitForCondition(
          () => hby.db.tops.get([hab.pre, endpoints[0]!.eid])?.topics["/challenge"] === 0,
          "Expected the consumed SSE cursor to persist.",
        );
        const received = batches.flatMap((batch) => batch.messages);
        assertEquals(received.length, 1);
        assertEquals(new TextDecoder().decode(received[0]), "mailbox-message");
        assertEquals(transport.polls[0]!.timeouts.requestOpenTimeoutMs, 20);
        assertEquals(transport.polls[0]!.timeouts.maxReadDurationMs, 100);
        assertEquals(clock.now(), 40);
        assertEquals(
          hby.db.tops.get([hab.pre, endpoints[0]!.eid])?.topics["/challenge"],
          0,
        );
      } finally {
        yield* waitForTaskHalt(worker);
      }
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("continuous mailbox consumer settles complete body-only mailbox records", async () => {
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
        const batches: MailboxPollBatch[] = [];
        const worker = yield* spawn(() =>
          runtime.mailboxPoller.pollDo(function*(batch) {
            yield* settleMailboxPollBatch(runtime, batch);
            batches.push(batch);
          })
        );
        try {
          yield* waitForCondition(
            () => batches.length === 1 && hby.db.tops.get([hab.pre, endpoint.eid])?.topics["/reply"] === 0,
            "Expected body-only mailbox record settlement and cursor progress.",
          );
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
          yield* waitForTaskHalt(worker);
        }
      } finally {
        yield* runtime.close();
      }
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
  const check = (role: typeof Roles.mailbox | typeof Roles.witness) =>
    run(function*(): Operation<void> {
      const hby = yield* createHabery({
        name: `mailbox-concurrency-client-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
        skipSignator: true,
      });
      const clock = new ManualRuntimeClock();
      const transport = new FakeMailboxPollTransport([{}, {}, { messages: [mailboxMessage("proxy replay")] }], clock);

      try {
        const { hab, poller, endpoints } = makePollerFixture(hby, {
          endpointCount: 2,
          clock,
          transport,
          timeouts: {
            requestOpenTimeoutMs: 20,
            maxPollDurationMs: 80,
          },
        });

        if (role === Roles.witness) {
          for (const endpoint of endpoints) {
            hby.db.ends.rem([hab.pre, Roles.mailbox, endpoint.eid]);
            hby.db.ends.pin([hab.pre, Roles.witness, endpoint.eid], { allowed: true });
          }
        }
        const proxy = makeTransferableHab(hby, "proxy");
        const proxyEndpoint = seedMailboxEndpoint(hby, proxy.pre, "proxy");
        const batches: MailboxPollBatch[] = [];
        const task = yield* spawn(() =>
          poller.pollDo((batch) => {
            batches.push(batch);
          })
        );

        try {
          yield* waitForCondition(
            () => {
              const polledEids = new Set(
                transport.polls.map((poll) => poll.endpoint.eid),
              );
              return [...endpoints, proxyEndpoint].every((endpoint) => polledEids.has(endpoint.eid))
                && hby.db.tops.get([proxy.pre, proxyEndpoint.eid])?.topics["/challenge"] === 0;
            },
            `Expected both ${role} endpoints and the later habitat to progress while earlier peers are silent.`,
          );
          assertEquals(batches.map((batch) => [batch.pre, new TextDecoder().decode(batch.messages[0])]), [[
            proxy.pre,
            "proxy replay",
          ]]);
        } finally {
          yield* waitForTaskHalt(task);
        }
      } finally {
        yield* hby.close();
      }
    });
  await check(Roles.mailbox);
  await check(Roles.witness);
});

/**
 * Proves the continuous mailbox consumer preserves local batch boundaries and
 * settles each batch far enough for challenge-response visibility.
 */
Deno.test("continuous mailbox consumer settles local mailbox batches with source boundaries", async () => {
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

      const batches: MailboxPollBatch[] = [];
      const worker = yield* spawn(() =>
        runtime.mailboxPoller.pollDo(function*(batch) {
          yield* settleMailboxPollBatch(runtime, batch);
          batches.push(batch);
        })
      );
      try {
        yield* waitForCondition(() => batches.length === 2, "Expected both local mailbox batches to settle.");
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
        yield* waitForTaskHalt(worker);
        yield* runtime.close();
      }
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("continuous mailbox polling hands off one event before requesting its sibling", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("recipient");
    const eid = "mailbox-stream";
    hby.db.locs.pin([eid, "http"], { url: "http://mailbox.test/" });
    hby.db.ends.pin([hab.pre, Roles.mailbox, eid], { allowed: true });
    const delivered = Promise.withResolvers<void>();
    let pulls = 0;
    let cancelled = false;
    const responseBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        const idx = pulls++;
        controller.enqueue(new TextEncoder().encode(`id: ${idx}\nevent: /reply\ndata: message-${idx}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const poller = new MailboxPoller(hby, new MailboxDirector(hby), {
      services: { ...defaultRuntimeServices, http: { fetch: () => Promise.resolve(new Response(responseBody)) } },
    });
    poller.registerTopic("/reply");
    const worker = yield* spawn(() =>
      poller.pollDo(function*(batch) {
        assertEquals(batch.messages.length, 1);
        delivered.resolve();
        yield* suspend(); // The consumer must finish before the next event is read.
      })
    );
    try {
      yield* call(() => delivered.promise);
      assertEquals(pulls, 1);
      assertEquals(hby.db.tops.get([hab.pre, eid])?.topics["/reply"], undefined);
    } finally {
      yield* worker.halt();
      assertEquals([cancelled, responseBody.locked], [true, false]);
      yield* hby.close(true);
    }
  });
});
