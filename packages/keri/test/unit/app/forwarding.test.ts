import { httpClient } from "../../support/http-client.ts";
/**
 * Focused mailbox forwarding and cursor utility tests.
 *
 * These scenarios document the smaller behavioral rules that the broader
 * mailbox runtime tests rely on:
 * - recipient resolution
 * - alias error semantics
 * - shared mailbox storage and remote cursor progression
 */
import { call, type Operation, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createServer } from "node:net";
import {
  collectPayload,
  concatBytes,
  framePayload,
  parseBytes,
  SerderKERI,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import {
  createAgentRuntime,
  settleRuntimeIngress,
} from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { DELEGATE_REQUEST_ROUTE } from "../../../src/app/delegating.ts";
import { createExchangeMessage } from "../../../src/app/exchange-messaging.ts";
import {
  type ExchangeDeliveryPreference,
  ForwardHandler,
  introduce,
  introductionMessages,
  mailboxTopicForRoute,
  Poster,
} from "../../../src/app/forwarding.ts";
import { createHabery, type Hab } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import {
  mailboxQueryTopics,
  mailboxTopicKey,
  openMailboxerForHabery,
  updateMailboxRemoteCursor,
} from "../../../src/app/mailboxing.ts";
import { Organizer, persistResolvedContact } from "../../../src/app/organizing.ts";
import type { Reactor } from "../../../src/app/reactor.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";

import { TCPMessenger } from "../../../src/app/tcp-messenger.ts";
import { Deck } from "../../../src/core/deck.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC, DELEGATE_MAILBOX_TOPIC } from "../../../src/core/mailbox-topics.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import type { Mailboxer } from "../../../src/db/mailboxing.ts";

/** Run the real queue worker for a finite send-only forwarding fixture. */
function* deliverMessage(postman: Poster, hab: Hab, args: {
  recipient: string;
  message: Uint8Array;
  topic?: string;
  delivery?: ExchangeDeliveryPreference;
}, reactor?: Reactor): Operation<{ deliveries: string[] }> {
  const worker = yield* spawn(() => postman.deliverDo());
  try {
    const evt = postman.send({
      src: hab.pre,
      dest: args.recipient,
      msg: args.message,
      topic: args.topic ?? "",
      delivery: args.delivery,
      replies: Boolean(reactor),
    }, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    return outcome;
  } finally {
    yield* worker.halt();
  }
}

/** Test the production EXN constructor followed by ordinary queued transmission. */
function* deliverExchange(
  postman: Poster,
  hab: Hab,
  args: Omit<Parameters<typeof createExchangeMessage>[1], "dest"> & {
    recipient: string;
    topic?: string;
    delivery?: ExchangeDeliveryPreference;
  },
) {
  const { serder, msg } = createExchangeMessage(hab, {
    ...args,
    dest: new Organizer(hab.db, null).resolveRecipient(args.recipient),
  });
  const outcome = yield* deliverMessage(postman, hab, {
    recipient: args.recipient,
    message: msg,
    topic: args.topic ?? mailboxTopicForRoute(args.route),
    delivery: args.delivery,
  });
  return { serder, deliveries: outcome.deliveries };
}

function makeExchangeSerder(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  return exchangeMessage(route, payload, args)[0];
}

function makeEmbeddedExchangeMessage(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  const [serder, attachments] = exchangeMessage(route, payload, args);
  return { serder, attachments };
}

const ACDC_FIXTURE_RAW = new TextEncoder().encode(
  "{\"v\":\"ACDC10JSON00018a_\",\"d\":\"EP5-9l2U6Nk4Tay7ZMmE2vMBbyst_wL-X-duR7_5fOYh\",\"i\":\"EAzyYT43995Tzhs4dobIxATUmE6u6MTS87zdeIUxVILK\",\"ri\":\"EC6A-9IZSURHyUHKN3kyabfwJPYeR9oQq2wcoIZAL8L2\",\"s\":\"ENLj1SXm-UWWAHjoBCSDK1XSvlZ0A-yehZFQbdbwBI4V\",\"a\":{\"d\":\"ECZxadZCtRi0BpLMb4JfTjLho40fR1BAkwOxQf2BmqJe\",\"i\":\"EJ0d1ke927FIzyF7M1xRb7n6DBhiOh4GPg8ZMZjvhbPg\",\"dt\":\"2026-06-07T02:23:37.535000+00:00\",\"role\":\"holder\"}}",
);

/** Proves KERIpy-compatible mailbox topic defaults for credential presentation routes. */
Deno.test("mailboxTopicForRoute routes IPEX exchanges to /credential", () => {
  assertEquals(mailboxTopicForRoute("/ipex/apply"), CREDENTIAL_MAILBOX_TOPIC);
  assertEquals(mailboxTopicForRoute("/ipex/offer"), CREDENTIAL_MAILBOX_TOPIC);
  assertEquals(mailboxTopicForRoute("/ipex/grant"), CREDENTIAL_MAILBOX_TOPIC);
  assertEquals(mailboxTopicForRoute("/ipex/admit"), CREDENTIAL_MAILBOX_TOPIC);
  assertEquals(mailboxTopicForRoute("/delegate/request"), DELEGATE_MAILBOX_TOPIC);
  assertEquals(mailboxTopicForRoute("/challenge/response"), "/challenge");
});

/** Proves sender-side `credential` and poll-side `/credential` share one mailbox key. */
Deno.test("mailboxTopicKey normalizes credential topic slash forms", () => {
  assertEquals(
    mailboxTopicKey("Erecipient", "credential"),
    mailboxTopicKey("Erecipient", CREDENTIAL_MAILBOX_TOPIC),
  );
});

/** Proves the EXN/mailbox recipient resolution order: prefix first, alias second. */
Deno.test("Organizer resolves exact contact aliases and raw AIDs", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `poster-resolve-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const local = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const remote = hby.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      persistResolvedContact(hby, remote.pre, {
        alias: "bob-contact",
        oobi: "http://example.test/oobi/bob/controller",
      });

      const organizer = new Organizer(hby.db, hby.signator);
      assertEquals(organizer.resolveRecipient(local.pre), local.pre);
      assertEquals(organizer.resolveRecipient("bob-contact"), remote.pre);
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves KERIpy-shaped alias failure messages for missing and ambiguous contacts. */
Deno.test("Organizer rejects missing and ambiguous contact aliases", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `poster-errors-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const remoteA = hby.makeHab("remote-a", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const remoteB = hby.makeHab("remote-b", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      persistResolvedContact(hby, remoteA.pre, { alias: "shared" });
      persistResolvedContact(hby, remoteB.pre, { alias: "shared" });

      const organizer = new Organizer(hby.db, hby.signator);
      assertThrows(
        () => organizer.resolveRecipient("missing"),
        Error,
        "no contact found with alias 'missing'",
      );
      assertThrows(
        () => organizer.resolveRecipient("shared"),
        Error,
        "multiple contacts match alias 'shared', use prefix instead",
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves runtime-owned mailbox sharing and durable `tops.` cursor semantics. */
Deno.test("Indirect runtime owns one shared Mailboxer and persists remote mailbox cursors", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `mailboxer-shared-${crypto.randomUUID()}`,
      temp: true,
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

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
      });
      const mailboxer = runtime.mailboxer;
      if (!mailboxer) {
        throw new Error("Expected indirect runtime mailboxer.");
      }
      assertEquals(runtime.mailboxDirector.mailboxer, mailboxer);
      assertEquals(runtime.postman.mbx, mailboxer);

      mailboxer.storeMsg(
        mailboxTopicKey(hab.pre, "/challenge"),
        new TextEncoder().encode("hello"),
      );
      assertEquals(
        mailboxer.tpcs.cntOn(mailboxTopicKey(hab.pre, "/challenge")),
        1,
      );

      assertEquals(
        mailboxQueryTopics(hby, hab.pre, "Bwitness", [
          "/challenge",
        ])["/challenge"],
        0,
      );
      assertEquals(
        mailboxQueryTopics(hby, hab.pre, "Bwitness", [
          CREDENTIAL_MAILBOX_TOPIC,
        ])[CREDENTIAL_MAILBOX_TOPIC],
        0,
      );

      updateMailboxRemoteCursor(hby, hab.pre, "Bwitness", "/challenge", 7);
      assertEquals(
        mailboxQueryTopics(hby, hab.pre, "Bwitness", [
          "/challenge",
        ])["/challenge"],
        8,
      );
      assertEquals(
        hby.db.tops.get([hab.pre, "Bwitness"])?.topics["/challenge"],
        7,
      );
      yield* runtime.close();
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves local runtimes stay mailbox-store-free unless callers opt in. */
Deno.test("Local runtime defaults to no provider mailbox store", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `mailboxer-local-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      assertEquals(runtime.mailboxer, null);
      assertEquals(runtime.mailboxDirector.mailboxer, null);
      assertEquals(runtime.postman.mbx, null);
      yield* runtime.close();
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Concrete registry processors share the runtime cue flow and credential topic. */
Deno.test("Runtime composes concrete registry processors and registers /credential", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `runtime-vdr-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      assertEquals(runtime.protocol.tvy, runtime.vdr!.tvy);
      assertEquals(runtime.protocol.vry, runtime.vdr!.vry);
      assertEquals(runtime.vdr!.cues, runtime.cues);
      assertEquals(
        runtime.mailboxDirector.registeredTopics().includes(CREDENTIAL_MAILBOX_TOPIC),
        true,
      );
      yield* runtime.close();
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves runtime-owned mailbox storage is closed by `runtime.close()`. */
Deno.test("Indirect runtime closes the mailboxer it opened", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `mailboxer-close-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
      });
      const mailboxer = runtime.mailboxer;
      if (!mailboxer) {
        throw new Error("Expected indirect runtime mailboxer.");
      }
      assertEquals(mailboxer.opened, true);
      yield* runtime.close();
      assertEquals(mailboxer.opened, false);
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves caller-injected mailbox storage remains caller-owned after runtime cleanup. */
Deno.test("Runtime close leaves injected mailboxers open", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `mailboxer-injected-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    let mailboxer: Mailboxer | undefined;
    try {
      mailboxer = yield* openMailboxerForHabery(hby);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
        mailboxer,
      });
      assertEquals(runtime.mailboxer, mailboxer);
      assertEquals(mailboxer.opened, true);
      yield* runtime.close();
      assertEquals(mailboxer.opened, true);
    } finally {
      if (mailboxer?.opened) {
        yield* mailboxer.close();
      }
      yield* hby.close(true);
    }
  });
});

/** Proves mailbox-first EXN delivery preserves embedded CESR payloads on the wire. */
Deno.test("Queued exchanges carries embedded CESR attachments for delegation-style EXNs", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `poster-embeds-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
      });
      try {
        yield* settleRuntimeIngress(runtime, [
          recipient.makeLocScheme(
            "http://127.0.0.1:9123",
            recipient.pre,
            "http",
          ),
          recipient.makeEndRole(recipient.pre, EndpointRoles.mailbox, true),
        ]);

        const said = sender.kever?.said;
        if (!said) {
          throw new Error("Sender inception said is missing.");
        }
        const fn = hby.db.getFelFn(sender.pre, said);
        if (fn === null) {
          throw new Error("Sender first-seen ordinal is missing.");
        }
        const evt = hby.db.cloneEvtMsg(sender.pre, fn, said);
        const postman = new Poster(hby, runtime.mailboxer, null, runtime.http, runtime.clock);

        const { serder } = yield* deliverExchange(postman, sender, {
          recipient: recipient.pre,
          exchangeRecipient: null,
          route: DELEGATE_REQUEST_ROUTE,
          payload: { delpre: recipient.pre },
          embeds: { evt },
        });

        assertEquals(serder.route, DELEGATE_REQUEST_ROUTE);
        assertEquals(serder.ked?.rp, "");
        const stored = runtime.mailboxer?.getTopicMsgs(
          mailboxTopicKey(recipient.pre, DELEGATE_MAILBOX_TOPIC),
        ) ?? [];
        assertEquals(stored.length, 1);
        const delivered = new SerderKERI({ raw: stored[0]! });
        assertEquals(delivered.route, DELEGATE_REQUEST_ROUTE);
        assertEquals(delivered.ked?.rp, "");
        assertEquals(delivered.ked?.a, { delpre: recipient.pre });
        assertEquals(
          ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
            string,
            unknown
          >)["i"],
          sender.pre,
        );

        // A workflow can retain the actual proposal while delivery borrows its exact signed bytes.
        const [prepared, paths] = exchangeMessage(DELEGATE_REQUEST_ROUTE, { delpre: recipient.pre }, {
          sender: sender.pre,
          recipient: recipient.pre,
          embeds: { evt },
        });
        const message = concatBytes(sender.endorse(prepared, { pipelined: false }), paths);
        const sent = yield* deliverMessage(postman, sender, {
          recipient: recipient.pre,
          message,
          topic: DELEGATE_MAILBOX_TOPIC,
        });
        assertEquals(sent.deliveries.length, 1);
        const preparedDelivery = runtime.mailboxer?.getTopicMsgs(
          mailboxTopicKey(recipient.pre, DELEGATE_MAILBOX_TOPIC),
        ) ?? [];
        assertEquals(preparedDelivery.length, 2);
        assertEquals(preparedDelivery[1], message);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves IPEX delivery defaults to the credential mailbox topic without caller override. */
Deno.test("Queued exchanges defaults IPEX delivery to /credential", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `poster-ipex-topic-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
      });
      try {
        yield* settleRuntimeIngress(runtime, [
          recipient.makeLocScheme(
            "http://127.0.0.1:9126",
            recipient.pre,
            "http",
          ),
          recipient.makeEndRole(recipient.pre, EndpointRoles.mailbox, true),
        ]);

        const postman = new Poster(hby, runtime.mailboxer, null, runtime.http, runtime.clock);
        const { serder } = yield* deliverExchange(postman, sender, {
          recipient: recipient.pre,
          route: "/ipex/grant",
          payload: { m: "grant" },
        });

        assertEquals(serder.route, "/ipex/grant");
        const stored = runtime.mailboxer?.getTopicMsgs(
          mailboxTopicKey(recipient.pre, CREDENTIAL_MAILBOX_TOPIC),
        ) ?? [];
        assertEquals(stored.length, 1);
        assertEquals(new SerderKERI({ raw: stored[0]! }).route, "/ipex/grant");
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("ForwardHandler stores forwarded ACDC support payloads", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `forward-acdc-support-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    let mailboxer: Mailboxer | undefined;
    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const provider = hby.makeHab("provider", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      mailboxer = yield* openMailboxerForHabery(hby);
      const director = new MailboxDirector(hby, { mailboxer });
      const handler = new ForwardHandler(director);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        mailboxer,
      });
      try {
        yield* settleRuntimeIngress(runtime, [recipient.makeEndRole(provider.pre, EndpointRoles.mailbox, true)]);

        const [serder, rawAttachments] = exchangeMessage("/fwd", {}, {
          sender: sender.pre,
          modifiers: {
            pre: recipient.pre,
            topic: CREDENTIAL_MAILBOX_TOPIC,
          },
          embeds: { evt: ACDC_FIXTURE_RAW },
        });
        const attachments = [{
          raw: rawAttachments,
          text: new TextDecoder().decode(rawAttachments),
        }];

        assertEquals(handler.verify({ serder, attachments }), true);
        // Endpoint provenance travels with this dispatch, across any async suspension.
        handler.handle({ serder, attachments, mailboxAid: provider.pre });

        const stored = mailboxer!.getTopicMsgs(
          mailboxTopicKey(recipient.pre, CREDENTIAL_MAILBOX_TOPIC),
        );
        assertEquals(stored.length, 1);
        assertEquals(stored[0], ACDC_FIXTURE_RAW);
      } finally {
        yield* runtime.close();
      }
    } finally {
      if (mailboxer?.opened) {
        yield* mailboxer.close();
      }
      yield* hby.close(true);
    }
  });
});

/** Proves EXN delivery falls back to a hosted witness mailbox when no direct or mailbox endpoints exist. */
Deno.test("Queued exchanges falls back to local witness mailbox storage", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `poster-local-witness-exn-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const witness = hby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
      });
      try {
        yield* settleRuntimeIngress(runtime, [witness.makeLocScheme("http://127.0.0.1:9124", witness.pre, "http")]);

        const postman = new Poster(hby, runtime.mailboxer, null, runtime.http, runtime.clock);
        const { serder, deliveries } = yield* deliverExchange(postman, sender, {
          recipient: recipient.pre,
          route: DELEGATE_REQUEST_ROUTE,
          payload: { delpre: recipient.pre },
        });

        assertEquals(deliveries, ["http://127.0.0.1:9124"]);
        assertEquals(serder.route, DELEGATE_REQUEST_ROUTE);
        const stored = runtime.mailboxer?.getTopicMsgs(
          mailboxTopicKey(recipient.pre, DELEGATE_MAILBOX_TOPIC),
        ) ?? [];
        assertEquals(stored.length, 1);
        assertEquals(
          new SerderKERI({ raw: stored[0]! }).route,
          DELEGATE_REQUEST_ROUTE,
        );
        const mailboxer = runtime.mailboxer!;
        const publish = mailboxer.storeMsg;
        mailboxer.storeMsg = () => false;
        try {
          yield* call(() =>
            assertRejects(
              () =>
                run(() =>
                  deliverMessage(postman, sender, {
                    recipient: recipient.pre,
                    topic: DELEGATE_MAILBOX_TOPIC,
                    message: stored[0]!,
                  })
                ),
              Error,
              "publication did not complete",
            )
          );
        } finally {
          mailboxer.storeMsg = publish;
        }
        assertEquals(mailboxer.getTopicMsgs(mailboxTopicKey(recipient.pre, DELEGATE_MAILBOX_TOPIC)).length, 1);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves raw CESR delivery falls back to one witness with KERIpy-style introduction plus `/fwd`. */
Deno.test("Queued CESR falls back to a remote witness with introduce plus forwarded delivery", async () => {
  const bodies: Uint8Array[] = [];
  const controller = new AbortController();
  const port = 9125;
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port,
    signal: controller.signal,
  }, async (request) => {
    bodies.push(await readCesrRequestBytes(request));
    return new Response(null, { status: 204 });
  });

  try {
    await run(function*() {
      const hby = yield* createHabery({
        name: `poster-remote-witness-bytes-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });
      const remoteHby = yield* createHabery({
        name: `poster-remote-peer-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });

      try {
        const sender = hby.makeHab("sender", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const remoteWitness = remoteHby.makeHab("remote-witness", undefined, {
          transferable: false,
          icount: 1,
          isith: "1",
          toad: 0,
        });
        const recipient = hby.makeHab("recipient", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          wits: [remoteWitness.pre],
          toad: 1,
        });

        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        try {
          for (const msg of remoteHby.db.clonePreIter(remoteWitness.pre)) {
            yield* settleRuntimeIngress(runtime, [msg]);
          }
          yield* settleRuntimeIngress(runtime, [remoteWitness.makeLocScheme(
            `http://127.0.0.1:${port}`,
            remoteWitness.pre,
            "http",
          )]);

          const message = sender.query(
            recipient.pre,
            sender.pre,
            { route: "logs", q: { s: "0" } },
          );
          const expectedIntro = introduce(sender, remoteWitness.pre);
          const introduction = yield* call(() => parseBytes(expectedIntro));
          const frameCount = introduction.length;

          const postman = new Poster(hby, null, runtime.protocol, runtime.http, runtime.clock);
          const result = yield* deliverMessage(postman, sender, {
            recipient: recipient.pre,
            message,
            topic: "/receipt",
          });

          assertEquals(result.deliveries, [`http://127.0.0.1:${port}`]);
          // Compare against original signed wire independently of the transport serializer.
          assertEquals(concatBytes(...bodies.slice(0, frameCount)), expectedIntro);
          assertEquals(bodies.length, frameCount + 1);

          const delivered = new SerderKERI({ raw: bodies.at(-1)! });
          assertEquals(delivered.route, "/fwd");
          assertEquals(delivered.ked?.q, {
            pre: recipient.pre,
            topic: "receipt",
          });
          assertEquals(
            ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
              string,
              unknown
            >)["r"],
            "logs",
          );
          assertEquals(
            ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
              string,
              unknown
            >)["q"],
            { s: "0", i: recipient.pre, src: sender.pre },
          );
          const receiptKey = dgKey(sender.pre, sender.kever!.said);
          const receipt = remoteWitness.receipt(sender.kever!.serder);
          let connections = 0;
          const tcpBodies: Uint8Array[][] = [];
          const transmitReceived = Promise.withResolvers<void>();
          const tcp = createServer({ allowHalfOpen: true }, (socket) => {
            const connection = ++connections;
            const chunks: Uint8Array[] = [];
            tcpBodies.push(chunks);
            socket.on("error", () => {});
            socket.on("data", (chunk) => chunks.push(new Uint8Array(chunk)));
            // A real signed receipt travels independently of the prepared upload's framing.
            socket.write(receipt);
            socket.once("end", () => {
              socket.end();
              if (connection === 3) transmitReceived.resolve();
            });
          });
          yield* call(() => new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve)));
          try {
            const addr = tcp.address();
            if (!addr || typeof addr === "string") throw new Error("Expected TCP endpoint");
            const url = `tcp://127.0.0.1:${addr.port}`;
            hby.db.locs.pin([remoteWitness.pre, "tcp"], { url });
            const preferred = yield* deliverMessage(postman, sender, {
              recipient: recipient.pre,
              message,
              topic: "/receipt",
            });
            assertEquals(
              preferred.deliveries,
              [`http://127.0.0.1:${port}`],
              "HTTP remains preferred when TCP is also advertised",
            );
            hby.db.locs.rem([remoteWitness.pre, "http"]);
            const sent = yield* deliverMessage(postman, sender, {
              recipient: recipient.pre,
              message,
              topic: "/receipt",
            }, runtime.reactor);
            assertEquals(sent.deliveries, [url]);
            assertEquals(hby.db.rcts.get(receiptKey).length, 1, "explicit receiver persists the same-socket receipt");
            assertEquals(concatBytes(...tcpBodies[0]).subarray(0, expectedIntro.length), expectedIntro);
            const uploaded = yield* call(() => parseBytes(concatBytes(...tcpBodies[0])));
            const forwarded = uploaded.at(-1)!.body;
            if (!(forwarded instanceof SerderKERI)) throw new Error("Expected signed forwarded EXN");
            assertEquals(forwarded.route, "/fwd");
            assertEquals(forwarded.ked?.q, delivered.ked?.q);
            assertEquals(forwarded.ked?.e, delivered.ked?.e);
            hby.db.rcts.rem(receiptKey);
            runtime.respondant.enqueueCue(
              sender,
              new Deck([{ kin: "replay", msgs: [message], src: sender.pre, dest: recipient.pre }]),
            );

            for (let pass = 0; pass < 4 && runtime.postman.hasPending; pass++) yield* runtime.postman.process();
            assertEquals(runtime.postman.hasPending, false);
            assertEquals(hby.db.rcts.get(receiptKey).length, 1, "actual queue caller lends its receiver");
            assertEquals(concatBytes(...tcpBodies[1]).subarray(0, expectedIntro.length), expectedIntro);

            hby.db.rcts.rem(receiptKey);
            yield* new TCPMessenger(null, runtime.clock).send(url, message);
            assertEquals(hby.db.rcts.get(receiptKey).length, 0, "standalone target is intentionally transmit-only");
            // Local transmission may complete before the remote application accepts the socket.
            yield* call(() => transmitReceived.promise);
            assertEquals(concatBytes(...tcpBodies[2]), message);
          } finally {
            yield* call(() =>
              new Promise<void>((resolve, reject) => tcp.close((error) => error ? reject(error) : resolve()))
            );
          }
        } finally {
          yield* runtime.close();
        }
      } finally {
        yield* remoteHby.close(true);
        yield* hby.close(true);
      }
    });
  } finally {
    controller.abort();
    try {
      await server.finished;
    } catch {
      // Abort-driven shutdown is expected here.
    }
  }
});

