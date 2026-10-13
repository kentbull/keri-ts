import { run } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { DatabaseNotOpenError } from "../../../src/core/errors.ts";
import { createBaser } from "../../../src/db/basing.ts";
import { createKeeper } from "../../../src/db/keeping.ts";
import { createMailboxer, Mailboxer } from "../../../src/db/mailboxing.ts";

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
