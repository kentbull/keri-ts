import { collectPayload, MemoryPayloadSink, type Payload } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { createLMDBer, type LMDBer } from "../../../src/db/core/lmdber.ts";
import { PayloadArchive } from "../../../src/db/payload-archive.ts";
import { type FilePayload, PayloadStore } from "../../../src/db/payload-store.ts";

/** Collect names only for the tiny directory fixtures asserted by these tests. */
async function names(path: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(path)) names.push(entry.name);
  return names;
}

/** Keep the database open across async filesystem operations, then close both owners. */
async function withArchive(test: (archive: PayloadArchive, db: LMDBer, root: string) => Promise<void>): Promise<void> {
  await run(function*() {
    const db = yield* createLMDBer({ name: `payload-${crypto.randomUUID()}`, temp: true });
    const root = join(db.path!, "payloads");
    const archive = yield* call(() => PayloadArchive.open(db, root));
    try {
      yield* call(() => test(archive, db, root));
    } finally {
      yield* call(() => archive.close());
      yield* db.close(true);
    }
  });
}

/** Split tiny fixture bytes across writes so publication also exercises bounded readers. */
async function stage(store: PayloadStore, bytes = [1, 2, 3]): Promise<FilePayload> {
  const sink = await store.stage();
  await sink.write(new Uint8Array(bytes.slice(0, 1)));
  await sink.write(new Uint8Array(bytes.slice(1)));
  return await sink.finish();
}

Deno.test("payload archive publishes immutable references and revokes stale disposal", async () => {
  await withArchive(async (archive, db, root) => {
    const payload = await stage(archive.files);
    let commits = 0;
    const saved = await archive.publish("essr/said", payload, () => {
      commits++;
    });
    await payload.discard(); // Publication owns the file; request cleanup cannot delete it.
    assertEquals(await collectPayload(saved), new Uint8Array([1, 2, 3]));
    await assertRejects(() => payload.promote("unused"), Error, "transferred");
    const duplicate = await stage(archive.files);
    await archive.publish("essr/said", duplicate, () => {
      commits++;
    });
    await archive.publish("essr/said", payload); // The original handle is safe to resubmit.
    assertEquals(commits, 2);
    assertEquals((await names(join(root, "objects"))).length, 1);
    assertEquals(await names(join(root, "staging")), []);
    const conflict = await stage(archive.files, [1, 9, 3]);
    await assertRejects(() => archive.publish("essr/said", conflict), Error, "different bytes");
    await conflict.discard(); // Cleanup is harmless after archive admission consumed the candidate.
    await archive.close();
    await assertRejects(() => archive.get("essr/said"), Error, "closed");
    assertThrows(() => archive.publish("essr/other", payload), Error, "closed");
    const reopened = await PayloadArchive.open(db, root);
    try {
      assertEquals(await collectPayload((await reopened.get("essr/said"))!), new Uint8Array([1, 2, 3]));
      await reopened.remove("essr/said");
      assertEquals(await reopened.get("essr/said"), null);
      assertEquals(await names(join(root, "objects")), []);
    } finally {
      await reopened.close();
    }
  });
});

Deno.test("payload archive recovers orphan stages and rolled-back publication", async () => {
  await withArchive(async (archive, db, root) => {
    const retained = await stage(archive.files, [7]);
    await archive.publish("wire/retained", retained);
    const failed = await stage(archive.files, [8]);
    await assertRejects(
      () =>
        archive.publish("wire/failed", failed, () => {
          throw new Error("commit failed");
        }),
      Error,
      "commit failed",
    );
    assertEquals((await names(join(root, "objects"))).length, 1);
    const orphan = await stage(archive.files, [9]);
    await orphan.promote(orphan.id); // Model interruption after file flush, before reference publication.
    await stage(archive.files, [10]); // Also recover an interrupted unclaimed stage.
    assertEquals(await archive.get("wire/failed"), null);
    assertEquals((await names(join(root, "objects"))).length, 2);
    await archive.close();
    const recovered = await PayloadArchive.open(db, root);
    try {
      assertEquals(await names(join(root, "staging")), []);
      assertEquals(await names(join(root, "objects")), [retained.id]);
      assertEquals(await collectPayload((await recovered.get("wire/retained"))!), new Uint8Array([7]));
      await assertRejects(
        () =>
          recovered.remove("wire/retained", () => {
            throw new Error("delete failed");
          }),
        Error,
        "delete failed",
      );
      assertEquals(await names(join(root, "objects")), [retained.id]);
    } finally {
      await recovered.close();
    }
  });
});

Deno.test("payload archive borrows referenced local files across new and duplicate keys", async () => {
  await withArchive(async (archive, _db, root) => {
    await archive.publish("essr/first", await stage(archive.files));
    const borrowed = await archive.files.open((await names(join(root, "objects")))[0]);
    // A new key gets independent bytes; promotion failure must not remove the first owner.
    await archive.publish("essr/second", borrowed);
    // Equal-byte duplicate admission must not discard the other referenced object.
    await archive.publish("essr/second", borrowed);
    assertEquals((await names(join(root, "objects"))).length, 2);
    assertEquals(await collectPayload((await archive.get("essr/first"))!), new Uint8Array([1, 2, 3]));
    await archive.remove("essr/first");
    assertEquals(await collectPayload((await archive.get("essr/second"))!), new Uint8Array([1, 2, 3]));
  });
});

