import {
  b,
  collectPayload,
  concatBytes,
  Dater,
  Diger,
  Encrypter,
  MtrDex,
  NumberPrimitive,
  parse,
  parseBytes,
  type Payload,
  Prefixer,
  type SerderKERI,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { essrRaw, essrWire } from "../../../../cesr/src/parser/essr.ts";
import { EssrRecipient } from "../../../src/app/essr.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
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

/** Ordinary fragments share one signed concatenated-byte commitment. */
function payload(parts = ["abc", "xyz"]): Texter[] {
  return parts.map((part) => new Texter({ raw: b(part), code: MtrDex.Bytes_L0 }));
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

Deno.test("exchange persists ordinary fragments and preserves the first accepted wire representation", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const incoming = payload();
    const exchanger = new Exchanger(hby);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: incoming }))).kind,
      "accept",
    );

    const stored = await hby.db.getEssrs(serder.said!);
    assertExists(stored);
    assertEquals(await collectPayload(essrRaw(stored)), b("abcxyz"));
    assertEquals([...hby.db.essrs.getIter([serder.said!])].map((item) => item.text), ["abc", "xyz"]);
    const reframed = payload(["ab", "cxyz"]);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: reframed }))).kind,
      "accept",
    );
    assertEquals([...hby.db.essrs.getIter([serder.said!])].map((item) => item.text), ["abc", "xyz"]);
    // An incomplete attempt remains pending but cannot downgrade accepted ownership.
    assertEquals((await run(() => exchanger.processEvent({ serder }))).kind, "escrow");
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertEquals((names(join(hby.db.path!, "payloads", "objects"))).length, 1);
    assertEquals(names(join(hby.db.path!, "payloads", "staging")), []);
  });
});

Deno.test("overlapping same-SAID admissions preserve the first committed wire and receiver receipt", async () => {
  await scenario(async (hby, sender) => {
    const archive = await hby.db.openPayloads();
    const stage = archive.files.stage.bind(archive.files);
    let resume!: () => void, entered!: () => void, first = true;
    const preparing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    archive.files.stage = async (signal) => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return await stage(signal);
    };
    const serder = message(sender), proof = signatures(sender, serder);
    const earlier = new Exchanger(hby), later = new Exchanger(hby);
    const incoming = payload(["a", "bcxyz"]);
    const receipt = "2026-10-20T12:00:01.000000+00:00";
    const pending = run(() =>
      earlier.processEvent({
        serder,
        tsgs: proof,
        essrs: payload(),
        receiverTime: "2026-10-20T12:00:00.000000+00:00",
      })
    );
    try {
      await preparing;
      assertEquals(
        (await run(() => later.processEvent({ serder, tsgs: proof, essrs: incoming, receiverTime: receipt }))).kind,
        "accept",
      );
    } finally {
      resume();
      await pending;
    }
    assertEquals(hby.db.exchangeMeta.get([serder.said!])?.receiverTime, receipt);
    assertEquals(
      (await hby.db.getEssrs(serder.said!))!.map((texter) => texter.qb64),
      incoming.map((texter) => texter.qb64),
    );
    assertEquals(names(join(hby.db.path!, "payloads", "staging")), []);
    assertEquals(names(join(hby.db.path!, "payloads", "objects")).length, 1);
  });
});

