// @file-test-lane app-fast-parallel

import { collectPayload, concatBytes, Diger, Encrypter, MtrDex, type Payload, Prefixer, Texter } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { EssrError, EssrRecipient } from "../../../src/app/essr.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { PayloadStore } from "../../../src/db/payload-store.ts";

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
function accept(
  hby: Habery,
  sender: Hab,
  recipient: Hab,
  cipher: Uint8Array,
  modifiers: Partial<{ src: string; dest: string }> = {},
): string {
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
  const result = new Exchanger(hby).processEvent({
    serder,
    tsgs: [tsg],
    essrs: [new Texter({ raw: cipher, code: MtrDex.Bytes_L0 })],
  });
  assertEquals(result.kind, "accept");
  return serder.said!;
}

Deno.test("ESSR recipient decrypts accepted SCS content before staging and preserves ciphertext evidence", async () => {
  await scenario(async ({ hby, sender, recipient, store }) => {
    const body = exchange("/inner", { message: "hello" }, { sender: sender.pre })[0].raw;
    // Nonempty padding is legal and must be skipped with the full Bexter length.
    const plain = plaintext(sender, body, "XSCS", "4AABabcd");
    const cipher = seal(recipient, plain);
    const said = accept(hby, sender, recipient, cipher);
    const result = await new EssrRecipient(recipient, store, 4096).decrypt(said, fragmentsPayload(cipher));
    assertEquals(await collectPayload(result.plaintext, 4096), plain);
    assertEquals(await collectPayload(result.body, 4096), body);
    assertEquals(hby.db.essrs.get([said])[0].raw, cipher);
    await result.plaintext.promote(`plain.${said}`);
    // The view reopens the owning file, so it survives promotion without a RAM copy.
    assertEquals(await collectPayload(result.body, 4096), body);
    await result.plaintext.discard();
    await assertRejects(() => collectPayload(result.body, 4096), Error, "removed");
  });
});

Deno.test("ESSR recipient rejects unaccepted and misaddressed exchanges before reading or staging", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const payload = fragmentsPayload(cipher);
    const receiver = new EssrRecipient(recipient, store, 4096);
    const unaccepted = await assertRejects(() => receiver.decrypt("missing", payload), EssrError);
    assertEquals(unaccepted.kind, "unaccepted");
    for (const modifiers of [{ dest: sender.pre }, { src: recipient.pre }]) {
      const said = accept(hby, sender, recipient, cipher, modifiers);
      const failure = await assertRejects(() => receiver.decrypt(said, payload), EssrError);
      assertEquals(failure.kind, "envelope");
    }
    // PayloadStore.stage has never been called, so even its directory is absent.
    assertEquals(await entries(root), []);
  });
});

Deno.test("ESSR digest, sealed-box authentication, and inner source failures write no plaintext", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const body = new TextEncoder().encode("-AAA");
    const receiver = new EssrRecipient(recipient, store, 4096);
    const cipher = seal(recipient, plaintext(sender, body));
    const said = accept(hby, sender, recipient, cipher);
    const tampered = cipher.slice();
    tampered[tampered.length - 1] ^= 1;
    let failure = await assertRejects(() => receiver.decrypt(said, fragmentsPayload(tampered)), EssrError);
    assertEquals(failure.kind, "digest");
    // Commit the tampered ciphertext to isolate crypto authentication from digest checking.
    const corruptSaid = accept(hby, sender, recipient, tampered);
    failure = await assertRejects(() => receiver.decrypt(corruptSaid, fragmentsPayload(tampered)), EssrError);
    assertEquals(failure.kind, "decrypt");
    // A different local key must not become a fallback for the addressed recipient.
    const foreign = seal(sender, plaintext(sender, body));
    const foreignSaid = accept(hby, sender, recipient, foreign);
    failure = await assertRejects(() => receiver.decrypt(foreignSaid, fragmentsPayload(foreign)), EssrError);
    assertEquals(failure.kind, "decrypt");
    for (
      const invalid of [
        plaintext(sender, body, "XHOP"),
        plaintext(sender, body, "XSCS", "4AAA", recipient.pre),
        plaintext(sender, body, "XSCS", "4BAA"),
      ]
    ) {
      const sealed = seal(recipient, invalid);
      const invalidSaid = accept(hby, sender, recipient, sealed);
      failure = await assertRejects(() => receiver.decrypt(invalidSaid, fragmentsPayload(sealed)), EssrError);
      assertEquals(failure.kind, "framing");
    }
    assertEquals(await entries(root), []);
  });
});

Deno.test("ESSR cancelled ingress releases its concurrency slot without creating plaintext", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = accept(hby, sender, recipient, cipher);
    const receiver = new EssrRecipient(recipient, store, 4096);
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
    const attempt = receiver.decrypt(said, waiting, controller.signal);
    controller.abort(new Error("request cancelled"));
    await assertRejects(() => attempt, Error, "request cancelled");
    assertEquals(await entries(root), []);
    // A new request proves the cancelled attempt released admission state.
    const next = await receiver.decrypt(said, fragmentsPayload(cipher));
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

Deno.test("ESSR admission caps one message and rejects concurrent work without queueing", async () => {
  await scenario(async ({ hby, sender, recipient, store, root }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = accept(hby, sender, recipient, cipher);
    const receiver = new EssrRecipient(recipient, store, 4096);
    let opened = false;
    const oversized: Payload = {
      size: 4097,
      /** Detect any premature source access before size admission. */
      async *open() {
        opened = true;
      },
    };
    assertEquals((await assertRejects(() => receiver.decrypt(said, oversized), EssrError)).kind, "limit");
    assertEquals(opened, false);
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const waiting: Payload = {
      size: cipher.length,
      /** Hold the sole admission slot until the test releases its read gate. */
      async *open() {
        // Hold the first request at ingress to prove the second is rejected, not queued.
        await gate;
        yield cipher;
      },
    };
    const first = receiver.decrypt(said, waiting);
    assertEquals((await assertRejects(() => receiver.decrypt(said, waiting), EssrError)).kind, "busy");
    assertEquals(await entries(root), []);
    resume();
    const result = await first;
    await result.plaintext.discard();
    assertThrows(() => new EssrRecipient(recipient, store, Infinity), RangeError);
    assertThrows(() => new EssrRecipient(recipient, store, 4096, 0), RangeError);
  });
});