Deno.test("payload archive copies foreign sources and fails closed on missing referenced files", async () => {
  await withArchive(async (archive, db, root) => {
    const other = new PayloadStore(join(root, "foreign"));
    const foreign = await stage(other);
    const saved = await archive.publish("wire/foreign", foreign);
    await foreign.discard(); // Foreign ownership is independent; the archive copied its bytes.
    assertEquals(await collectPayload(saved), new Uint8Array([1, 2, 3]));
    const memory = new MemoryPayloadSink();
    await memory.write(new Uint8Array([4, 5]));
    await archive.publish("plain/memory", await memory.finish());
    await assertRejects(() => PayloadArchive.open(db, join(root, ".")), Error, "already has an owner");
    assertThrows(() => archive.publish("a".repeat(481), saved), TypeError, "Invalid payload reference key");
    await archive.close();
    await other.close();
    // Losing a referenced object must stop startup, never silently erase the reference.
    const [id] = await names(join(root, "objects"));
    await Deno.remove(join(root, "objects", id));
    await assertRejects(() => PayloadArchive.open(db, root));
  });
});

Deno.test("payload archive admits independent files concurrently and joins all work on close", async () => {
  await withArchive(async (archive, _db, root) => {
    let resume!: () => void, entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const blocked: Payload = {
      size: 1,
      /** Keep one real source pending while another publication completes. */
      async *open() {
        entered();
        await gate;
        yield new Uint8Array([1]);
      },
    };
    const publishing = archive.publish("wire/first", blocked);
    await reading;
    try {
      await archive.publish("wire/second", await stage(archive.files, [2]));
      assertEquals(await collectPayload((await archive.get("wire/second"))!), new Uint8Array([2]));
    } finally {
      const closing = archive.close();
      resume();
      await publishing;
      await closing;
    }
    assertEquals((await names(join(root, "objects"))).length, 2);
  });
});

Deno.test("payload archive selects the committed same-key winner after overlapping preparation", async () => {
  await withArchive(async (archive, _db, root) => {
    for (const equal of [true, false]) {
      let resume!: () => void, entered!: () => void;
      const reading = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const candidate: Payload = {
        size: 1,
        /** The competing publication wins while these bytes are still being prepared. */
        async *open() {
          entered();
          await gate;
          yield new Uint8Array([equal ? 7 : 8]);
        },
      };
      const key = `essr/${equal ? "equal" : "conflict"}`;
      let commits = 0;
      const pending = archive.publish(key, candidate, () => {
        commits++;
      });
      await reading;
      try {
        await archive.publish(key, await stage(archive.files, [7]), () => {
          commits++;
        });
      } finally {
        resume();
      }
      if (equal) await pending;
      else await assertRejects(() => pending, Error, "different bytes");
      assertEquals(commits, equal ? 2 : 1);
      assertEquals(await collectPayload((await archive.get(key))!), new Uint8Array([7]));
    }
    assertEquals((await names(join(root, "objects"))).length, 2);
    assertEquals(await names(join(root, "staging")), []);
  });
});

Deno.test("payload archive old deletion cannot remove a newly published same-key file", async () => {
  await withArchive(async (archive, _db, root) => {
    await archive.publish("essr/replace", await stage(archive.files, [1]));
    const old = (await names(join(root, "objects")))[0];
    const open = archive.files.open.bind(archive.files);
    let resume!: () => void, entered!: () => void;
    const deleting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    archive.files.open = async (id) => {
      if (id === old) {
        entered();
        await gate;
      }
      return await open(id);
    };
    const removed = archive.remove("essr/replace");
    await deleting;
    try {
      await archive.publish("essr/replace", await stage(archive.files, [2]));
    } finally {
      resume();
      await removed;
      archive.files.open = open;
    }
    assertEquals(await collectPayload((await archive.get("essr/replace"))!), new Uint8Array([2]));
    assertEquals((await names(join(root, "objects"))).length, 1);
  });
});

Deno.test("payload archive rechecks a reference replaced while its file is reopening", async () => {
  await withArchive(async (archive, _db, root) => {
    await archive.publish("essr/current", await stage(archive.files, [1]));
    const old = (await names(join(root, "objects")))[0];
    const open = archive.files.open.bind(archive.files);
    let resume!: () => void, entered!: () => void;
    const reopening = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let blocked = false;
    archive.files.open = async (id) => {
      if (id === old && !blocked) {
        blocked = true;
        entered();
        await gate;
      }
      return await open(id);
    };
    let commits = 0;
    const pending = archive.publish("essr/current", await stage(archive.files, [1]), () => {
      commits++;
    });
    await reopening;
    try {
      await archive.remove("essr/current");
      await archive.publish("essr/current", await stage(archive.files, [2]));
    } finally {
      resume();
      await assertRejects(() => pending, Error, "different bytes");
      archive.files.open = open;
    }
    assertEquals(commits, 0);
    assertEquals(await collectPayload((await archive.get("essr/current"))!), new Uint8Array([2]));
  });
});