Deno.test("exchange admission uses KEL evidence learned while payload preparation is suspended", async () => {
  await scenario(async (source, sender) => {
    await run(function*() {
      const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      let resume!: () => void, entered!: () => void;
      const preparing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      try {
        const archive = yield* call(() => receiver.db.openPayloads());
        const stage = archive.files.stage.bind(archive.files);
        archive.files.stage = async (signal) => {
          entered();
          await gate;
          return await stage(signal);
        };
        const serder = message(sender), proof = signatures(sender, serder);
        const exchanger = new Exchanger(receiver);
        const task = yield* spawn(() => exchanger.processEvent({ serder, tsgs: proof, essrs: payload() }));
        try {
          try {
            yield* call(() => preparing);
            assertEquals(receiver.db.getKever(sender.pre), null);
            sender.rotate();
            for (const sn of [0, 1]) {
              const wire = acceptedEventReplayMessage(source, sender.pre, sn).message;
              for (const frame of parseBytes(wire)) {
                yield* dispatchEnvelope(envelopeFromFrame(frame), receiver.rvy, receiver.kevery);
              }
            }
            assertEquals(receiver.db.getKever(sender.pre)?.sn, 1);
          } finally {
            resume();
          }
          assertEquals((yield* task).kind, "accept");
          assertExists(receiver.db.exns.get([serder.said!]));
          assertEquals(receiver.db.epse.get([serder.said!]), null);
        } finally {
          resume();
          yield* task.halt();
        }
      } finally {
        resume();
        yield* receiver.close(true);
      }
    });
  });
});

Deno.test("exchange escrow reopens owned wire and retains mailbox provenance on acceptance", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const incoming = payload();
    const seen: string[] = [];
    let missing = true;
    const schema = new Diger({ raw: Diger.digest(b("pending schema"), "E"), code: "E" }).qb64;
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/essr/test",
        verify() {
          return missing ? { kind: "escrow" as const, reason: "missing schema", schema } : true;
        },
        handle({ mailboxAid }) {
          seen.push(mailboxAid!);
        },
      }],
    });
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, essrs: incoming, mailboxAid: sender.pre }))).kind,
      "escrow",
    );
    assertEquals(hby.db.exns.get([serder.said!]), null);
    const group = signatures(sender, serder)[0];
    // Later signatures can arrive independently; retry must use the stored ESSR owner.
    for (const siger of group.sigers) hby.db.esigs.add([serder.said!, group.pre, group.snh, group.said], siger);
    await run(() => exchanger.processEscrows());
    assertExists(hby.db.emse!.get([serder.said!, schema]));
    assertEquals(hby.db.exns.get([serder.said!]), null);
    await run(function*() {
      yield* hby.db.close();
      yield* hby.db.reopen({ reuse: true });
    });
    assertEquals(await collectPayload(essrRaw((await hby.db.getEssrs(serder.said!))!)), b("abcxyz"));
    missing = false;
    await run(() => exchanger.processEscrows());
    assertEquals(seen, [sender.pre]);
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertExists(hby.db.exns.get([serder.said!]));
    assertEquals(await collectPayload(essrRaw((await hby.db.getEssrs(serder.said!))!)), b("abcxyz"));
  });
});

Deno.test("exchange escrow retry preserves evidence when its stored payload reader fails", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const said = serder.said!;
    const incoming = payload();
    const exchanger = new Exchanger(hby);
    assertEquals((await run(() => exchanger.processEvent({ serder, essrs: incoming }))).kind, "escrow");
    const group = signatures(sender, serder)[0];
    for (const siger of group.sigers) hby.db.esigs.add([said, group.pre, group.snh, group.said], siger);
    const failure = new Deno.errors.PermissionDenied("stored ESSR reader cannot open its file");
    const getEssrs = hby.db.getEssrs;
    hby.db.getEssrs = () => Promise.reject(failure);
    try {
      assertStrictEquals(await assertRejects(() => run(() => exchanger.processEscrows())), failure);
      assertExists(hby.db.epse.get([said]));
      assertEquals(hby.db.esigs.get([said, group.pre, group.snh, group.said]).length, group.sigers.length);
      assertExists(hby.db.exchangeMeta.get([said]));
      assertExists(await (await hby.db.openPayloads()).get(`essr/${said}`));
      assertEquals(exchanger.complete(said), false);
    } finally {
      hby.db.getEssrs = getEssrs;
    }
    await run(() => exchanger.processEscrows());
    assertEquals(exchanger.complete(said), true);
    assertEquals(hby.db.epse.get([said]), null);
    assertEquals(await collectPayload(essrRaw((await hby.db.getEssrs(said))!)), b("abcxyz"));
  });
});