/** Proves KERIpy-style introduction carries all sender end-role replies. */
Deno.test("introduce includes mailbox and witness end-role replies when both are known", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `introduce-end-roles-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [],
        toad: 0,
      });
      const mailbox = hby.makeHab("mailbox", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const witness = hby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const remote = hby.makeHab("remote", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        yield* settleRuntimeIngress(runtime, [
          sender.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
          sender.makeEndRole(witness.pre, EndpointRoles.witness, true),
        ]);

        const expected = concatBytes(
          ...hby.db.clonePreIter(sender.pre),
          ...hby.db.cloneDelegation(sender.kever!),
          sender.replyEndRole(sender.pre),
        );
        assertEquals(introduce(sender, remote.pre), expected);
        assertEquals(concatBytes(...introductionMessages(sender, remote.pre)), expected);
        const collect = sender.replyEndRole;
        sender.replyEndRole = () => {
          throw new Error("finite endpoint collector must not run");
        };
        try {
          assertEquals(introduce(sender, remote.pre), expected);
        } finally {
          sender.replyEndRole = collect;
        }
        const intro = (yield* call(() => parseBytes(introduce(sender, remote.pre))))
          .map(({ body }) => body as SerderKERI)
          .filter((serder) => serder.ilk === "rpy")
          .map((serder) => ({
            route: serder.route,
            role: (serder.ked?.a as Record<string, unknown> | undefined)?.role,
            eid: (serder.ked?.a as Record<string, unknown> | undefined)?.eid,
          }));

        assertEquals(
          intro.some((entry) =>
            entry.route === "/end/role/add"
            && entry.role === EndpointRoles.mailbox
            && entry.eid === mailbox.pre
          ),
          true,
        );
        assertEquals(
          intro.some((entry) =>
            entry.route === "/end/role/add"
            && entry.role === EndpointRoles.witness
            && entry.eid === witness.pre
          ),
          true,
        );
        yield* settleRuntimeIngress(runtime, [remote.receipt(sender.kever!.serder)]);
        const capture = hby.db.replay;
        hby.db.replay = () => {
          throw new Error("suppressed introduction must not capture");
        };
        try {
          assertEquals(introduce(sender, remote.pre).length, 0);
        } finally {
          hby.db.replay = capture;
        }
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves `direct` delivery mode stays strict and does not silently fall back to witnesses. */
Deno.test("Queued CESR with direct delivery does not fall back to witnesses", async () => {
  const attempt = run(function*() {
    const hby = yield* createHabery({
      name: `poster-direct-strict-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const witness = hby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        yield* settleRuntimeIngress(runtime, [witness.makeLocScheme("http://127.0.0.1:9126", witness.pre, "http")]);

        const postman = new Poster(hby, null, null, new FetchHttpClient(), systemClock);
        yield* deliverMessage(postman, sender, {
          recipient: recipient.pre,
          message: new Uint8Array([9]),
          topic: "/receipt",
          delivery: "direct",
        });
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });

  await assertRejects(
    () => attempt,
    Error,
    "No end roles for",
  );
});

