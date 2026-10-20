import {
  collectPayload,
  concatBytes,
  Diger,
  Encrypter,
  MtrDex,
  type Payload,
  Prefixer,
  Texter,
  Vrsn_1_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { type EssrDecision, type EssrMessage, EssrRecipient } from "../../../src/app/essr.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { type FilePayloadSink, PayloadStore } from "../../../src/db/payload-store.ts";

/** Exhaustive success consumption: refusal/rejection never exposes a plaintext owner. */
function accepted(decision: EssrDecision): EssrMessage {
  switch (decision.kind) {
    case "accept":
      return decision.message;
    case "refuse":
      throw new Error(`Unexpected ESSR admission refusal: ${decision.reason}`);
    case "reject":
      throw new Error(`Unexpected ESSR verification failure: ${decision.reason}`);
    default:
      return decision satisfies never;
  }
}

/** Read the tiny fixture directories without importing a separate filesystem runtime. */
function names(path: string): string[] {
  return Array.from(Deno.readDirSync(path), (entry) => entry.name);
}

/** Inspect this test-owned directory without depending on Node filesystem APIs. */
async function entries(root: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(root)) names.push(entry.name);
  return names.sort();
}

/** Give each scenario real keys, accepted sender state, and an isolated payload store. */
async function scenario(
  test: (context: {
    hby: Habery;
    sender: Hab;
    recipient: Hab;
    store: PayloadStore;
    root: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir();
  const store = new PayloadStore(root, 7);
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: `essr-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      try {
        const sender = hby.makeHab("sender");
        const recipient = hby.makeHab("recipient");
        yield* call(() => test({ hby, sender, recipient, store, root }));
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await store.close();
    await Deno.remove(root, { recursive: true });
  }
}

/** Reproduce the pinned StreamPoster header; padding is a complete CESR Bexter. */
function plaintext(sender: Hab, body: Uint8Array, tag = "XSCS", padding = "4AAA", source = sender.pre): Uint8Array {
  return concatBytes(new TextEncoder().encode(tag + source + padding), body);
}

/** Seal to one recipient key using the existing primitive-owned crypto implementation. */
function seal(recipient: Hab, plain: Uint8Array): Uint8Array {
  return new Encrypter({ verkey: recipient.kever!.verfers[0].qb64 }).encrypt({
    ser: plain,
    code: MtrDex.X25519_Cipher_L0,
  }).raw;
}

/** Sign and accept through the real Exchanger; keep ciphertext as replay evidence. */
async function accept(
  hby: Habery,
  sender: Hab,
  recipient: Hab,
  cipher: Uint8Array,
  modifiers: Partial<{ src: string; dest: string }> = {},
): Promise<string> {
  const [serder] = exchange("/essr/req", {}, {
    sender: sender.pre,
    diger: new Diger({ raw: Diger.digest(cipher, MtrDex.Blake3_256), code: MtrDex.Blake3_256 }),
    modifiers: { src: sender.pre, dest: recipient.pre, ...modifiers },
  });
  const tsg = new TransIdxSigGroup(
    new Prefixer({ qb64: sender.pre }),
    sender.kever!.sner,
    new Diger({ qb64: sender.kever!.said }),
    sender.sign(serder.raw, true),
  );
  const texter = new Texter({ raw: cipher, code: MtrDex.Bytes_L0 });
  const result = await run(() =>
    new Exchanger(hby).processEvent({
      serder,
      tsgs: [tsg],
      essrs: [texter],
    })
  );
  assertEquals(result.kind, "accept");
  return serder.said!;
}

Deno.test("ESSR recipient decrypts accepted SCS content before staging and preserves ciphertext evidence", async () => {
  await scenario(async ({ hby, sender, recipient, store }) => {
    const body = exchange("/inner", { message: "hello" }, { sender: sender.pre })[0].raw;
    // Nonempty padding is legal and must be skipped with the full Bexter length.
    const plain = plaintext(sender, body, "XSCS", "4AABabcd");
    const cipher = seal(recipient, plain);
    const said = await accept(hby, sender, recipient, cipher);
    const receiver = new EssrRecipient(recipient, store);
    const result = accepted(await run(() => receiver.decrypt(said, fragmentsPayload(cipher))));
    assertEquals(await collectPayload(result.plaintext), plain);
    assertEquals(await collectPayload(result.body), body);
    assertEquals(hby.db.getEssrs(said)![0].raw, cipher);
    await result.plaintext.promote(`plain.${said}`);
    // The view reopens the owning file, so it survives promotion without a RAM copy.
    assertEquals(await collectPayload(result.body), body);
    await result.plaintext.discard();
    await assertRejects(() => collectPayload(result.body), Error, "removed");
  });
});

Deno.test("ESSR recipient rejects unaccepted and misaddressed exchanges before reading or staging", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const payload: Payload = {
      size: cipher.length,
      /** Neither an unmet prerequisite nor an invalid address may read ciphertext. */
      async *open() {
        throw new Error("Premature ciphertext read");
      },
    };
    const receiver = new EssrRecipient(recipient, store);
    assertEquals(await run(() => receiver.decrypt("missing", payload)), { kind: "refuse", reason: "unaccepted" });
    for (const modifiers of [{ dest: sender.pre }, { src: recipient.pre }]) {
      const said = await accept(hby, sender, recipient, cipher, modifiers);
      assertEquals(await run(() => receiver.decrypt(said, payload)), { kind: "reject", reason: "envelope" });
    }
    // PayloadStore.stage has never been called, so even its directory is absent.
    assertEquals(names(root), []);
  });
});

Deno.test("ESSR digest, sealed-box authentication, and inner source failures write no plaintext", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const body = new TextEncoder().encode("-AAA");
    const receiver = new EssrRecipient(recipient, store);
    const cipher = seal(recipient, plaintext(sender, body));
    const said = await accept(hby, sender, recipient, cipher);
    const tampered = cipher.slice();
    tampered[tampered.length - 1] ^= 1;
    assertEquals(await run(() => receiver.decrypt(said, fragmentsPayload(tampered))), {
      kind: "reject",
      reason: "digest",
    });
    // Commit the tampered ciphertext to isolate crypto authentication from digest checking.
    const corruptSaid = await accept(hby, sender, recipient, tampered);
    assertEquals(await run(() => receiver.decrypt(corruptSaid, fragmentsPayload(tampered))), {
      kind: "reject",
      reason: "decrypt",
    });
    // A different local key must not become a fallback for the addressed recipient.
    const foreign = seal(sender, plaintext(sender, body));
    const foreignSaid = await accept(hby, sender, recipient, foreign);
    assertEquals(await run(() => receiver.decrypt(foreignSaid, fragmentsPayload(foreign))), {
      kind: "reject",
      reason: "decrypt",
    });
    for (
      const invalid of [
        plaintext(sender, body, "XHOP"),
        plaintext(sender, body, "XSCS", "4AAA", recipient.pre),
        plaintext(sender, body, "XSCS", "4BAA"),
      ]
    ) {
      const sealed = seal(recipient, invalid);
      const invalidSaid = await accept(hby, sender, recipient, sealed);
      assertEquals(await run(() => receiver.decrypt(invalidSaid, fragmentsPayload(sealed))), {
        kind: "reject",
        reason: "framing",
      });
    }
    assertEquals(names(root), []);
  });
});

Deno.test("ESSR cancelled ingress closes its reader without creating plaintext", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = await accept(hby, sender, recipient, cipher);
    const receiver = new EssrRecipient(recipient, store);
    const controller = new AbortController();
    const waiting: Payload = {
      size: cipher.length,
      /** Stay pending until cancellation to exercise signal-aware source teardown. */
      async *open(signal) {
        // Simulate an owned network read that is released by the request signal.
        await new Promise<void>((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        });
        yield cipher;
      },
    };
    const attempt = Promise.resolve(run(() => receiver.decrypt(said, waiting, controller.signal)));
    controller.abort(new Error("request cancelled"));
    await assertRejects(() => attempt, Error, "request cancelled");
    assertEquals(names(root), []);
    // A new request proves the cancelled attempt released admission state.
    const next = accepted(await run(() => receiver.decrypt(said, fragmentsPayload(cipher))));
    await next.plaintext.discard();
  });
});

/** An immutable test byte source, split on arbitrary transport boundaries. */
function fragmentsPayload(bytes: Uint8Array): Payload {
  return {
    size: bytes.length,
    /** Reopen fixed bytes at deliberately unaligned transport boundaries. */
    async *open(signal) {
      for (let offset = 0; offset < bytes.length; offset += 13) {
        signal?.throwIfAborted();
        yield bytes.subarray(offset, offset + 13);
      }
    },
  };
}

Deno.test("ESSR validates sealed-box extent before reading", async () => {
  await scenario(async ({ hby, sender, recipient, store }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = await accept(hby, sender, recipient, cipher);
    const receiver = new EssrRecipient(recipient, store);
    let opened = false;
    const source: Payload = {
      size: cipher.length,
      /** Detect a read before numeric and sealed-box framing validation. */
      async *open() {
        opened = true;
      },
    };
    for (const size of [0, 47]) {
      assertEquals(await run(() => receiver.decrypt(said, { ...source, size })), {
        kind: "reject",
        reason: "envelope",
      });
    }
    for (const size of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assertRejects(() => Promise.resolve(run(() => receiver.decrypt(said, { ...source, size }))), RangeError);
    }
    assertEquals(opened, false);
  });
});

Deno.test("halting an ESSR recipient operation joins its input cleanup", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = await accept(hby, sender, recipient, cipher);
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let startCleanup!: () => void;
    const cleaning = new Promise<void>((resolve) => {
      startCleanup = resolve;
    });
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let closed = false;
    const waiting: Payload = {
      size: cipher.length,
      /** Remain pending until the recipient's Effection scope aborts this read. */
      async *open(signal) {
        try {
          entered();
          await new Promise<void>((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
          });
          yield cipher;
        } finally {
          startCleanup();
          await cleanup;
          closed = true;
        }
      },
    };
    const receiver = new EssrRecipient(recipient, store);
    let continued = false;
    const task = run(function*() {
      yield* receiver.decrypt(said, waiting);
      continued = true;
    });
    await reading;
    let halted = false;
    const halt = task.halt().then(() => {
      halted = true;
    });
    await cleaning;
    assertEquals(halted, false);
    assertEquals(closed, false);
    releaseCleanup();
    await halt;
    assertEquals(closed, true);
    assertEquals(continued, false); // Scope cancellation must remain abrupt after cleanup.
    assertEquals(names(root), []);
    const result = accepted(await run(() => receiver.decrypt(said, fragmentsPayload(cipher))));
    await result.plaintext.discard();
  });
});

Deno.test("recipient cancellation disposes a finished plaintext file before result transfer", async () => {
  await scenario(async ({ hby, sender, recipient, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = await accept(hby, sender, recipient, cipher);
    let finished!: () => void;
    const ready = new Promise<void>((resolve) => {
      finished = resolve;
    });
    /** Pause only the handoff after real filesystem finish has transferred its stage. */
    class HandoffStore extends PayloadStore {
      /** Real writes and fsync finish precede a cancellation-controlled cleanup gate. */
      override async stage(signal?: AbortSignal): Promise<FilePayloadSink> {
        const sink = await super.stage(signal);
        return {
          write: (chunk) => sink.write(chunk),
          finish: () => sink.finish(),
          /** Hold the leaf after finish so cancellation wins before its caller receives ownership. */
          async abort() {
            finished();
            if (!signal?.aborted) {
              await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
            }
            await sink.abort();
          },
        };
      }
    }
    const store = new HandoffStore(root);
    try {
      const task = run(() => new EssrRecipient(recipient, store).decrypt(said, fragmentsPayload(cipher)));
      await ready;
      assertEquals((names(`${root}/staging`)).length, 1);
      await task.halt();
      // The operation joins the leaf and disposes the result that could not reach a consumer.
      assertEquals(names(`${root}/staging`), []);
    } finally {
      await store.close();
    }
  });
});

Deno.test("ESSR propagates input and keeper failures and retains no plaintext", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = await accept(hby, sender, recipient, cipher);
    const receiver = new EssrRecipient(recipient, store);
    const failure = new Error("fixture I/O failure");
    const broken: Payload = {
      size: cipher.length,
      /** A transport failure is not evidence of malformed ciphertext. */
      async *open() {
        throw failure;
      },
    };
    assertEquals(await assertRejects(() => Promise.resolve(run(() => receiver.decrypt(said, broken)))), failure);
    const source = fragmentsPayload(cipher);
    // Dishonest reader lengths remain the Payload contract's RangeError.
    await assertRejects(
      () => Promise.resolve(run(() => receiver.decrypt(said, { ...source, size: cipher.length + 1 }))),
      RangeError,
    );
    const read = hby.ks.pris.get;
    hby.ks.pris.get = () => {
      throw failure;
    };
    try {
      assertEquals(await assertRejects(() => Promise.resolve(run(() => receiver.decrypt(said, source)))), failure);
    } finally {
      hby.ks.pris.get = read;
    }
    const exchangeRead = hby.db.exns.get;
    hby.db.exns.get = () => {
      throw failure;
    };
    try {
      assertEquals(await assertRejects(() => Promise.resolve(run(() => receiver.decrypt(said, source)))), failure);
    } finally {
      hby.db.exns.get = exchangeRead;
    }
    assertEquals(names(root), []);
    const result = accepted(await run(() => receiver.decrypt(said, source)));
    await result.plaintext.discard();
  });
});

Deno.test("ESSR propagates staging failures and disposes finished but untransferred plaintext", async () => {
  await scenario(async ({ hby, sender, recipient, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = await accept(hby, sender, recipient, cipher);
    const failure = new Error("fixture storage failure");
    /** Fail at real storage ownership transitions, preserving the actual file sink. */
    class FailingStore extends PayloadStore {
      point: "stage" | "write" | "finish" | "abort" | undefined;
      /** The same recipient must release its reservation after each failed storage step. */
      override async stage(signal?: AbortSignal): Promise<FilePayloadSink> {
        if (this.point === "stage") throw failure;
        const sink = await super.stage(signal);
        const point = this.point;
        return {
          /** Preserve partial-file cleanup on failed writes. */
          async write(chunk) {
            await sink.write(chunk);
            if (point === "write") throw failure;
          },
          /** Failed finish retains stage ownership; successful finish transfers it. */
          finish() {
            if (point === "finish") return Promise.reject(failure);
            return sink.finish();
          },
          /** A failure after finish must still release the file owned by the recipient. */
          async abort() {
            await sink.abort();
            if (point === "abort") throw failure;
          },
        };
      }
    }
    const store = new FailingStore(root);
    const receiver = new EssrRecipient(recipient, store);
    try {
      for (const point of ["stage", "write", "finish", "abort"] as const) {
        store.point = point;
        assertEquals(
          await assertRejects(() => Promise.resolve(run(() => receiver.decrypt(said, fragmentsPayload(cipher))))),
          failure,
        );
        if (point !== "stage") assertEquals(names(`${root}/staging`), []);
      }
      store.point = undefined;
      const result = accepted(await run(() => receiver.decrypt(said, fragmentsPayload(cipher))));
      await result.plaintext.discard();
      assertEquals(names(`${root}/staging`), []);
    } finally {
      await store.close();
    }
  });
});