Deno.test("exchange rejects digest failures before publishing wire or invoking handlers", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const incoming = payload(["wrong"]);
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
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: incoming }))).kind,
      "reject",
    );
    assertEquals(handled, 0);
    assertEquals(hby.db.exns.get([serder.said!]), null);
    assertEquals(hby.db.essrs.get([serder.said!]), []);
    assertEquals(await hby.db.getEssrs(serder.said!), null);
  });
});

Deno.test("exchange replay streams v1 and v2 ESSR through a fresh buffered parser", async () => {
  await scenario(async (hby, sender) => {
    for (const gvrsn of [Vrsn_1_0, Vrsn_2_0]) {
      const serder = message(sender, `v${gvrsn.major}`);
      const incoming = payload([`v${gvrsn.major}`]);
      const exchanger = new Exchanger(hby);
      assertEquals(
        (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: incoming, gvrsn })))
          .kind,
        "accept",
      );
      let frames = 0;
      for await (const frame of parse(exchanger.replay(serder.said!))) {
        frames++;
        assertEquals(frame.body.raw, serder.raw);
        assertEquals(await collectPayload(essrRaw(frame.essrs!)), b(`v${gvrsn.major}`));
      }
      assertEquals(frames, 1);
      const controller = new AbortController(), reason = new Error("stop before replayed ESSR");
      const replay = exchanger.replay(serder.said!, controller.signal);
      assertEquals((await replay.next()).done, false); // Publish the body, then cancel before ESSR.
      controller.abort(reason);
      assertStrictEquals(await assertRejects(() => replay.next()), reason);
      await replay.return(undefined);
    }
  });
});

Deno.test("exchange replay reads KERIpy ESSR rows without private metadata", async () => {
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
      assertEquals(frame.essrs!.length, 2);
      assertEquals(await collectPayload(essrRaw(frame.essrs!)), b("abcxyz"));
    }
    assertEquals(frames, 1);
    assertEquals(hby.db.exchangeMeta.get([serder.said!]), null); // Replay does not introduce a second publication path.
    assertEquals((await hby.db.getEssrs(serder.said!))!.map((texter) => texter.text), ["abc", "xyz"]);
    assertEquals(hby.db.essrs.get([serder.said!]).map((texter) => texter.text), ["abc", "xyz"]);
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
    const invalid = payload(["bad"]);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: invalid }))).kind,
      "reject",
    );
    assertEquals(hby.db.exchangeMeta.get([serder.said!]), null);
    const supplied = payload(["ab", "cxyz"]);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: supplied }))).kind,
      "accept",
    );
    // Identical decoded bytes permit different fragmentation, but the first representation remains evidence.
    const original = hby.db.essrs.get([serder.said!]).map((texter) => texter.qb64).join("");
    assertEquals(await collectPayload(essrWire((await hby.db.getEssrs(serder.said!))!)), b(original));

    const corrupt = message(sender, "uvwxyz");
    hby.db.epse.pin([corrupt.said!], corrupt);
    hby.db.essrs.add([corrupt.said!], new Texter({ raw: b("bad"), code: MtrDex.Bytes_L0 }));
    const valid = payload(["uvw", "xyz"]);
    const decision = await run(() =>
      exchanger.processEvent({ serder: corrupt, tsgs: signatures(sender, corrupt), essrs: valid })
    );
    assertEquals(decision.kind, "reject");
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
    const blocked = join(hby.db.path!, "payloads", "objects");
    await Deno.remove(blocked);
    await Deno.writeFile(blocked, b("not a directory"));
    // A real publication failure must preserve the prior KERIpy rows and retry ownership.
    await assertRejects(
      () => Promise.resolve(run(() => new Exchanger(hby).processEscrows())),
      Deno.errors.AlreadyExists,
    );
    assertEquals(hby.db.essrs.get([serder.said!]).map((texter) => texter.text), ["abc", "xyz"]);
    assertExists(hby.db.epse.get([serder.said!]));
    await Deno.remove(blocked);
    await Deno.mkdir(blocked);
    await run(() => new Exchanger(hby).processEscrows());
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertExists(hby.db.exns.get([serder.said!]));
    assertEquals((await hby.db.getEssrs(serder.said!))!.length, 2);
    // Retry snapshots borrowed rows and publishes through the same archive path.
    assertEquals(await collectPayload(essrRaw((await hby.db.getEssrs(serder.said!))!)), b("abcxyz"));
    assertEquals(hby.db.essrs.get([serder.said!]).map((texter) => texter.text), ["abc", "xyz"]);
  });
});

