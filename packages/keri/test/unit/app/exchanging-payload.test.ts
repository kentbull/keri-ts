import {
  b,
  collectPayload,
  concatBytes,
  Dater,
  Diger,
  Encrypter,
  type EssrPayload,
  essrPayload,
  MtrDex,
  parse,
  Prefixer,
  ResourceLimitError,
  type SerderKERI,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { EssrRecipient } from "../../../src/app/essr.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../src/time/mod.ts";

/** Read the tiny fixture directories without importing a separate filesystem runtime. */
function names(path: string): string[] {
  return Array.from(Deno.readDirSync(path), (entry) => entry.name);
}

/** Real accepted sender state keeps these checks on the signature and storage paths. */
async function scenario(test: (hby: Habery, sender: Hab) => Promise<void>): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: `payload-exn-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const sender = hby.makeHab("sender");
      yield* call(() => test(hby, sender));
    } finally {
      yield* hby.close(true);
    }
  });
}

/** Stage small independent Texters under one logical commitment, without a parser fixture. */
async function payload(hby: Habery, parts = ["abc", "xyz"], gvrsn = Vrsn_1_0): Promise<EssrPayload> {
  const sink = await (await hby.db.openPayloads()).files.stage(256);
  let size = 0;
  for (const part of parts) {
    const texter = new Texter({ raw: b(part), code: MtrDex.Bytes_L0 });
    await sink.write(texter.qb64b);
    size += texter.raw.length;
  }
  return essrPayload(await sink.finish(), parts.length, size, gvrsn);
}

/** The EXN commits concatenated bytes, so legal fragment boundaries may change on replay. */
function message(sender: Hab, raw = "abcxyz"): SerderKERI {
  return exchange("/essr/test", {}, {
    sender: sender.pre,
    diger: new Diger({ raw: Diger.digest(b(raw), "E"), code: "E" }),
  })[0];
}

/** Bind the outer signature to the sender's accepted establishment event. */
function signatures(sender: Hab, serder: SerderKERI): TransIdxSigGroup[] {
  return [
    new TransIdxSigGroup(
      new Prefixer({ qb64: sender.pre }),
      sender.kever!.sner,
      new Diger({ qb64: sender.kever!.said }),
      sender.sign(serder.raw, true),
    ),
  ];
}

Deno.test("exchange payload references survive request disposal and preserve readable wire evidence", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const incoming = await payload(hby);
    const exchanger = new Exchanger(hby);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: incoming }))).kind,
      "accept",
    );
    await incoming.discard(); // A published same-store wire owner has been transferred.
    const stored = await hby.db.getEssr(serder.said!);
    assertExists(stored);
    assertEquals(await collectPayload(stored.raw, 6), b("abcxyz"));
    assertEquals([...hby.db.essrs.getIter([serder.said!])].map((item) => item.text), ["abc", "xyz"]);
    const reframed = await payload(hby, ["ab", "cxyz"]);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: reframed }))).kind,
      "accept",
    );
    await reframed.discard();
    assertEquals([...hby.db.essrs.getIter([serder.said!])].map((item) => item.text), ["abc", "xyz"]);
    // An incomplete attempt remains pending but cannot downgrade accepted ownership.
    assertEquals((await run(() => exchanger.processEvent({ serder }))).kind, "escrow");
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertEquals((names(join(hby.db.path!, "payloads", "objects"))).length, 1);
    assertEquals(names(join(hby.db.path!, "payloads", "staging")), []);
  });
});

Deno.test("exchange escrow reopens owned wire and retains mailbox provenance on acceptance", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const incoming = await payload(hby);
    const seen: string[] = [];
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/essr/test",
        handle({ mailboxAid }) {
          seen.push(mailboxAid!);
        },
      }],
    });
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, essr: incoming, mailboxAid: sender.pre }))).kind,
      "escrow",
    );
    await incoming.discard();
    assertEquals(hby.db.exns.get([serder.said!]), null);
    const group = signatures(sender, serder)[0];
    // Later signatures can arrive independently; retry must use the stored ESSR owner.
    for (const siger of group.sigers) hby.db.esigs.add([serder.said!, group.pre, group.snh, group.said], siger);
    await run(() => exchanger.processEscrows());
    assertEquals(seen, [sender.pre]);
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertExists(hby.db.exns.get([serder.said!]));
    assertEquals(await collectPayload((await hby.db.getEssr(serder.said!))!.raw, 6), b("abcxyz"));
  });
});

Deno.test("exchange rejects digest failures before publishing wire or invoking handlers", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const incoming = await payload(hby, ["wrong"]);
    let handled = 0;
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/essr/test",
        handle() {
          handled++;
        },
      }],
    });
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: incoming }))).kind,
      "reject",
    );
    const lying = {
      ...incoming,
      raw: {
        size: 6,
        /** Advertise valid decoded bytes while the canonical wire remains tampered. */
        async *open() {
          yield b("abcxyz");
        },
      },
    };
    // Raw bytes supplied separately cannot authenticate different canonical wire bytes.
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: lying }))).kind,
      "reject",
    );
    assertEquals(handled, 0);
    assertEquals(hby.db.exns.get([serder.said!]), null);
    assertEquals(hby.db.essrs.get([serder.said!]), []);
    assertEquals(await hby.db.getEssr(serder.said!), null);
    await incoming.discard();
    assertEquals(names(join(hby.db.path!, "payloads", "objects")), []);
  });
});

Deno.test("exchange replay streams v1 and v2 ESSR into a fresh progressive parser", async () => {
  await scenario(async (hby, sender) => {
    for (const gvrsn of [Vrsn_1_0, Vrsn_2_0]) {
      const serder = message(sender, `v${gvrsn.major}`);
      const incoming = await payload(hby, [`v${gvrsn.major}`], gvrsn);
      const exchanger = new Exchanger(hby);
      assertEquals(
        (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: incoming }))).kind,
        "accept",
      );
      await incoming.discard();
      let frames = 0;
      for await (const frame of parse(exchanger.replay(serder.said!))) {
        frames++;
        assertEquals(frame.body.raw, serder.raw);
        assertEquals(await collectPayload(frame.essr!.raw, 2), b(`v${gvrsn.major}`));
        await frame.essr!.discard();
      }
      assertEquals(frames, 1);
    }
  });
});

Deno.test("exchange replay borrows bounded KERIpy ESSR rows without private metadata", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    hby.db.exns.pin([serder.said!], serder);
    // KERIpy stores insertion-ordered unique Texters, never a private file reference.
    for (const text of ["abc", "xyz", "abc"]) {
      hby.db.essrs.add([serder.said!], new Texter({ raw: b(text), code: MtrDex.Bytes_L0 }));
    }
    for (const group of signatures(sender, serder)) {
      for (const siger of group.sigers) hby.db.esigs.add([serder.said!, group.pre, group.snh, group.said], siger);
    }
    const exchanger = new Exchanger(hby);
    let frames = 0;
    for await (const frame of parse(exchanger.replay(serder.said!))) {
      frames++;
      assertEquals(frame.essr!.count, 2);
      assertEquals(await collectPayload(frame.essr!.raw, 6), b("abcxyz"));
      await frame.essr!.discard();
    }
    assertEquals(frames, 1);
    assertEquals(hby.db.exchangeMeta.get([serder.said!]), null); // Replay does not introduce a second publication path.
    for (const limits of [{ maxEssrBytes: 5 }, { maxEssrItems: 1 }]) {
      await assertRejects(() => hby.db.getEssr(serder.said!, undefined, limits), ResourceLimitError);
    }
    // Borrowing and disposing the view never transfers ownership of KERIpy rows.
    const borrowed = (await hby.db.getEssr(serder.said!))!;
    for await (const chunk of borrowed.wire.open()) assertEquals(chunk.buffer.byteLength <= 65536, true);
    await borrowed.discard();
    assertEquals(hby.db.essrs.get([serder.said!]).map((texter) => texter.text), ["abc", "xyz"]);
    // One stored token crosses the read target, proving chunks cannot retain its whole backing buffer.
    const text = "x".repeat(65537);
    const large = message(sender, text);
    hby.db.exns.pin([large.said!], large);
    hby.db.essrs.add([large.said!], new Texter({ raw: b(text), code: MtrDex.Bytes_L0 }));
    const split = (await hby.db.getEssr(large.said!))!;
    let chunks = 0;
    for await (const chunk of split.wire.open()) {
      chunks++;
      assertEquals(chunk.buffer.byteLength <= 65536, true);
    }
    assertEquals(chunks > 1, true);
    assertEquals(await collectPayload(split.raw, text.length), b(text));
    await assertRejects(
      () => hby.db.getEssr(large.said!, undefined, { maxEssrBytes: text.length - 1 }),
      ResourceLimitError,
    );
    await split.discard();
  });
});

Deno.test("exchange imports preserve valid first fragments and reject corrupt retained rows", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    hby.db.exns.pin([serder.said!], serder);
    for (const text of ["abc", "xyz"]) {
      hby.db.essrs.add([serder.said!], new Texter({ raw: b(text), code: MtrDex.Bytes_L0 }));
    }
    const exchanger = new Exchanger(hby);
    const invalid = await payload(hby, ["bad"]);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: invalid }))).kind,
      "reject",
    );
    await invalid.discard();
    assertEquals(hby.db.exchangeMeta.get([serder.said!]), null);
    const supplied = await payload(hby, ["ab", "cxyz"]);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: supplied }))).kind,
      "accept",
    );
    await supplied.discard();
    // Identical decoded bytes permit different fragmentation, but the first representation remains evidence.
    const original = hby.db.essrs.get([serder.said!]).map((texter) => texter.qb64).join("");
    assertEquals(await collectPayload((await hby.db.getEssr(serder.said!))!.wire, original.length), b(original));

    const corrupt = message(sender, "uvwxyz");
    hby.db.epse.pin([corrupt.said!], corrupt);
    hby.db.essrs.add([corrupt.said!], new Texter({ raw: b("bad"), code: MtrDex.Bytes_L0 }));
    const valid = await payload(hby, ["uvw", "xyz"]);
    const decision = await run(() =>
      exchanger.processEvent({ serder: corrupt, tsgs: signatures(sender, corrupt), essr: valid })
    );
    assertEquals(decision.kind, "reject");
    await valid.discard();
    // Valid new wire cannot bless corrupt imported evidence or create contradictory accepted representations.
    assertEquals(hby.db.exns.get([corrupt.said!]), null);
    assertEquals(hby.db.exchangeMeta.get([corrupt.said!]), null);
    assertEquals(hby.db.essrs.get([corrupt.said!]).map((texter) => texter.text), ["bad"]);
    assertEquals(names(join(hby.db.path!, "payloads", "staging")), []);
  });
});

Deno.test("exchange escrow retry imports KERIpy ESSR rows through ordinary publication", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    hby.db.epse.pin([serder.said!], serder);
    hby.db.epsd.pin([serder.said!], new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }));
    for (const text of ["abc", "xyz"]) {
      hby.db.essrs.add([serder.said!], new Texter({ raw: b(text), code: MtrDex.Bytes_L0 }));
    }
    for (const group of signatures(sender, serder)) {
      for (const siger of group.sigers) hby.db.esigs.add([serder.said!, group.pre, group.snh, group.said], siger);
    }
    assertEquals(hby.db.exchangeMeta.get([serder.said!]), null);
    await hby.db.openPayloads();
    const blocked = join(hby.db.path!, "payloads", "objects", `essr.${serder.said!}`);
    await Deno.mkdir(blocked);
    // A real publication failure must preserve the prior KERIpy rows and retry ownership.
    await assertRejects(
      () => Promise.resolve(run(() => new Exchanger(hby).processEscrows())),
      Error,
      "Unexpected entry",
    );
    assertEquals(hby.db.essrs.get([serder.said!]).map((texter) => texter.text), ["abc", "xyz"]);
    assertExists(hby.db.epse.get([serder.said!]));
    await Deno.remove(blocked);
    await run(() => new Exchanger(hby).processEscrows());
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertExists(hby.db.exns.get([serder.said!]));
    assertEquals(hby.db.exchangeMeta.get([serder.said!])!.essr!.count, 2);
    // Retry snapshots borrowed rows and publishes through the same archive path.
    assertEquals(await collectPayload((await hby.db.getEssr(serder.said!))!.raw, 6), b("abcxyz"));
    assertEquals(hby.db.essrs.get([serder.said!]).map((texter) => texter.text), ["abc", "xyz"]);
  });
});

Deno.test("plaintext references reopen the inner stream separately from ciphertext evidence", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const wire = await payload(hby);
    const exchanger = new Exchanger(hby);
    await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: wire }));
    const archive = await hby.db.openPayloads();
    const sink = await archive.files.stage(12);
    await sink.write(concatBytes(b("header"), b("inside")));
    const plaintext = await sink.finish();
    const saved = await hby.db.savePlaintext(serder.said!, plaintext, 6);
    await plaintext.discard();
    assertEquals(await collectPayload(saved.body, 6), b("inside"));
    // Reopening the database also closes/reopens the archive and reconstructs body metadata.
    await run(function*() {
      yield* hby.db.reopen();
    });
    const reopened = await hby.db.getPlaintext(serder.said!);
    assertExists(reopened);
    assertEquals(await collectPayload(reopened.body, 6), b("inside"));
    assertEquals(await collectPayload((await hby.db.getEssr(serder.said!))!.raw, 6), b("abcxyz"));
    await assertRejects(() => hby.db.savePlaintext("unaccepted", reopened.plaintext, 6), Error, "unaccepted");
  });
});

Deno.test("active exchange reads exclude escrow expiry and halt joins stage cleanup", async () => {
  await scenario(async (hby, sender) => {
    const exchanger = new Exchanger(hby);
    const expiring = message(sender, "stale");
    const stale = await payload(hby, ["stale"]);
    await run(() => exchanger.processEvent({ serder: expiring, essr: stale }));
    await stale.discard();
    hby.db.epsd.pin([expiring.said!], new Dater({ qb64: encodeDateTimeToDater("2020-01-01T00:00:00.000000+00:00") }));
    const serder = message(sender);
    const source = await payload(hby);
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let closed = false;
    const pending: EssrPayload = {
      ...source,
      wire: {
        size: source.wire.size,
        /** Remain in a cooperative read until the owning Effection task is halted. */
        async *open(signal) {
          try {
            entered();
            await new Promise<void>((_resolve, reject) => {
              signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
            });
            yield new Uint8Array();
          } finally {
            closed = true;
          }
        },
      },
    };
    let continued = false;
    const task = run(function*() {
      yield* exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: pending });
      continued = true;
    });
    await reading;
    // Even expired wire remains owned while a different admission holds the runtime.
    await assertRejects(() => run(() => exchanger.processEscrows()), Error, "active admission");
    assertEquals(await collectPayload((await hby.db.getEssr(expiring.said!))!.raw, 5), b("stale"));
    await task.halt();
    assertEquals(closed, true);
    assertEquals(continued, false); // Joining cleanup must not resume the cancelled caller.
    await run(() => exchanger.processEscrows());
    assertEquals(await hby.db.getEssr(expiring.said!), null);
    assertEquals(hby.db.exns.get([serder.said!]), null);
    // The original parser-owned stage remains; only the interrupted snapshot was removed.
    assertEquals((names(join(hby.db.path!, "payloads", "staging"))).length, 1);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essr: source }))).kind,
      "accept",
    );
    await source.discard();
  });
});

Deno.test("accepted ESSR decrypts, persists, and reopens as a progressive inner CESR source", async () => {
  await scenario(async (hby, sender) => {
    const recipient = hby.makeHab("recipient");
    const inner = exchange("/inner", { message: "hello" }, { sender: sender.pre })[0];
    const plain = concatBytes(b("XSCS" + sender.pre + "4AAA"), inner.raw);
    const cipher =
      new Encrypter({ verkey: recipient.kever!.verfers[0].qb64 }).encrypt({ ser: plain, code: MtrDex.X25519_Cipher_L0 })
        .raw;
    const outer = exchange("/essr/req", {}, {
      sender: sender.pre,
      diger: new Diger({ raw: Diger.digest(cipher, "E"), code: "E" }),
      modifiers: { src: sender.pre, dest: recipient.pre },
    })[0];
    const archive = await hby.db.openPayloads();
    const sink = await archive.files.stage(2048);
    // Two Texters still carry one sealed-box ciphertext and one signed digest.
    for (const part of [cipher.subarray(0, 13), cipher.subarray(13)]) {
      await sink.write(new Texter({ raw: part, code: MtrDex.Bytes_L0 }).qb64b);
    }
    const incoming = essrPayload(await sink.finish(), 2, cipher.length, Vrsn_1_0);
    const exchanger = new Exchanger(hby);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder: outer, tsgs: signatures(sender, outer), essr: incoming })))
        .kind,
      "accept",
    );
    await incoming.discard();
    const retained = await hby.db.getEssr(outer.said!);
    const decision = await run(() =>
      new EssrRecipient(recipient, archive.files, 4096).decrypt(outer.said!, retained!.raw)
    );
    switch (decision.kind) {
      case "accept":
        break;
      case "refuse":
        throw new Error(`Unexpected ESSR admission refusal: ${decision.reason}`);
      case "reject":
        throw new Error(`Unexpected ESSR verification failure: ${decision.reason}`);
      default:
        decision satisfies never;
    }
    const decoded = decision.message;
    await hby.db.savePlaintext(outer.said!, decoded.plaintext, decoded.plaintext.size - decoded.body.size);
    await decoded.plaintext.discard(); // Archive adoption protects both stored ciphertext and plaintext.
    await run(function*() {
      yield* hby.db.reopen();
    });
    const reopened = (await hby.db.getPlaintext(outer.said!))!;
    let seen = 0;
    for await (const frame of parse(reopened.body.open())) {
      seen++;
      assertEquals(frame.body.raw, inner.raw);
    }
    assertEquals(seen, 1);
    assertEquals(await collectPayload((await hby.db.getEssr(outer.said!))!.raw, 4096), cipher);
  });
});

Deno.test("exchange retries preserve first escrow time and expiration releases payload ownership", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const incoming = await payload(hby);
    const exchanger = new Exchanger(hby);
    assertEquals((await run(() => exchanger.processEvent({ serder, essr: incoming }))).kind, "escrow");
    await incoming.discard();
    // KERIpy Dater uses six fractional digits and an explicit UTC offset.
    const first = new Dater({
      qb64: encodeDateTimeToDater(new Date(Date.now() - 1000).toISOString().replace("Z", "000+00:00")),
    });
    hby.db.epsd.pin([serder.said!], first);
    await run(() => exchanger.processEscrows());
    assertEquals(hby.db.epsd.get([serder.said!])!.qb64, first.qb64);
    assertEquals(names(join(hby.db.path!, "payloads", "staging")), []);
    hby.db.epsd.pin([serder.said!], new Dater({ qb64: encodeDateTimeToDater("2020-01-01T00:00:00.000000+00:00") }));
    await run(() => exchanger.processEscrows());
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertEquals(hby.db.essrs.get([serder.said!]), []);
    assertEquals(await hby.db.getEssr(serder.said!), null);
    assertEquals(names(join(hby.db.path!, "payloads", "objects")), []);
  });
});

Deno.test("payload recovery removes interrupted ESSR rows and retains KERIpy exchange owners", async () => {
  await scenario(async (hby, sender) => {
    const accepted = message(sender, "accepted");
    const escrowed = message(sender, "escrowed");
    const orphaned = [message(sender, "orphan-a"), message(sender, "orphan-b"), message(sender, "orphan-c")];
    hby.db.exns.put([accepted.said!], accepted);
    hby.db.epse.put([escrowed.said!], escrowed);
    for (const serder of [accepted, escrowed, ...orphaned]) {
      // Multiple rows per owner exercise deletion while the key-only cursor advances.
      hby.db.essrs.put([serder.said!], [
        new Texter({ raw: b("abc"), code: MtrDex.Bytes_L0 }),
        new Texter({ raw: b("xyz"), code: MtrDex.Bytes_L0 }),
      ]);
    }
    await hby.db.openPayloads();
    for (const serder of orphaned) assertEquals(hby.db.essrs.get([serder.said!]), []);
    for (const serder of [accepted, escrowed]) {
      assertEquals(hby.db.essrs.get([serder.said!]).map((item) => item.text), ["abc", "xyz"]);
      assertEquals(hby.db.exchangeMeta.get([serder.said!]), null);
    }
  });
});
