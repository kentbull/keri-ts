import { call, type Operation, run, spawn, suspend } from "effection";
import { assertEquals, assertExists, assertStrictEquals } from "jsr:@std/assert";
import {
  createAgentRuntime,
  runAgentRuntime,
  settleMailboxPollBatch,
  settleRuntimeIngress,
} from "../../../src/app/agent-runtime.ts";
import { findVerifiedChallengeResponse } from "../../../src/app/challenging.ts";
import { httpMailboxPollTransport } from "../../../src/app/forwarding.ts";
import { type MailboxPollBatch, MailboxPoller, type MailboxPollingTimeoutPolicy } from "../../../src/app/forwarding.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import type { MailboxSseMessage } from "../../../src/app/mailbox-sse.ts";
import { mailboxDeliveryEndpoints, mailboxPollEndpoints, mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { FakeRuntimeHttpClient } from "../../support/runtime-fakes.ts";

import { runtimeTurn } from "../../../src/app/runtime-turn.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";
import { Roles } from "../../../src/core/roles.ts";
import { waitForTaskHalt } from "../../effection-http.ts";
import { httpClient } from "../../support/http-client.ts";
import { FakeMailboxPollTransport, ManualRuntimeClock } from "../../support/runtime-fakes.ts";

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
  const poller = new MailboxPoller(hby, new MailboxDirector(hby), new FetchHttpClient(), clock, transport, {
    timeouts,
  });
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
        const defaultPoller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          new FetchHttpClient(),
          systemClock,
          httpMailboxPollTransport,
          {},
        );
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
      const runtime = yield* createAgentRuntime(hby, new FakeRuntimeHttpClient(), clock, transport);
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

/** Provider storage must not become an implicit recipient inbox while remote intake runs. */
Deno.test("provider runtime leaves stored local messages untouched while remote polling and direct intake process replies", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `mailbox-provider-recipient-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const transport = new FakeMailboxPollTransport();
    const runtime = yield* createAgentRuntime(hby, new FakeRuntimeHttpClient(), systemClock, transport, {
      enableMailboxStore: true,
    });
    const mbx = runtime.mailboxer;
    assertExists(mbx);
    try {
      const alice = makeTransferableHab(hby, "alice");
      const bob = makeTransferableHab(hby, "bob");
      const senderA = makeTransferableHab(hby, "sender-a");
      const senderB = makeTransferableHab(hby, "sender-b");
      const deliveries = [
        { recipient: alice, sender: senderA, words: ["able", "baker"] },
        { recipient: bob, sender: senderB, words: ["charlie", "delta"] },
      ].map(({ recipient, sender, words }) => {
        const endpoint = seedMailboxEndpoint(hby, recipient.pre, recipient.name);
        const storedWords = [...words, "stored"];
        const msg = (responseWords: string[]) =>
          sender.endorse(
            makeExchangeSerder("/challenge/response", { i: sender.pre, words: responseWords }, {
              sender: sender.pre,
              recipient: recipient.pre,
            }),
          );
        const stored = msg(storedWords);
        mbx.storeMsg(mailboxTopicKey(recipient.pre, "/challenge"), stored);
        transport.enqueue({ messages: [mailboxBytes(msg(words))] });
        return { recipient, sender, words, storedWords, stored, endpoint };
      });
      runtime.mailboxDirector.topics.clear();
      runtime.mailboxDirector.registerTopic("/challenge");
      const worker = yield* spawn(() => runAgentRuntime(runtime));
      try {
        // Persisted remote positions prove real consumer completion, without a timed absence check.
        yield* waitForCondition(
          () =>
            deliveries.every(({ recipient, endpoint }) =>
              hby.db.tops.get([recipient.pre, endpoint.eid])?.topics["/challenge"] === 0
            ),
          "Expected both remote mailbox events to settle.",
        );
        for (const { recipient, sender, words, storedWords, stored } of deliveries) {
          assertExists(findVerifiedChallengeResponse(hby.db, sender.pre, words));
          assertEquals(findVerifiedChallengeResponse(hby.db, sender.pre, storedWords), null);
          assertEquals([...runtime.mailboxDirector.topicIter(recipient.pre, "/challenge")], [{ idx: 0, msg: stored }]);
        }

        // Explicit direct intake can process the same signed payloads without consuming provider rows.
        yield* settleRuntimeIngress(runtime, deliveries.map(({ stored }) => stored));
        for (const { recipient, sender, storedWords, stored } of deliveries) {
          assertExists(findVerifiedChallengeResponse(hby.db, sender.pre, storedWords));
          assertEquals([...runtime.mailboxDirector.topicIter(recipient.pre, "/challenge")], [{ idx: 0, msg: stored }]);
        }
      } finally {
        yield* waitForTaskHalt(worker);
      }
    } finally {
      yield* runtime.close();
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
    let cancelled = false, consumerCleaned = false;
    const responseBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        const idx = pulls++;
        controller.enqueue(new TextEncoder().encode(`id: ${idx}\nevent: /reply\ndata: message-${idx}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const poller = new MailboxPoller(
      hby,
      new MailboxDirector(hby),
      httpClient(() => Promise.resolve(new Response(responseBody))),
      systemClock,
      httpMailboxPollTransport,
      {},
    );
    poller.registerTopic("/reply");
    const worker = yield* spawn(() =>
      poller.pollDo(function*(batch) {
        assertEquals(batch.messages.length, 1);
        delivered.resolve();
        try {
          yield* suspend(); // The consumer must finish before the next event is read.
        } finally {
          yield* runtimeTurn();
          consumerCleaned = true;
        }
      })
    );
    try {
      yield* call(() => delivered.promise);
      assertEquals(pulls, 1);
      assertEquals(hby.db.tops.get([hab.pre, eid])?.topics["/reply"], undefined);
    } finally {
      yield* worker.halt();
      assertEquals([consumerCleaned, cancelled, responseBody.locked], [true, true, false]);
      yield* hby.close(true);
    }
  });
});