Deno.test("plaintext references reopen the inner stream separately from ciphertext evidence", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const wire = payload();
    const exchanger = new Exchanger(hby);
    await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: wire }));
    const archive = await hby.db.openPayloads();
    const sink = await archive.files.stage();
    await sink.write(concatBytes(b("header"), b("inside")));
    const plaintext = await sink.finish();
    const saved = await hby.db.savePlaintext(serder.said!, plaintext, 6);
    await plaintext.discard();
    assertEquals(await collectPayload(saved.body), b("inside"));
    // Reopening the database also closes/reopens the archive and reconstructs body metadata.
    await run(function*() {
      yield* hby.db.reopen();
    });
    const reopened = await hby.db.getPlaintext(serder.said!);
    assertExists(reopened);
    assertEquals(await collectPayload(reopened.body), b("inside"));
    assertEquals(await collectPayload(essrRaw((await hby.db.getEssrs(serder.said!))!)), b("abcxyz"));
    await assertRejects(() => hby.db.savePlaintext("unaccepted", reopened.plaintext, 6), Error, "unaccepted");
  });
});

Deno.test("plaintext publication validates its offset against the current committed reference", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    await run(() => new Exchanger(hby).processEvent({ serder, tsgs: signatures(sender, serder), essrs: payload() }));
    let resume!: () => void, entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const pending: Payload = {
      size: 3,
      /** Hold byte preparation while a competing authenticated offset is committed. */
      async *open() {
        entered();
        await gate;
        yield b("abc");
      },
    };
    const saving = hby.db.savePlaintext(serder.said!, pending, 1);
    await reading;
    try {
      await hby.db.savePlaintext(serder.said!, {
        size: 3,
        async *open() {
          yield b("abc");
        },
      }, 2);
    } finally {
      resume();
    }
    await assertRejects(() => saving, Error, "offset conflicts");
    assertEquals(await collectPayload((await hby.db.getPlaintext(serder.said!))!.body), b("c"));
  });
});

Deno.test("accepted ESSR decrypts, persists, and reopens as a inner CESR source", async () => {
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
    // Two Texters carry one sealed-box ciphertext and one signed digest.
    const incoming = [cipher.subarray(0, 13), cipher.subarray(13)].map((raw) =>
      new Texter({ raw, code: MtrDex.Bytes_L0 })
    );
    const exchanger = new Exchanger(hby);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder: outer, tsgs: signatures(sender, outer), essrs: incoming })))
        .kind,
      "accept",
    );

    const retained = await hby.db.getEssrs(outer.said!);
    const decision = await run(() =>
      new EssrRecipient(recipient, archive.files).decrypt(outer.said!, essrRaw(retained!))
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
    assertEquals(await collectPayload(essrRaw((await hby.db.getEssrs(outer.said!))!)), cipher);
  });
});

Deno.test("exchange retries preserve first escrow time and expiration releases payload ownership", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender);
    const incoming = payload();
    const exchanger = new Exchanger(hby);
    assertEquals((await run(() => exchanger.processEvent({ serder, essrs: incoming }))).kind, "escrow");
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
    assertEquals(await hby.db.getEssrs(serder.said!), null);
  });
});

