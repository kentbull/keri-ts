// @file-test-lane runtime-medium

/**
 * Focused mailbox forwarding and cursor utility tests.
 *
 * These scenarios document the smaller behavioral rules that the broader
 * mailbox runtime tests rely on:
 * - recipient resolution
 * - alias error semantics
 * - shared mailbox storage and remote cursor progression
 */
import { run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { concatBytes, SerderKERI } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes, splitCesrStream } from "../../../src/app/cesr-http.ts";
import { DELEGATE_REQUEST_ROUTE } from "../../../src/app/delegating.ts";
import { ForwardHandler, introduce, Poster } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import {
  mailboxQueryTopics,
  mailboxTopicKey,
  openMailboxerForHabery,
  updateMailboxRemoteCursor,
} from "../../../src/app/mailboxing.ts";
import { persistResolvedContact } from "../../../src/app/organizing.ts";
import { DELEGATE_MAILBOX_TOPIC } from "../../../src/core/mailbox-topics.ts";
import { makeEmbeddedExchangeMessage, makeExchangeSerder } from "../../../src/core/messages.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import type { Mailboxer } from "../../../src/db/mailboxing.ts";

/** Proves the EXN/mailbox recipient resolution order: prefix first, alias second. */
// @test-lane app-fast-parallel
Deno.test("Poster resolves exact contact aliases and raw AIDs", async () => {
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

      const poster = new Poster(hby);
      assertEquals(poster.resolveRecipient(local.pre), local.pre);
      assertEquals(poster.resolveRecipient("bob-contact"), remote.pre);
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves KERIpy-shaped alias failure messages for missing and ambiguous contacts. */
// @test-lane app-fast-parallel
Deno.test("Poster rejects missing and ambiguous contact aliases", async () => {
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

      const poster = new Poster(hby);
      assertThrows(
        () => poster.resolveRecipient("missing"),
        Error,
        "no contact found with alias 'missing'",
      );
      assertThrows(
        () => poster.resolveRecipient("shared"),
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

      const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
      const mailboxer = runtime.mailboxer;
      if (!mailboxer) {
        throw new Error("Expected indirect runtime mailboxer.");
      }
      assertEquals(runtime.mailboxDirector.mailboxer, mailboxer);
      assertEquals(runtime.poster.mailboxer, mailboxer);

      mailboxer.storeMsg(
        mailboxTopicKey(hab.pre, "/challenge"),
        new TextEncoder().encode("hello"),
      );
      assertEquals(mailboxer.tpcs.cntOn(mailboxTopicKey(hab.pre, "/challenge")), 1);

      assertEquals(
        mailboxQueryTopics(hby, hab.pre, "Bwitness", ["/challenge"])["/challenge"],
        0,
      );

      updateMailboxRemoteCursor(hby, hab.pre, "Bwitness", "/challenge", 7);
      assertEquals(
        mailboxQueryTopics(hby, hab.pre, "Bwitness", ["/challenge"])["/challenge"],
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      assertEquals(runtime.mailboxer, null);
      assertEquals(runtime.mailboxDirector.mailboxer, null);
      assertEquals(runtime.poster.mailboxer, null);
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
      const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
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
      const runtime = yield* createAgentRuntime(hby, {
        mode: "indirect",
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
// @test-lane app-fast-parallel
Deno.test("Poster.sendExchange carries embedded CESR attachments for delegation-style EXNs", async () => {
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

      const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
      try {
        ingestKeriBytes(runtime, recipient.makeLocScheme("http://127.0.0.1:9123", recipient.pre, "http"));
        ingestKeriBytes(runtime, recipient.makeEndRole(recipient.pre, EndpointRoles.mailbox, true));
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        const said = sender.kever?.said;
        if (!said) {
          throw new Error("Sender inception said is missing.");
        }
        const fn = hby.db.getFelFn(sender.pre, said);
        if (fn === null) {
          throw new Error("Sender first-seen ordinal is missing.");
        }
        const evt = hby.db.cloneEvtMsg(sender.pre, fn, said);
        const poster = new Poster(hby, { mailboxer: runtime.mailboxer });

        const { serder } = yield* poster.sendExchange(sender, {
          recipient: recipient.pre,
          route: DELEGATE_REQUEST_ROUTE,
          payload: { delpre: recipient.pre },
          embeds: { evt },
        });

        assertEquals(serder.route, DELEGATE_REQUEST_ROUTE);
        const stored = runtime.mailboxer?.getTopicMsgs(
          mailboxTopicKey(recipient.pre, DELEGATE_MAILBOX_TOPIC),
        ) ?? [];
        assertEquals(stored.length, 1);
        const delivered = new SerderKERI({ raw: stored[0]! });
        assertEquals(delivered.route, DELEGATE_REQUEST_ROUTE);
        assertEquals(delivered.ked?.a, { delpre: recipient.pre });
        assertEquals(
          ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<string, unknown>)["i"],
          sender.pre,
        );
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves EXN delivery falls back to a hosted witness mailbox when no direct or mailbox endpoints exist. */
// @test-lane app-fast-parallel
Deno.test("Poster.sendExchange falls back to local witness mailbox storage", async () => {
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

      const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
      try {
        ingestKeriBytes(
          runtime,
          witness.makeLocScheme("http://127.0.0.1:9124", witness.pre, "http"),
        );
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        const poster = new Poster(hby, { mailboxer: runtime.mailboxer });
        const { serder, deliveries } = yield* poster.sendExchange(sender, {
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
        assertEquals(new SerderKERI({ raw: stored[0]! }).route, DELEGATE_REQUEST_ROUTE);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves raw CESR delivery falls back to one witness with KERIpy-style introduction plus `/fwd`. */
// @test-lane app-fast-parallel
Deno.test("Poster.sendBytes falls back to a remote witness with introduce plus forwarded delivery", async () => {
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

        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        try {
          for (const msg of remoteHby.db.clonePreIter(remoteWitness.pre)) {
            ingestKeriBytes(runtime, msg);
          }
          ingestKeriBytes(
            runtime,
            remoteWitness.makeLocScheme(`http://127.0.0.1:${port}`, remoteWitness.pre, "http"),
          );
          yield* processRuntimeTurn(runtime, { pollMailbox: false });

          const message = sender.query(recipient.pre, sender.pre, { s: "0" }, "logs");
          const expectedIntro = splitCesrStream(introduce(sender, remoteWitness.pre));

          const poster = new Poster(hby);
          const result = yield* poster.sendBytes(sender, {
            recipient: recipient.pre,
            message,
            topic: "/receipt",
          });

          assertEquals(result.deliveries, [`http://127.0.0.1:${port}`]);
          assertEquals(bodies.slice(0, expectedIntro.length), expectedIntro);
          assertEquals(bodies.length, expectedIntro.length + 1);

          const delivered = new SerderKERI({ raw: bodies.at(-1)! });
          assertEquals(delivered.route, "/fwd");
          assertEquals(delivered.ked?.q, { pre: recipient.pre, topic: "/receipt" });
          assertEquals(
            ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<string, unknown>)["r"],
            "logs",
          );
          assertEquals(
            ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<string, unknown>)["q"],
            { s: "0", i: recipient.pre, src: sender.pre },
          );
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
// @test-lane app-fast-parallel
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      try {
        ingestKeriBytes(runtime, sender.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true));
        ingestKeriBytes(runtime, sender.makeEndRole(witness.pre, EndpointRoles.witness, true));
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        const intro = splitCesrStream(introduce(sender, remote.pre))
          .map((msg) => new SerderKERI({ raw: msg }))
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
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

/** Proves `direct` delivery mode stays strict and does not silently fall back to witnesses. */
// @test-lane app-fast-parallel
Deno.test("Poster.sendBytes with direct delivery does not fall back to witnesses", async () => {
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      try {
        ingestKeriBytes(
          runtime,
          witness.makeLocScheme("http://127.0.0.1:9126", witness.pre, "http"),
        );
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        const poster = new Poster(hby);
        yield* poster.sendBytes(sender, {
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
// @test-lane app-fast-parallel
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

      const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
      try {
        ingestKeriBytes(
          runtime,
          recipient.makeEndRole(mailboxHost.pre, EndpointRoles.mailbox, true),
        );
        ingestKeriBytes(
          runtime,
          recipient.makeEndRole(agentHost.pre, EndpointRoles.agent, true),
        );
        ingestKeriBytes(
          runtime,
          recipient.makeEndRole(controllerHost.pre, EndpointRoles.controller, true),
        );
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        const forwarded = sender.query(recipient.pre, sender.pre, { s: "0" }, "logs");
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

        runtime.mailboxDirector.withActiveMailboxAid(mailboxHost.pre, () => {
          handler.handle({ serder: wrapped.serder, attachments });
        });
        assertEquals(countStored(), 1);

        runtime.mailboxDirector.withActiveMailboxAid(agentHost.pre, () => {
          handler.handle({ serder: wrapped.serder, attachments });
        });
        assertEquals(countStored(), 2);

        runtime.mailboxDirector.withActiveMailboxAid(witnessHost.pre, () => {
          handler.handle({ serder: wrapped.serder, attachments });
        });
        assertEquals(countStored(), 3);

        runtime.mailboxDirector.withActiveMailboxAid(controllerHost.pre, () => {
          handler.handle({ serder: wrapped.serder, attachments });
        });
        assertEquals(countStored(), 3);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});
