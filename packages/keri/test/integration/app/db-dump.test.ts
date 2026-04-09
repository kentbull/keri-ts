/**
 * Integration coverage for selective LMDB dumping.
 *
 * The mailbox architecture docs now point maintainers at `tufa db dump` as the
 * shortest path to understanding protocol, mailbox, and outbox state. These
 * tests keep that debugging seam honest.
 */
// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { b } from "../../../../cesr/mod.ts";
import { dumpDatabase } from "../../../src/app/cli/db-dump.ts";
import { createBaser } from "../../../src/db/basing.ts";
import { createKeeper, PrePrm } from "../../../src/db/keeping.ts";
import { createMailboxer } from "../../../src/db/mailboxing.ts";
import { createOutboxer } from "../../../src/db/outboxing.ts";
import { CLITestHarness } from "../../../test/utils.ts";

/** Capture stdout/stderr from one `db dump` invocation for assertion. */
async function captureDump(args: Record<string, unknown>): Promise<{
  output: string[];
  errors: string[];
}> {
  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() => dumpDatabase(args));
    return {
      output: harness.getOutput(),
      errors: harness.getErrors(),
    };
  } finally {
    harness.restoreOutput();
  }
}

/** Proves summary and focused dumping for protocol-state `Baser` stores. */
Deno.test({
  name: "Integration: db dump supports baser summaries and focused subdb targets",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const name = `db-dump-baser-${crypto.randomUUID()}`;

    await run(function*() {
      const baser = yield* createBaser({
        name,
        temp: true,
        reopen: true,
        readonly: false,
      });

      try {
        assertEquals(baser.putEvt(b("evt.0001"), b("sample event payload")), true);
        baser.locs.pin(["eid1", "http"], { url: "http://127.0.0.1:8080/oobi" });
      } finally {
        yield* baser.close();
      }
    });

    const summary = await captureDump({
      name,
      temp: true,
      target: "baser",
    });

    assertEquals(summary.errors.length, 0);
    assert(summary.output.some((line) => line.includes("Domain summary for baser")));
    assert(summary.output.some((line) => line.includes("baser.evts")));
    assert(summary.output.some((line) => line.includes("baser.locs")));

    const focused = await captureDump({
      name,
      temp: true,
      target: "baser.locs",
    });

    assertEquals(focused.errors.length, 0);
    assert(focused.output.some((line) => line.includes("Target: baser.locs")));
    assert(focused.output.some((line) => line.includes("\"url\": \"http://127.0.0.1:8080/oobi\"")));
  },
});

/** Proves mailboxer and outboxer inspection for mailbox debugging workflows. */
Deno.test({
  name: "Integration: db dump supports mailboxer and outboxer targets",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const name = `db-dump-mailbox-${crypto.randomUUID()}`;

    await run(function*() {
      const mailboxer = yield* createMailboxer({
        name,
        temp: true,
        reopen: true,
        readonly: false,
      });
      const outboxer = yield* createOutboxer({
        name,
        temp: true,
        reopen: true,
        readonly: false,
      });

      try {
        mailboxer.storeMsg("recipient/challenge", b("challenge payload"));
        outboxer.queueMessage(
          "EABC123",
          b("signed exn payload"),
          {
            sender: "sender1",
            recipient: "recipient1",
            topic: "/challenge",
            createdAt: "2026-04-05T12:00:00.000000+00:00",
          },
          ["mailbox1"],
        );
      } finally {
        yield* mailboxer.close();
        yield* outboxer.close();
      }
    });

    const mailboxDump = await captureDump({
      name,
      temp: true,
      target: "mailboxer.msgs",
    });

    assertEquals(mailboxDump.errors.length, 0);
    assert(mailboxDump.output.some((line) => line.includes("Target: mailboxer.msgs")));
    assert(mailboxDump.output.some((line) => line.includes("challenge payload")));

    const outboxDump = await captureDump({
      name,
      temp: true,
      target: "outboxer.tgts",
    });

    assertEquals(outboxDump.errors.length, 0);
    assert(outboxDump.output.some((line) => line.includes("Target: outboxer.tgts")));
    assert(outboxDump.output.some((line) => line.includes("\"status\": \"pending\"")));
    assert(outboxDump.output.some((line) => line.includes("\"eid\": \"mailbox1\"")));
  },
});

/** Proves keeper-domain inspection still works alongside newer mailbox domains. */
Deno.test({
  name: "Integration: db dump supports keeper targets for keystore debugging",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const name = `db-dump-keeper-${crypto.randomUUID()}`;

    await run(function*() {
      const keeper = yield* createKeeper({
        name,
        temp: true,
        reopen: true,
        readonly: false,
      });
      try {
        keeper.gbls.pin("aeid", "BExampleAeid");
        keeper.prms.pin(
          "controller1",
          new PrePrm({
            pidx: 1,
            algo: "salty",
            salt: "0AAABBBCCC",
            stem: "signify:aid",
            tier: "low",
          }),
        );
      } finally {
        yield* keeper.close();
      }
    });

    const keeperDump = await captureDump({
      name,
      temp: true,
      target: "keeper.prms",
    });

    assertEquals(keeperDump.errors.length, 0);
    assert(keeperDump.output.some((line) => line.includes("Target: keeper.prms")));
    assert(keeperDump.output.some((line) => line.includes("\"algo\": \"salty\"")));
    assert(keeperDump.output.some((line) => line.includes("\"stem\": \"signify:aid\"")));
  },
});