Deno.test("escrow retry admits proof arriving during its payload read without another sweep", async () => {
  await scenario(async (hby) => {
    const sender = hby.makeHab("threshold", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const serder = message(sender), full = signatures(sender, serder)[0], said = serder.said!;
    const half = (index: number) => new TransIdxSigGroup(full.prefixer, full.seqner, full.diger, [full.sigers[index]]);
    const retrying = new Exchanger(hby);
    assertEquals(
      (await run(() => retrying.processEvent({ serder, tsgs: [half(0)], essrs: payload() }))).kind,
      "escrow",
    );
    const get = hby.db.getEssrs.bind(hby.db);
    let resume!: () => void, entered!: () => void, first = true;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    hby.db.getEssrs = async (key, signal) => {
      if (first && key === said) {
        first = false;
        entered();
        await gate;
      }
      return await get(key, signal);
    };
    const sweep = run(() => retrying.processEscrows());
    try {
      await reading;
      assertEquals((await run(() => retrying.processEvent({ serder, tsgs: [half(1)] }))).kind, "escrow");
    } finally {
      resume();
      await sweep;
      hby.db.getEssrs = get;
    }
    assertExists(hby.db.exns.get([said]));
    assertEquals(hby.db.epse.get([said]), null);
    assertEquals([...hby.db.esigs.getTopItemIter([said, ""])].map(([, sig]) => sig.index).sort(), [0, 1]);
  });
});

Deno.test("overlapping escrow sweeps execute the accepted handler once", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender), said = serder.said!;
    let ready = false, handled = 0;
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/essr/test",
        verify() {
          return ready ? true : { kind: "escrow", reason: "proof dependency" };
        },
        handle() {
          handled++;
        },
      }],
    });
    await run(() => exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: payload() }));
    ready = true;
    const get = hby.db.getEssrs.bind(hby.db);
    let resume!: () => void, entered!: () => void, first = true;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    hby.db.getEssrs = async (key, signal) => {
      if (first && key === said) {
        first = false;
        entered();
        await gate;
      }
      return await get(key, signal);
    };
    const pending = run(() => exchanger.processEscrows());
    try {
      await reading;
      await run(() => exchanger.processEscrows());
    } finally {
      resume();
      await pending;
      hby.db.getEssrs = get;
    }
    assertExists(hby.db.exns.get([said]));
    assertEquals(hby.db.epse.get([said]), null);
    assertEquals(handled, 1);
  });
});

Deno.test("escrow expiry cannot delete evidence accepted while its archive opens", async () => {
  await scenario(async (hby, sender) => {
    let now = Date.now();
    const serder = message(sender), said = serder.said!;
    const expiring = new Exchanger(hby, { now: () => now });
    assertEquals((await run(() => expiring.processEvent({ serder, essrs: payload() }))).kind, "escrow");
    now += 10_001;
    const open = hby.db.openPayloads.bind(hby.db);
    let resume!: () => void, entered!: () => void, first = true;
    const opening = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    hby.db.openPayloads = async (signal) => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return await open(signal);
    };
    const sweeping = run(() => expiring.processEscrows());
    try {
      await opening;
      assertEquals(
        (await run(() => new Exchanger(hby).processEvent({ serder, tsgs: signatures(sender, serder) }))).kind,
        "accept",
      );
    } finally {
      resume();
      await sweeping;
      hby.db.openPayloads = open;
    }
    assertExists(hby.db.exns.get([said]));
    assertExists(hby.db.exchangeMeta.get([said])?.essr);
    assertEquals(await collectPayload(essrRaw((await hby.db.getEssrs(said))!)), b("abcxyz"));
    assertEquals([...hby.db.esigs.getTopItemIter([said, ""])].length, 1);
  });
});

Deno.test("ESSR reads racing committed expiry return current absence rather than corruption", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender), said = serder.said!;
    const exchanger = new Exchanger(hby);
    await run(() => exchanger.processEvent({ serder, essrs: payload() }));
    const archive = await hby.db.openPayloads(), get = archive.get.bind(archive);
    let resume!: () => void, entered!: () => void;
    const opening = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    archive.get = async (key, signal) => {
      entered();
      await gate;
      return await get(key, signal);
    };
    const reading = hby.db.getEssrs(said);
    let result;
    try {
      await opening;
      hby.db.epsd.pin([said], new Dater({ qb64: encodeDateTimeToDater("2020-01-01T00:00:00.000000+00:00") }));
      await run(() => exchanger.processEscrows());
    } finally {
      resume();
      try {
        result = await reading;
      } finally {
        archive.get = get;
      }
    }
    assertEquals(result, null);
  });
});