/** Proves inbound `/fwd` storage accepts mailbox-like hosts but not controller-only hosts. */
Deno.test("ForwardHandler accepts mailbox, witness, and agent hosts but rejects controller-only hosts", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `forward-handler-host-types-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const mailboxHost = hby.makeHab("mailbox-host", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const agentHost = hby.makeHab("agent-host", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controllerHost = hby.makeHab("controller-host", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const witnessHost = hby.makeHab("witness-host", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witnessHost.pre],
        toad: 1,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        enableMailboxStore: true,
      });
      try {
        yield* settleRuntimeIngress(runtime, [
          recipient.makeEndRole(mailboxHost.pre, EndpointRoles.mailbox, true),
          recipient.makeEndRole(agentHost.pre, EndpointRoles.agent, true),
          recipient.makeEndRole(
            controllerHost.pre,
            EndpointRoles.controller,
            true,
          ),
        ]);

        const forwarded = sender.query(
          recipient.pre,
          sender.pre,
          { route: "logs", q: { s: "0" } },
        );
        const wrapped = makeEmbeddedExchangeMessage("/fwd", {}, {
          sender: sender.pre,
          modifiers: { pre: recipient.pre, topic: "/receipt" },
          embeds: { evt: forwarded },
        });
        const handler = new ForwardHandler(runtime.mailboxDirector);
        const attachments = [{
          raw: wrapped.attachments,
          text: new TextDecoder().decode(wrapped.attachments),
        }];
        const countStored = () =>
          runtime.mailboxer?.getTopicMsgs(
            mailboxTopicKey(recipient.pre, "/receipt"),
          ).length ?? 0;

        handler.handle({ serder: wrapped.serder, attachments, mailboxAid: mailboxHost.pre });
        assertEquals(countStored(), 1);

        handler.handle({ serder: wrapped.serder, attachments, mailboxAid: agentHost.pre });
        assertEquals(countStored(), 2);

        handler.handle({ serder: wrapped.serder, attachments, mailboxAid: witnessHost.pre });
        assertEquals(countStored(), 3);

        handler.handle({ serder: wrapped.serder, attachments, mailboxAid: controllerHost.pre });
        assertEquals(countStored(), 3);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Real HTTP targets report partial/total failures without claiming durable enqueue. */
Deno.test("Poster mailbox sends report partial failure and complete only after every target succeeds", async () => {
  let mode: "partial" | "failed" | "success" = "partial";
  const requests: string[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
    await request.arrayBuffer();
    const path = new URL(request.url).pathname;
    requests.push(path);
    return new Response(null, { status: mode === "success" || (mode === "partial" && path === "/good") ? 204 : 503 });
  });
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: `send-result-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      const peer = yield* createHabery({ name: `send-peer-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
        for (const name of ["good", "bad"]) {
          const mailbox = peer.makeHab(name, undefined, { transferable: false });
          yield* runtime.reactor.processBytes(concatBytes(...peer.db.clonePreIter(mailbox.pre)));
          yield* runtime.reactor.processBytes(
            mailbox.makeLocScheme(`http://127.0.0.1:${server.addr.port}/${name}`, mailbox.pre, "http"),
          );
          yield* runtime.reactor.processBytes(recipient.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true));
        }
        const message = concatBytes(...hby.db.clonePreIter(sender.pre));
        for (const kind of ["raw", "exchange"]) {
          const send = () =>
            kind === "raw"
              ? deliverMessage(runtime.postman, sender, { recipient: recipient.pre, message, topic: "/receipt" })
              : deliverExchange(runtime.postman, sender, {
                recipient: recipient.pre,
                route: "/challenge/response",
                payload: {},
              });
          for (const outcome of ["partial", "failed"] as const) {
            mode = outcome;
            requests.length = 0;
            // Introduction and forwarded frames use separate POSTs; endpoint coverage is the invariant.
            const error = yield* call(() => assertRejects(() => run(send)));
            assertEquals([...new Set(requests)].sort(), ["/bad", "/good"]);
            const retained = runtime.postman.failures.at(-1)!;
            assertEquals(retained.error, error);
            assertEquals(
              retained.deliveries.map((url) => new URL(url).pathname),
              outcome === "partial" ? ["/good"] : [],
            );
          }
          mode = "success";
          requests.length = 0;
          const result = yield* send();
          assertEquals(result.deliveries.length, 2);
          assertEquals([...new Set(requests)].sort(), ["/bad", "/good"]);
        }
      } finally {
        yield* runtime.close();
        yield* peer.close(true);
        yield* hby.close(true);
      }
    });
  } finally {
    await server.shutdown();
  }
});

