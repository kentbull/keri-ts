import { call, type Operation, run, spawn, suspend } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { findVerifiedChallengeResponse } from "../../../../src/app/identity/challenging.ts";
import { createHabery, type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import { MailboxDirector } from "../../../../src/app/mailbox/mailbox-director.ts";
import { type MailboxPollBatch, MailboxPoller } from "../../../../src/app/mailbox/mailbox-poller.ts";
import { mailboxTopicKey } from "../../../../src/app/mailbox/mailboxing.ts";
import {
  createAgentRuntime,
  runAgentRuntime,
  settleMailboxPollBatch,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { FakeRuntimeHttpClient } from "../../../support/runtime-fakes.ts";

import { runtimeTurn } from "../../../../src/app/runtime/runtime-turn.ts";
import { exchange as exchangeMessage } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { waitForTaskHalt } from "../../../effection-http.ts";
import { httpClient } from "../../../support/http-client.ts";
import { ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

/**
 * Create an accepted local signing habitat for mailbox intake tests.
 * @param hby Owner of this test's identities and accepted state.
 * @param alias Local name for the signer.
 * @returns A single-key transferable habitat.
 */
function makeTransferableHab(hby: Habery, alias: string): Hab {
  return hby.makeHab(alias, undefined, { transferable: true, icount: 1, isith: "1", ncount: 1, nsith: "1", toad: 0 });
}

/**
 * Record one authorized HTTP provider for the recipient.
 * @param hby Owner of the endpoint records.
 * @param recipientPre Recipient AID granting the mailbox role.
 * @param label Unique fixture label used in the provider URL.
 * @returns Provider identity and URL for configuring the HTTP peer.
 */
function seedMailboxEndpoint(hby: Habery, recipientPre: string, label: string): { eid: string; url: string } {
  const eid = `mailbox-${label}-${crypto.randomUUID()}`, url = `http://${label}.mailbox.test/`;
  hby.db.locs.pin([eid, "http"], { url });
  hby.db.ends.pin([recipientPre, Roles.mailbox, eid], { allowed: true });
  return { eid, url };
}

/**
 * Encode a provider event for actual SSE intake.
 * @param msg Complete UTF-8 CESR message carried by one event.
 * @param topic Mailbox topic; defaults to challenge responses.
 * @param idx Provider ordinal; defaults to the first event.
 * @returns A finite SSE response owning its encoded bytes.
 */
function mailboxResponse(msg: Uint8Array, topic = "/challenge", idx = 0): Response {
  return new Response(`id: ${idx}\nevent: ${topic}\ndata: ${new TextDecoder().decode(msg)}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Wait up to one elapsed second for an observable transition.
 * @param condition Synchronous predicate checked each runtime turn.
 * @param message Failure detail when the transition never occurs.
 */
function* waitForCondition(condition: () => boolean, message: string): Operation<void> {
  const deadline = performance.now() + 1_000;
  while (performance.now() < deadline) {
    if (condition()) return;
    yield* runtimeTurn();
  }
  throw new Error(message);
}

Deno.test("continuous mailbox consumer settles complete body-only mailbox records", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = makeTransferableHab(hby, "bob"), endpoint = seedMailboxEndpoint(hby, hab.pre, "remote");
    const http = new FakeRuntimeHttpClient();
    let available = true;
    http.registerOrigin(endpoint.url, () => {
      if (!available) return new Response(null, { status: 204 });
      available = false;
      return mailboxResponse(hab.makeEndRole(hab.pre, Roles.mailbox, true), "/reply");
    });
    const runtime = yield* createAgentRuntime(hby, http, systemClock);
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
          () => hby.db.tops.get([hab.pre, endpoint.eid])?.topics["/reply"] === 0,
          "Expected accepted mailbox input and cursor publication.",
        );
        assertEquals(batches.map(({ pre, eid, messages }) => [pre, eid, messages.length]), [[
          hab.pre,
          endpoint.eid,
          1,
        ]]);
        assertEquals(hby.db.ends.get([hab.pre, Roles.mailbox, hab.pre])?.allowed, true);
      } finally {
        yield* waitForTaskHalt(worker);
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("mailbox endpoints and later habitats progress independently of blocked HTTP peers", async () => {
  for (const role of [Roles.mailbox, Roles.witness]) {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const wits = role === Roles.witness
        ? ["one", "two"].map((name) => hby.makeHab(name, undefined, { transferable: false, ncount: 0 }))
        : [];
      const bob = hby.makeHab("bob", undefined, { wits: wits.map((wit) => wit.pre), toad: wits.length ? 1 : 0 });
      const proxy = makeTransferableHab(hby, "proxy");
      const endpoints = role === Roles.witness
        ? wits.map((wit, idx) => {
          const url = `http://witness-${idx}.mailbox.test/`;
          hby.db.locs.pin([wit.pre, "http"], { url });
          return { eid: wit.pre, url };
        })
        : [seedMailboxEndpoint(hby, bob.pre, "one"), seedMailboxEndpoint(hby, bob.pre, "two")];
      const proxyEndpoint = seedMailboxEndpoint(hby, proxy.pre, "proxy");
      const http = new FakeRuntimeHttpClient();
      let cleaned = 0, available = true;
      for (const endpoint of endpoints) {
        http.registerOrigin(endpoint.url, (request) =>
          new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => {
              cleaned++;
              reject(request.signal.reason);
            }, { once: true });
          }));
      }
      http.registerOrigin(proxyEndpoint.url, () => {
        if (!available) return new Response(null, { status: 204 });
        available = false;
        return mailboxResponse(new TextEncoder().encode("proxy replay"));
      });
      const poller = new MailboxPoller(hby, new MailboxDirector(hby), http, systemClock);
      poller.registerTopic("/challenge");
      const batches: MailboxPollBatch[] = [];
      const worker = yield* spawn(() =>
        poller.pollDo((batch) => {
          batches.push(batch);
        })
      );
      try {
        yield* waitForCondition(
          () =>
            endpoints.every(({ url }) => http.requests.some((request) => request.url === url))
            && hby.db.tops.get([proxy.pre, proxyEndpoint.eid])?.topics["/challenge"] === 0,
          "Expected independent blocked peers and accepted proxy progress.",
        );
        assertEquals(batches.map(({ pre, messages }) => [pre, new TextDecoder().decode(messages[0])]), [[
          proxy.pre,
          "proxy replay",
        ]]);
      } finally {
        yield* waitForTaskHalt(worker);
        assertEquals(cleaned, 2);
        yield* hby.close(true);
      }
    });
  }
});