Deno.test("cancelling an escrow sweep joins committed file reclamation", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender), said = serder.said!;
    const exchanger = new Exchanger(hby);
    await run(() => exchanger.processEvent({ serder, essrs: payload() }));
    hby.db.epsd.pin([said], new Dater({ qb64: encodeDateTimeToDater("2020-01-01T00:00:00.000000+00:00") }));
    const archive = await hby.db.openPayloads(), id = archive.referenceId(`essr/${said}`)!;
    const open = archive.files.open.bind(archive.files);
    let resume!: () => void, entered!: () => void;
    const reclaiming = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    archive.files.open = async (key) => {
      if (key === id) {
        entered();
        await gate;
      }
      return await open(key);
    };
    await run(function*() {
      const sweep = yield* spawn(() => exchanger.processEscrows());
      try {
        yield* call(() => reclaiming);
        assertEquals(archive.referenceId(`essr/${said}`), null);
        assertEquals(hby.db.epse.get([said]), null);
        let joined = false;
        const stopping = yield* spawn(function*() {
          yield* sweep.halt();
          joined = true;
        });
        yield* call(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
        assertEquals(joined, false);
        resume();
        yield* stopping;
        assertEquals(joined, true);
        assertEquals(names(join(hby.db.path!, "payloads", "objects")), []);
      } finally {
        resume();
        yield* sweep.halt();
        archive.files.open = open;
      }
    });
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

Deno.test("EXN pending cues follow persisted escrow transitions without duplicate publication", async () => {
  await scenario(async (hby, sender) => {
    const schema = new Diger({ raw: Diger.digest(b("pending schema"), "E"), code: "E" }).qb64;
    for (const outcome of ["sender", "proof", "schema"] as const) {
      const incoming = payload([outcome]);
      const serder = message(sender, outcome), said = serder.said!;
      const cues = new Deck<AgentCue>();
      const exchanger = new Exchanger(hby, {
        cues,
        handlers: [{
          resource: "/essr/test",
          verify() {
            return { kind: "escrow", reason: "dependency", ...(outcome === "schema" ? { schema } : {}) };
          },
          handle() {
            throw new Error("Pending exchange cannot dispatch");
          },
        }],
      });
      const groups = signatures(sender, serder);
      if (outcome === "sender") {
        groups[0] = new TransIdxSigGroup(
          groups[0].prefixer,
          NumberPrimitive.fromNum(99n),
          groups[0].diger,
          groups[0].sigers,
        );
      }
      const input = { serder, tsgs: groups, essrs: incoming, mailboxAid: sender.pre };
      assertEquals((await run(() => exchanger.processEvent(input))).kind, "escrow");
      const cue = cues.pull()!;
      assertEquals(cue.kin, outcome === "proof" ? "proof" : "query");
      if (cue.kin === "query") {
        assertEquals(cue.q, outcome === "schema" ? { r: "schema", said: schema } : { s: "63" });
      }
      const date = (outcome === "schema" ? hby.db.emsd! : hby.db.epsd).get([said])!.dts;
      assertEquals((await run(() => exchanger.processEvent(input))).kind, "escrow");
      assertEquals(cues.length, 0);
      assertEquals((outcome === "schema" ? hby.db.emsd! : hby.db.epsd).get([said])!.dts, date);
      assertExists(hby.db.exchangeMeta.get([said])?.essr);
      if (outcome === "schema") {
        exchanger.routes.get("/essr/test")!.verify = () => ({ kind: "escrow", reason: "proof unavailable" });
        assertEquals((await run(() => exchanger.processEvent(input))).kind, "escrow");
        assertEquals(cues.pull(), { kin: "proof", said });
        assertEquals(hby.db.emse!.get([said, schema]), null);
        assertExists(hby.db.epse.get([said]));
        assertEquals(hby.db.emsd!.get([said])!.dts, date);
      }
    }
  });
});
