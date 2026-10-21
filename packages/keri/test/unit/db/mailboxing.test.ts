import { Diger, MtrDex } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/identity/habbing.ts";
import { DatabaseNotOpenError } from "../../../src/core/errors.ts";
import { createBaser } from "../../../src/db/basing.ts";
import { createKeeper } from "../../../src/db/keeping.ts";
import { createMailboxer, Mailboxer } from "../../../src/db/mailbox/mailboxing.ts";

Deno.test("db/mailboxing - body and ordered topic publication commit together across failure and reopen", async () => {
  await run(function*() {
    const mailboxer = yield* createMailboxer({ name: `atomic-mailbox-${crypto.randomUUID()}`, temp: true });
    const first = Uint8Array.of(0xff, 0, 1), second = Uint8Array.of(0xfe, 0, 2), topic = "aid/reply";
    const digest = new Diger({ raw: Diger.digest(second, MtrDex.Blake3_256), code: MtrDex.Blake3_256 }).qb64;
    try {
      assertEquals(mailboxer.storeMsg(topic, first), true);
      assertEquals(mailboxer.storeMsg(topic, first), true, "identical bodies still publish another ordered appearance");
      assertEquals(Array.from(mailboxer.msgs.getTopItemIter()).length, 1);
      const expected: [number, string, Uint8Array][] = [[0, topic, first], [1, topic, first]];
      assertEquals(Array.from(mailboxer.cloneTopicIter(topic)), expected);
      const fault = new Error("late mailbox publication failed");
      const pin = mailboxer.msgs.pin.bind(mailboxer.msgs), append = mailboxer.appendToTopic.bind(mailboxer);
      for (const phase of ["topic", "body", "falseBody", "badOrdinal"]) {
        if (phase === "topic") {
          mailboxer.appendToTopic = (key, value) => {
            append(key, value);
            throw fault;
          };
        }
        if (phase === "body") {
          mailboxer.msgs.pin = (key, value) => {
            pin(key, value);
            throw fault;
          };
        }
        if (phase === "falseBody") mailboxer.msgs.pin = () => false;
        if (phase === "badOrdinal") mailboxer.appendToTopic = () => -1;
        try {
          const error = assertThrows(() => mailboxer.storeMsg(topic, second));
          if (phase === "topic" || phase === "body") assertStrictEquals(error, fault);
        } finally {
          mailboxer.msgs.pin = pin;
          mailboxer.appendToTopic = append;
        }
        assertEquals(Array.from(mailboxer.cloneTopicIter(topic)), expected);
        assertEquals(mailboxer.msgs.get(digest), null, "failed publication cannot leave orphan bytes");
        assertEquals(mailboxer.tpcs.cntOn(topic), 2, "failed publication cannot leave a dangling topic");
      }
      yield* mailboxer.close();
      yield* mailboxer.reopen({ reuse: true });
      assertEquals(Array.from(mailboxer.cloneTopicIter(topic)), expected);
      assertEquals(mailboxer.storeMsg(topic, second), true);
      assertEquals(Array.from(mailboxer.cloneTopicIter(topic)), [...expected, [2, topic, second]]);
      assertEquals(Array.from(mailboxer.msgs.getTopItemIter()).length, 2);
    } finally {
      yield* mailboxer.close(true);
    }
  });
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("db/mailboxing - explicit compat readonly mailbox open fails when additive sidecar is absent", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "mailboxing-compat-" });
  const name = `compat-mailbox-${crypto.randomUUID()}`;

  try {
    await run(function*() {
      const baser = yield* createBaser({
        name,
        headDirPath,
        compat: true,
      });
      const keeper = yield* createKeeper({
        name,
        headDirPath,
        compat: true,
      });
      yield* baser.close();
      yield* keeper.close();
    });

    await assertRejects(
      () =>
        run(function*() {
          yield* createMailboxer({
            name,
            headDirPath,
            compat: true,
            readonly: true,
          });
        }),
      DatabaseNotOpenError,
      "Failed to open Mailboxer",
    );
  } finally {
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("db/mailboxing - compat readonly habery open succeeds without creating missing mailbox sidecar", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "habery-compat-" });
  const name = `compat-habery-${crypto.randomUUID()}`;
  let mailboxDataPath = "";

  try {
    await run(function*() {
      const baser = yield* createBaser({
        name,
        headDirPath,
        compat: true,
      });
      const keeper = yield* createKeeper({
        name,
        headDirPath,
        compat: true,
      });
      yield* baser.close();
      yield* keeper.close();

      const mailboxer = new Mailboxer({
        name,
        headDirPath,
        compat: true,
      });
      const opened = yield* mailboxer.reopen({ readonly: true });
      assertEquals(opened, false);
      if (!mailboxer.path) {
        throw new Error("Expected mailbox probe path for compat store.");
      }
      mailboxDataPath = `${mailboxer.path}/data.mdb`;
      yield* mailboxer.close();
    });

    assertEquals(await pathExists(mailboxDataPath), false);

    await run(function*() {
      const hby = yield* createHabery({
        name,
        headDirPath,
        compat: true,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertEquals(hby.db.opened, true);
        assertEquals(hby.ks.opened, true);
      } finally {
        yield* hby.close();
      }
    });

    assertEquals(await pathExists(mailboxDataPath), false);
  } finally {
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});
