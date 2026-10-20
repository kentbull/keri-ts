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
  type Payload,
  Prefixer,
  type SerderKERI,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { essrRaw, essrWire } from "../../../../cesr/src/parser/essr.ts";
import { EssrRecipient } from "../../../src/app/essr.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
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