Deno.test("provider runtime leaves stored local messages untouched while remote polling and direct intake process replies", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const http = new FakeRuntimeHttpClient();
    const runtime = yield* createAgentRuntime(hby, http, systemClock, { enableMailboxStore: true });
    const mbx = runtime.mailboxer;
    assertExists(mbx);
    try {
      const alice = makeTransferableHab(hby, "alice"), bob = makeTransferableHab(hby, "bob");
      const senderA = makeTransferableHab(hby, "sender-a"), senderB = makeTransferableHab(hby, "sender-b");
      const deliveries = [
        { recipient: alice, sender: senderA, words: ["able", "baker"] },
        { recipient: bob, sender: senderB, words: ["charlie", "delta"] },
      ].map(({ recipient, sender, words }) => {
        const endpoint = seedMailboxEndpoint(hby, recipient.pre, recipient.name), storedWords = [...words, "stored"];
        const msg = (responseWords: string[]) =>
          sender.endorse(
            exchangeMessage("/challenge/response", { i: sender.pre, words: responseWords }, {
              sender: sender.pre,
              recipient: recipient.pre,
            })[0],
          );
        const stored = msg(storedWords);
        mbx.storeMsg(mailboxTopicKey(recipient.pre, "/challenge"), stored);
        let available = true;
        http.registerOrigin(endpoint.url, () => {
          if (!available) return new Response(null, { status: 204 });
          available = false;
          return mailboxResponse(msg(words));
        });
        return { recipient, sender, words, storedWords, stored, endpoint };
      });
      runtime.mailboxDirector.topics.clear();
      runtime.mailboxDirector.registerTopic("/challenge");
      const worker = yield* spawn(() => runAgentRuntime(runtime));
      try {
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
      yield* hby.close(true);
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
      const poller = new MailboxPoller(hby, new MailboxDirector(hby), http, clock, {
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

Deno.test("mailbox polling includes providers and current witnesses once per shared provider history", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const wit = hby.makeHab("wit", undefined, { transferable: false, ncount: 0 });
    const shared = hby.makeHab("shared", undefined, { transferable: false, ncount: 0 });
    const hab = hby.makeHab("subject", undefined, { wits: [wit.pre, shared.pre], toad: 1 });
    const provider = seedMailboxEndpoint(hby, hab.pre, "provider");
    hby.db.ends.pin([hab.pre, Roles.mailbox, shared.pre], { allowed: true });
    const removed = seedMailboxEndpoint(hby, hab.pre, "cut");
    hby.db.ends.pin([hab.pre, Roles.mailbox, removed.eid], { allowed: false });
    const tcpOnly = seedMailboxEndpoint(hby, hab.pre, "tcp");
    hby.db.locs.rem([tcpOnly.eid, "http"]);
    hby.db.locs.pin([tcpOnly.eid, "tcp"], { url: "tcp://tcp.mailbox.test:5621" });
    const endpoints = [
      provider,
      ...[wit, shared].map((peer) => {
        const url = `https://${peer.name}.mailbox.test/`;
        hby.db.locs.pin([peer.pre, "http"], { url: "http://unpreferred.mailbox.test/" });
        hby.db.locs.pin([peer.pre, "https"], { url });
        return { eid: peer.pre, url };
      }),
    ];
    const http = new FakeRuntimeHttpClient();
    const seen: string[] = [];
    let cleaned = 0;
    for (const { eid, url } of endpoints) {
      http.registerOrigin(url, (request) =>
        new Promise<Response>((_resolve, reject) => {
          seen.push(eid);
          request.signal.addEventListener("abort", () => {
            cleaned++;
            reject(request.signal.reason);
          }, { once: true });
        }));
    }
    const poller = new MailboxPoller(hby, new MailboxDirector(hby), http, systemClock);
    poller.registerTopic("/reply");
    const worker = yield* spawn(() => poller.pollDo(function*() {}));
    try {
      yield* waitForCondition(() => seen.length === 3, "Expected every distinct provider and witness to be polled.");
      assertEquals(seen.toSorted(), endpoints.map(({ eid }) => eid).toSorted());
    } finally {
      yield* waitForTaskHalt(worker);
      assertEquals(cleaned, 3);
      yield* hby.close(true);
    }
  });
});

Deno.test("mailbox media fallback closes the refusal, reuses signed bytes and advances only after consumption", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = makeTransferableHab(hby, "recipient"), endpoint = seedMailboxEndpoint(hby, hab.pre, "legacy");
    const closing = Promise.withResolvers<void>(), closeRelease = Promise.withResolvers<void>();
    const consuming = Promise.withResolvers<void>(), consumeRelease = Promise.withResolvers<void>();
    const attempts: { type: string | null; attachment: string | null; destination: string | null; body: Uint8Array }[] =
      [];
    let closed = false;
    const http = httpClient(async (url, init) => {
      const request = new Request(url, init);
      attempts.push({
        type: request.headers.get("Content-Type"),
        attachment: request.headers.get("CESR-ATTACHMENT"),
        destination: request.headers.get("CESR-DESTINATION"),
        body: new Uint8Array(await request.arrayBuffer()),
      });
      if (attempts.length === 1) {
        const refusal = Response.json({ title: "Content type error", description: "Unacceptable content type." }, {
          status: 406,
        });
        const cancel = refusal.body!.cancel.bind(refusal.body);
        refusal.body!.cancel = async reason => {
          closing.resolve();
          await closeRelease.promise;
          await cancel(reason);
          closed = true;
        };
        return refusal;
      }
      assertEquals(closed, true, "the original response must finish closing before the alternate opens");
      return mailboxResponse(hab.makeEndRole(hab.pre, Roles.mailbox, true), "/reply");
    });
    const runtime = yield* createAgentRuntime(hby, http, systemClock);
    runtime.mailboxDirector.registerTopic("/reply");
    try {
      const worker = yield* spawn(() =>
        runtime.mailboxPoller.pollDo(function*(batch) {
          yield* settleMailboxPollBatch(runtime, batch);
          consuming.resolve();
          yield* call(() => consumeRelease.promise);
        })
      );
      try {
        yield* call(() => closing.promise);
        assertEquals(attempts.length, 1);
        closeRelease.resolve();
        yield* call(() => consuming.promise);
        assertEquals(attempts.map(attempt => attempt.type), ["application/cesr", "application/cesr+json"]);
        assertEquals(attempts[1].body, attempts[0].body);
        assertEquals(attempts[1].attachment, attempts[0].attachment);
        assertEquals(attempts.map(attempt => attempt.destination), [endpoint.eid, endpoint.eid]);
        assertEquals(hby.db.ends.get([hab.pre, Roles.mailbox, hab.pre])?.allowed, true);
        assertEquals(hby.db.tops.get([hab.pre, endpoint.eid])?.topics["/reply"], undefined);
        consumeRelease.resolve();
        yield* waitForCondition(
          () => hby.db.tops.get([hab.pre, endpoint.eid])?.topics["/reply"] === 0,
          "Expected the consumed legacy mailbox event to advance its durable cursor.",
        );
      } finally {
        closeRelease.resolve();
        consumeRelease.resolve();
        yield* waitForTaskHalt(worker);
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("mailbox authentication refusal mentioning content type does not negotiate alternate media", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = makeTransferableHab(hby, "recipient");
    seedMailboxEndpoint(hby, hab.pre, "auth-refusal");
    const types: (string | null)[] = [];
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient((_url, init) => {
        types.push(new Headers(init?.headers).get("Content-Type"));
        return Response.json(
          { title: "Authentication error", description: "Signature refused for this content type." },
          {
            status: 406,
          },
        );
      }),
      systemClock,
    );
    try {
      const worker = yield* spawn(() =>
        runtime.mailboxPoller.pollDo(function*() {
          throw new Error("A refused poll cannot deliver mailbox events");
        })
      );
      try {
        yield* waitForCondition(() => types.length >= 2, "Expected two ordinary polling windows.");
        assertEquals(types.slice(0, 2), ["application/cesr", "application/cesr"]);
      } finally {
        yield* waitForTaskHalt(worker);
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("mailbox refusal close failure propagates before any alternate submission", async () => {
  const fault = new Error("refused mailbox response close failed");
  let attempts = 0;
  const error = await assertRejects(() =>
    run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const hab = makeTransferableHab(hby, "recipient");
      seedMailboxEndpoint(hby, hab.pre, "close-failure");
      const runtime = yield* createAgentRuntime(
        hby,
        httpClient(() => {
          attempts++;
          const response = Response.json({ title: "Content type error", description: "Unacceptable content type." }, {
            status: 406,
          });
          response.body!.cancel = () => Promise.reject(fault);
          return response;
        }),
        systemClock,
      );
      try {
        yield* runtime.mailboxPoller.pollDo(function*() {
          throw new Error("The refused response cannot deliver events");
        });
      } finally {
        yield* runtime.close();
        yield* hby.close(true);
      }
    })
  );
  assertStrictEquals(error, fault);
  assertEquals(attempts, 1);
});
