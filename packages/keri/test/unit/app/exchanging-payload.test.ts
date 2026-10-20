import {
  b,
  Dater,
  Diger,
  NumberPrimitive,
  parse,
  Prefixer,
  type SerderKERI,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { encodeDateTimeToDater } from "../../../src/time/mod.ts";
import { protocolFixture } from "../../protocol-fixture.ts";

/** Keep acceptance on real signature and LMDB paths. */
async function scenario(test: (hby: Habery, sender: Hab) => Promise<void>): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      yield* call(() => test(hby, hby.makeHab("sender")));
    } finally {
      yield* hby.close(true);
    }
  });
}

/** Fragment identity is independent of its position in the committed sequence. */
function payload(parts = ["abc", "xyz"]): Texter[] {
  return parts.map((part) => new Texter({ raw: b(part), code: "4B" }));
}

/** Commit the concatenated raw bytes, without signing fragment boundaries. */
function message(sender: Hab, raw = "abcxyz"): SerderKERI {
  return exchange("/essr/test", {}, {
    sender: sender.pre,
    diger: new Diger({ raw: Diger.digest(b(raw), "E"), code: "E" }),
  })[0];
}

/** Authenticate the actual signed EXN at the sender's historical establishment coordinate. */
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

Deno.test("ESSR persistence preserves repeated fragments, first wire and receipt; digest mismatch cannot replace them", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender, "abcabc"), exchanger = new Exchanger(hby);
    const tsgs = signatures(sender, serder), receipt = "2026-10-20T12:00:00.000000+00:00";
    const input = { serder, tsgs, essrs: payload(["abc", "abc"]), receiverTime: receipt };
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
    assertEquals(hby.db.getEssrs(serder.said!)!.map((texter) => texter.text), ["abc", "abc"]);
    assertEquals(hby.db.essrs.getOn([serder.said!], 0)!.qb64, hby.db.essrs.getOn([serder.said!], 1)!.qb64);
    assertEquals((await run(() => exchanger.processEvent({ ...input, essrs: payload(["abcabc"]) }))).kind, "accept");
    assertEquals(hby.db.getEssrs(serder.said!)!.map((texter) => texter.text), ["abc", "abc"]);
    assertEquals((await run(() => exchanger.processEvent({ ...input, essrs: payload(["abc"]) }))).kind, "reject");
    assertEquals(hby.db.getEssrs(serder.said!)!.map((texter) => texter.text), ["abc", "abc"]);
    assertEquals(hby.db.exchangeMeta.get([serder.said!])!.receiverTime, receipt);
    assertEquals((await run(() => exchanger.processEvent({ serder }))).kind, "escrow");
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertExists(hby.db.exns.get([serder.said!]));
    await assertRejects(() => Deno.stat(`${hby.db.path}/payloads`), Deno.errors.NotFound);
    for (const table of ["payload.refs.", "payload.owners.", "plaintext.meta.", "enst.stage."]) {
      assertEquals(hby.db.env!.getBinary(b(table)), undefined);
    }
  });
});