Deno.test("payload archive active readers survive reference removal", async () => {
  await withArchive(async (archive) => {
    const bytes = Array<number>(65537).fill(3);
    const saved = await archive.publish("essr/reader", await stage(archive.files, bytes));
    const reader = saved.open()[Symbol.asyncIterator]();
    try {
      assertEquals((await reader.next()).value!.length, 65536);
      await archive.remove("essr/reader");
      assertEquals((await reader.next()).value, new Uint8Array([3]));
      assertEquals((await reader.next()).done, true);
    } finally {
      await reader.return?.();
    }
  });
});

Deno.test("payload archive refuses caller-owned writers before file or reference effects", async () => {
  await withArchive(async (archive, db) => {
    await archive.publish("essr/first", await stage(archive.files));
    db.env!.transactionSync(() => {
      assertThrows(() => archive.remove("essr/first"), Error, "own the transaction");
    });
    assertEquals(await collectPayload((await archive.get("essr/first"))!), new Uint8Array([1, 2, 3]));
  });
});

Deno.test("payload archive refuses unexpected private directory entries", async () => {
  await withArchive(async (archive, db, root) => {
    await archive.close();
    await Deno.writeFile(join(root, "staging", "not-a-payload"), new Uint8Array([1]));
    await assertRejects(() => PayloadArchive.open(db, root), Error, "Unexpected entry");
    // Failed recovery releases its runtime guard; removing the problem permits retry.
    await Deno.remove(join(root, "staging", "not-a-payload"));
    const recovered = await PayloadArchive.open(db, root);
    await recovered.close();
    // Never follow a substituted private directory while sweeping orphan files.
    await Deno.remove(join(root, "objects"));
    const target = join(root, "outside");
    await Deno.mkdir(target);
    const name = crypto.randomUUID();
    await Deno.writeFile(join(target, name), new Uint8Array([2]));
    await Deno.symlink(target, join(root, "objects"));
    await assertRejects(() => PayloadArchive.open(db, root), Error, "symlink");
    assertEquals(await names(target), [name]);
  });
});

Deno.test("payload archive cancellation aborts a pending source and joins staged cleanup", async () => {
  await withArchive(async (archive, _db, root) => {
    const controller = new AbortController();
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending: Payload = {
      size: 1,
      /** Model a cooperative network source that cannot finish until cancellation. */
      async *open(signal) {
        signal!.throwIfAborted();
        entered();
        await new Promise<void>((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        });
        yield new Uint8Array([1]);
      },
    };
    const publishing = archive.publish("wire/cancelled", pending, () => {
      throw new Error("must not commit");
    }, controller.signal);
    await reading;
    controller.abort(new Error("request cancelled"));
    await assertRejects(() => publishing, Error, "request cancelled");
    assertEquals(await archive.get("wire/cancelled"), null);
    assertEquals(await names(join(root, "staging")), []);
    const unclaimed = await stage(archive.files);
    // Already-aborted admission must not transfer or discard a completed caller-owned file.
    await assertRejects(
      () => archive.publish("wire/pre-aborted", unclaimed, () => {}, controller.signal),
      Error,
      "request cancelled",
    );
    assertEquals(await collectPayload(unclaimed), new Uint8Array([1, 2, 3]));
    await unclaimed.discard();
    await archive.close();
  });
});

Deno.test("payload archive keeps ciphertext and plaintext owners distinct under one SAID", async () => {
  await withArchive(async (archive, _db, root) => {
    await archive.publish("essr/same", await stage(archive.files));
    await archive.publish("plain/same", await stage(archive.files));
    assertEquals((await names(join(root, "objects"))).length, 2);
    await archive.remove("essr/same");
    // Equal bytes do not merge independent lifetimes or require hidden reference counts.
    assertEquals(await collectPayload((await archive.get("plain/same"))!), new Uint8Array([1, 2, 3]));
    for (const key of ["wire//said", "/said", "wire/", "wire.said"]) {
      assertThrows(() => archive.remove(key), TypeError, "Invalid payload reference key");
    }
  });
});

Deno.test("payload archive cleans failed candidates and retries without reopening", async () => {
  await withArchive(async (archive, _db, root) => {
    const stagePayload = await stage(archive.files, [8]);
    await assertRejects(
      () =>
        archive.publish("essr/retry", stagePayload, () => {
          throw new Error("rollback");
        }),
      Error,
      "rollback",
    );
    assertEquals(await names(join(root, "objects")), []);
    // A later candidate has its own file and cannot delete another admission.
    await archive.publish("essr/retry", await stage(archive.files, [9]));
    assertEquals(await collectPayload((await archive.get("essr/retry"))!), new Uint8Array([9]));
  });
});