Deno.test("Poster prepares qualified legacy and v2 messages with their actual forwarding shape", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
      const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const provider = remote.makeHab("provider", undefined, { transferable: false });
        const forwardedFrames: ReturnType<typeof parseBytes> = [];
        const http = httpClient(async (url, init) => {
          const [frame] = parseBytes(await readCesrRequestBytes(new Request(url, init)));
          if (frame.body instanceof SerderKERI && frame.body.route === "/fwd") forwardedFrames.push(frame);
          return new Response(null, { status: 204 });
        });
        const postman = new Poster(hby, null, null, http, systemClock);
        hby.db.ends.pin([recipient.pre, EndpointRoles.mailbox, provider.pre], { allowed: true });
        hby.db.locs.pin([provider.pre, "https"], { url: "https://mailbox.test/" });
        for (const version of [Vrsn_1_0, Vrsn_2_0]) {
          const [body] = exchangeMessage("/application/message", { value: "retained" }, {
            sender: sender.pre,
            pvrsn: version,
          });
          const [child] = parseBytes(sender.endorse(body, { pipelined: false, gvrsn: version }));
          const message = yield* call(() => collectPayload(framePayload(child)));
          forwardedFrames.length = 0;
          const evt = postman.send({ src: sender.pre, dest: recipient.pre, topic: "/credential", msg: message }, {
            notify: true,
          });
          // Source signatures precede rotation; only the outer delivery is constructed later.
          sender.rotate();
          yield* postman.process();
          assertEquals((yield* postman.wait(evt)).kin, "sent");
          const forwarded = forwardedFrames.at(-1);
          if (!forwarded) throw new Error("Expected the queued forwarding POST");
          assertEquals((forwarded.body as SerderKERI).route, "/fwd");
          assertEquals(forwarded.body.ked!.q, { pre: recipient.pre, topic: "credential" });
          if (version.major === 2) {
            assertEquals(forwarded.nests!.length, 1);
            assertEquals(forwarded.nests![0].body.raw, body.raw);
            assertEquals(forwarded.nests![0].attachments.map((a) => a.raw), child.attachments.map((a) => a.raw));
          } else {
            assertEquals((forwarded.body.ked!.e as { evt: unknown }).evt, body.ked);
          }
        }
      } finally {
        yield* remote.close(true);
      }
    } finally {
      yield* hby.close(true);
    }
  });
});