Deno.test("ESSR accepted evidence survives restart and replays its v1/v2 genus with repeated byte commitments", async () => {
  const headDirPath = await Deno.makeTempDir(), name = "essr-restart";
  try {
    await run(function*() {
      let hby = yield* createHabery({ name, headDirPath, skipConfig: true });
      try {
        const sender = hby.makeHab("sender"), exchanger = new Exchanger(hby);
        const messages: SerderKERI[] = [];
        for (const gvrsn of [Vrsn_1_0, Vrsn_2_0]) {
          const text = `v${gvrsn.major}`, serder = message(sender, text + text);
          messages.push(serder);
          assertEquals(
            (yield* exchanger.processEvent({
              serder,
              tsgs: signatures(sender, serder),
              essrs: payload([text, text]),
              gvrsn,
            })).kind,
            "accept",
          );
        }
        yield* hby.close();
        hby = yield* createHabery({ name, headDirPath, skipConfig: true });
        const restarted = new Exchanger(hby);
        for (const [index, serder] of messages.entries()) {
          const raw = b(`v${index + 1}v${index + 1}`);
          const retained = hby.db.getEssrs(serder.said!)!;
          assertEquals(retained.length, 2);
          assertEquals(new Diger({ qb64: serder.a as string }).verifyChunks(retained.map((part) => part.raw)), true);
          let count = 0;
          yield* call(async () => {
            for await (const frame of parse(restarted.replay(serder.said!))) {
              count++;
              assertEquals(frame.gvrsn?.major, index + 1);
              assertEquals(frame.body.raw, serder.raw);
              assertEquals(frame.essrs!.map((part) => part.text).join(""), new TextDecoder().decode(raw));
              assertEquals(frame.essrs!.length, 2);
            }
          });
          assertEquals(count, 1);
        }
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("ESSR missing-state escrow reconstructs repeated fragments after restart and public KEL recovery", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    await run(function*() {
      const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      let target = yield* createHabery({ name: "essr-retry", headDirPath, skipConfig: true });
      try {
        const sender = source.makeHab("sender"), serder = message(sender, "abcabc");
        const input = {
          serder,
          tsgs: signatures(sender, serder),
          essrs: payload(["abc", "abc"]),
          mailboxAid: "endpoint-provenance",
        };
        assertEquals((yield* new Exchanger(target).processEvent(input)).kind, "escrow");
        const receipt = target.db.epsd.get([serder.said!])!.qb64;
        yield* target.close();
        target = yield* createHabery({ name: "essr-retry", headDirPath, skipConfig: true });
        let handled = 0;
        const exchanger = new Exchanger(target, {
          handlers: [{
            resource: "/essr/test",
            handle(args) {
              handled++;
              assertEquals(args.essrs!.map((part) => part.text), ["abc", "abc"]);
              assertEquals(args.mailboxAid, "endpoint-provenance");
            },
          }],
        });
        yield* exchanger.processEscrows();
        assertEquals(target.db.epsd.get([serder.said!])!.qb64, receipt);
        yield* new Reactor(protocolFixture(target)).processBytes(
          acceptedEventReplayMessage(source, sender.pre, 0).message,
        );
        yield* exchanger.processEscrows();
        assertEquals(exchanger.complete(serder.said!), true);
        assertEquals(target.db.epse.get([serder.said!]), null);
        assertEquals(target.db.getEssrs(serder.said!)!.map((part) => part.text), ["abc", "abc"]);
        yield* exchanger.processEscrows();
        assertEquals(handled, 1);
      } finally {
        yield* target.close();
        yield* source.close(true);
      }
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("ESSR fragment publication failure rolls back body, proofs, fragments and receipt", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender, "abcabc"), exchanger = new Exchanger(hby);
    const pin = hby.db.essrs.pinOn;
    hby.db.essrs.pinOn = function(keys, on, texter) {
      const result = pin.call(this, keys, on, texter);
      return on === 1 ? false : result;
    };
    try {
      await assertRejects(
        () =>
          run(() =>
            exchanger.processEvent({ serder, tsgs: signatures(sender, serder), essrs: payload(["abc", "abc"]) })
          ),
        Error,
        "ESSR fragment write failed",
      );
      assertEquals(hby.db.exns.get([serder.said!]), null);
      assertEquals(hby.db.esigs.getTopItemIter([serder.said!]).next().done, true);
      assertEquals(hby.db.essrs.cntOn([serder.said!]), 0);
      assertEquals(hby.db.exchangeMeta.get([serder.said!]), null);
    } finally {
      hby.db.essrs.pinOn = pin;
    }
  });
});

Deno.test("ESSR expired escrow removes only pending evidence and retains its first receipt until expiry", async () => {
  await scenario(async (hby, sender) => {
    const serder = message(sender), exchanger = new Exchanger(hby);
    assertEquals((await run(() => exchanger.processEvent({ serder, essrs: payload() }))).kind, "escrow");
    const first = hby.db.epsd.get([serder.said!])!;
    await run(() => exchanger.processEscrows());
    assertEquals(hby.db.epsd.get([serder.said!])!.qb64, first.qb64);
    hby.db.epsd.pin([serder.said!], new Dater({ qb64: encodeDateTimeToDater("2020-01-01T00:00:00.000000+00:00") }));
    await run(() => exchanger.processEscrows());
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertEquals(hby.db.getEssrs(serder.said!), null);
    assertEquals(hby.db.essrs.cntOn([serder.said!]), 0);
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
      assertExists(hby.db.exchangeMeta.get([said])?.gvrsn);
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
