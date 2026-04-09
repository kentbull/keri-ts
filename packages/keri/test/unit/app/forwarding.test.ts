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
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { Poster } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import {
  mailboxQueryTopics,
  mailboxTopicKey,
  openMailboxerForHabery,
  updateMailboxRemoteCursor,
} from "../../../src/app/mailboxing.ts";
import { persistResolvedContact } from "../../../src/app/organizing.ts";
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