/** A failed event consumer must not become persisted remote progress. */
Deno.test("remote mailbox consumer failures preserve the cursor and join response cleanup", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("recipient");
    const endpoint = seedMailboxEndpoint(hby, hab.pre, "consumer-failure");
    const failure = new Error("mailbox consumer failed");
    try {
      for (const delayed of [false, true]) {
        let cancelled = false, consumed = 0, caught: unknown;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("id: 7\nevent: /reply\ndata: message\n\n"));
          },
          cancel() {
            cancelled = true;
          },
        });
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          httpClient(() => Promise.resolve(new Response(body))),
          systemClock,
          httpMailboxPollTransport,
        );
        poller.registerTopic("/reply");
        try {
          yield* call(() =>
            poller.pollDo((batch) => {
              assertEquals([batch.pre, batch.eid, batch.messages.length], [hab.pre, endpoint.eid, 1]);
              consumed++;
              if (!delayed) throw failure;
              return (function*() {
                yield* runtimeTurn();
                throw failure;
              })();
            })
          );
        } catch (error) {
          caught = error;
        }
        assertStrictEquals(caught, failure);
        assertEquals(consumed, 1);
        assertEquals(hby.db.tops.get([hab.pre, endpoint.eid]), null);
        assertEquals([cancelled, body.locked], [true, false]);
      }
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("mailbox polling normalizes positive fractional timeouts without producing zero", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const defaults = MailboxPoller.DefaultTimeoutPolicy;
      for (
        const [value, normalized] of [
          [undefined, undefined],
          [0, undefined],
          [-1, undefined],
          [NaN, undefined],
          [Infinity, undefined],
          [-Infinity, undefined],
          [0.25, 1],
          [0.999, 1],
          [1, 1],
          [1.9, 1],
          [25, 25],
          [25.9, 25],
        ] as const
      ) {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          new FetchHttpClient(),
          new ManualRuntimeClock(),
          new FakeMailboxPollTransport(),
          { timeouts: { requestOpenTimeoutMs: value, maxPollDurationMs: value } },
        );
        assertEquals(poller.timeoutPolicy, {
          requestOpenTimeoutMs: normalized ?? defaults.requestOpenTimeoutMs,
          maxPollDurationMs: normalized ?? defaults.maxPollDurationMs,
        }, `timeout override ${value}`);
      }
    } finally {
      yield* hby.close();
    }
  });
});

for (const boundary of ["headers", "SSE"] as const) {
  Deno.test(`sub-millisecond mailbox ${boundary} timeout expires at one millisecond and joins cleanup`, async () => {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const hab = hby.makeHab("recipient");
      seedMailboxEndpoint(hby, hab.pre, "minimum-timeout");
      const clock = new ManualRuntimeClock();
      let waiting = false, cleaned = false, consumed = false;
      const http = httpClient((_url, init) => {
        if (boundary === "headers") {
          waiting = true;
          return new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
          }).finally(() => {
            cleaned = true;
          });
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              waiting = true;
            },
            async cancel() {
              await Promise.resolve();
              cleaned = true;
            },
          }, { highWaterMark: 0 }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      });
      const poller = new MailboxPoller(hby, new MailboxDirector(hby), http, clock, httpMailboxPollTransport, {
        timeouts: { requestOpenTimeoutMs: 0.25, maxPollDurationMs: 0.25 },
      });
      poller.registerTopic("/reply");
      try {
        const worker = yield* spawn(() =>
          poller.pollDo(() => {
            consumed = true;
          })
        );
        try {
          yield* waitForCondition(() => waiting, `Expected a pending ${boundary} operation.`);
          clock.advance(0);
          yield* runtimeTurn();
          assertEquals(cleaned, false, "a positive timeout must not expire at time zero");
          clock.advance(1);
          yield* waitForCondition(() => cleaned, `Expected ${boundary} timeout cleanup at one millisecond.`);
          assertEquals(clock.now(), 1);
          assertEquals(consumed, false);
        } finally {
          yield* waitForTaskHalt(worker);
        }
        assertEquals(cleaned, true);
      } finally {
        yield* hby.close();
      }
    });
  });
}
