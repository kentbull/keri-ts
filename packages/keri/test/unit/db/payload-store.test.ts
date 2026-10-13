// @file-test-lane db-fast

import { collectPayload } from "cesr-ts";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PayloadStore, writePayloadChunk } from "../../../src/db/payload-store.ts";

Deno.test("payload store transfers finished ownership and reopens promoted files", async () => {
  const root = await Deno.makeTempDir();
  const store = new PayloadStore(root, 3);
  try {
    const sink = await store.stage(10);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await sink.write(bytes);
    bytes.fill(0);
    await sink.write(new Uint8Array([5, 6]));
    const payload = await sink.finish();
    // Both cleanup calls must leave the caller-owned completed file intact.
    await sink.abort();
    await store.close();
    assertEquals(await collectPayload(payload, 6), new Uint8Array([1, 2, 3, 4, 5, 6]));
    await payload.promote();
    await payload.promote();
    assertEquals(await readdir(join(root, "staging")), []);
    const reopenedStore = new PayloadStore(root, 2);
    // Reconstruct from persistent identity, independent of the original handle.
    const reopened = await reopenedStore.open(payload.id);
    assertEquals(reopened.size, 6);
    const sizes: number[] = [];
    for await (const chunk of reopened.open()) sizes.push(chunk.length);
    assertEquals(sizes, [2, 2, 2]);
    assertEquals(await collectPayload(reopened, 6), new Uint8Array([1, 2, 3, 4, 5, 6]));
    await reopened.discard();
    await reopened.discard();
    await assertRejects(() => collectPayload(reopened, 6), Error, "removed");
    await assertRejects(() => reopenedStore.open("../secret"), TypeError, "Invalid payload ID");
    await reopenedStore.close();
  } finally {
    await store.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("payload store aborts unfinished stages and enforces byte limits", async () => {
  const root = await Deno.makeTempDir();
  const store = new PayloadStore(root);
  try {
    const sink = await store.stage(2);
    await sink.write(new Uint8Array([1, 2]));
    await assertRejects(() => sink.write(new Uint8Array([3])), RangeError, "sink limit");
    await sink.abort();
    await sink.abort();
    assertEquals(await readdir(join(root, "staging")), []);
    await assertRejects(() => sink.finish(), Error, "closed");
    await store.stage(10);
    await store.close();
    assertEquals(await readdir(join(root, "staging")), []);
    await assertRejects(() => store.stage(1), Error, "closed");
  } finally {
    await store.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("payload store cancellation removes only the unfinished stage", async () => {
  const root = await Deno.makeTempDir();
  const store = new PayloadStore(root);
  const controller = new AbortController();
  try {
    const first = await store.stage(1, controller.signal);
    await first.write(new Uint8Array([1]));
    const payload = await first.finish();
    const second = await store.stage(1, controller.signal);
    // A shared request abort cleans unfinished B without revoking emitted A.
    controller.abort(new Error("cancelled"));
    await second.abort();
    assertEquals(await readdir(join(root, "staging")), [payload.id]);
    await assertRejects(() => store.stage(1, controller.signal), Error, "cancelled");
    await assertRejects(() => collectPayload(payload, 1, controller.signal), Error, "cancelled");
    assertEquals(await collectPayload(payload, 1), new Uint8Array([1]));
    const iterator = payload.open()[Symbol.asyncIterator]();
    await iterator.next();
    // Early return must close its descriptor; Deno's sanitizer checks for leaks.
    await iterator.return!();
    await payload.discard();
    assertEquals(await readdir(join(root, "staging")), []);
  } finally {
    await store.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("payload file writer retries real partial writes and stops when cancelled", async () => {
  const root = await Deno.makeTempDir();
  const file = await open(join(root, "partial"), "wx");
  try {
    const controller = new AbortController();
    let writes = 0;
    const partial = {
      write: async (bytes: Uint8Array, offset: number, length: number, position: null) => {
        writes++;
        // Use a real file while limiting each OS write to two bytes.
        const result = await file.write(bytes, offset, Math.min(2, length), position);
        if (writes === 5) controller.abort(new Error("stop"));
        return result;
      },
    };
    await writePayloadChunk(partial, new Uint8Array([1, 2, 3, 4, 5]));
    assertEquals(writes, 3);
    assertEquals(await Deno.readFile(join(root, "partial")), new Uint8Array([1, 2, 3, 4, 5]));
    await assertRejects(
      () => writePayloadChunk(partial, new Uint8Array([6, 7, 8, 9, 10]), controller.signal),
      Error,
      "stop",
    );
    assertEquals(writes, 5);
    // A zero-progress writer must fail rather than spin indefinitely.
    await assertRejects(
      () => writePayloadChunk({ write: () => Promise.resolve({ bytesWritten: 0 }) }, new Uint8Array([1])),
      Error,
      "write progress",
    );
  } finally {
    await file.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("payload store rejects concurrent operations and cleans an interrupted finish", async () => {
  const root = await Deno.makeTempDir();
  const store = new PayloadStore(root);
  try {
    const sink = await store.stage(3);
    const writing = sink.write(new Uint8Array([1, 2, 3]));
    await assertRejects(() => sink.write(new Uint8Array()), Error, "active operation");
    await writing;
    const finishing = sink.finish();
    // Attach rejection handling before cancellation races the pending fsync.
    const failure = assertRejects(() => finishing, Error, "aborted");
    await sink.abort();
    await failure;
    assertEquals(await readdir(join(root, "staging")), []);
  } finally {
    await store.close();
    await Deno.remove(root, { recursive: true });
  }
});
