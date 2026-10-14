import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  concatBytes,
  Counter,
  CtrDexV1,
  CtrDexV2,
  Diger,
  Indexer,
  NumberPrimitive,
  parseBytes,
  parseCounterFromText,
  Prefixer,
  Seqner,
  type Siger,
  Signer,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { messageAttachmentGroups, messagize, serializeMessage } from "../../../src/core/protocol-serialization.ts";

const SENDER = "EDmvqjn9t8x9zkPHCgn_QxTHlP-1v-qqJh-zdg7CrXVe";

function signerMessage(route = "/test", gvrsn = Vrsn_1_0) {
  const [serder] = exchange(route, {}, { sender: SENDER, gvrsn });
  const signer = Signer.random({ transferable: true });
  return {
    serder,
    sigers: [signer.sign(serder.raw, { index: 0 }) as Siger],
  };
}

function firstAttachmentCounter(message: Uint8Array, bodySize: number, version = Vrsn_1_0): Counter {
  return parseCounterFromText(message.slice(bodySize), version);
}

Deno.test("protocol serialization rejects non-quadlet pathed material", () => {
  const [serder] = exchange("/test", {}, { sender: SENDER });

  assertThrows(
    () => serializeMessage(serder, { pathed: [new Uint8Array([1, 2, 3])] }),
    ValidationError,
    "nonintegral quadlets",
  );
});

Deno.test("protocol exchange rejects non-quadlet embedded attachment tails", () => {
  const [embedded] = exchange("/embedded", {}, { sender: SENDER });
  const badEmbedded = concatBytes(embedded.raw, new Uint8Array([1, 2, 3]));

  assertThrows(
    () => exchange("/outer", {}, { sender: SENDER, embeds: { evt: badEmbedded } }),
    Error,
    "not quadlet aligned",
  );
});

Deno.test("protocol messagize emits v1 flat signature counters by default", () => {
  const { serder, sigers } = signerMessage();
  const message = messagize(serder, { sigers });
  const counter = firstAttachmentCounter(message, serder.raw.length, Vrsn_1_0);

  assertEquals(counter.code, CtrDexV1.ControllerIdxSigs);
  assertEquals(counter.count, 1);
});

Deno.test("protocol messagize emits v2 enclosed signature counters with gvrsn", () => {
  const { serder, sigers } = signerMessage();
  const message = messagize(serder, { sigers, gvrsn: Vrsn_2_0 });
  const counter = firstAttachmentCounter(message, serder.raw.length, Vrsn_2_0);

  assertEquals(counter.code, CtrDexV2.ControllerIdxSigs);
  assertEquals(counter.count, sigers[0]!.qb64b.length / 4);
});

Deno.test("protocol messagize raises attachment gvrsn to serder gvrsn", () => {
  const [serder] = exchange("/test", {}, { sender: SENDER, pvrsn: Vrsn_2_0 });
  const signer = Signer.random({ transferable: true });
  const sigers = [signer.sign(serder.raw, { index: 0 }) as Siger];
  const message = messagize(serder, { sigers, gvrsn: Vrsn_1_0 });
  const counter = firstAttachmentCounter(message, serder.raw.length, Vrsn_2_0);

  assertEquals(counter.code, CtrDexV2.ControllerIdxSigs);
});

Deno.test("protocol messagize nested wrapping forces v2", () => {
  const { serder, sigers } = signerMessage();
  const message = messagize(serder, { sigers, nested: true });
  const counter = parseCounterFromText(message, Vrsn_2_0);

  assertEquals(counter.code, CtrDexV2.BodyWithAttachmentGroup);
});

Deno.test("protocol messagize genusify prefixes a genus-version selector", () => {
  const { serder, sigers } = signerMessage();
  const message = messagize(serder, { sigers, genusify: true });

  assertEquals(message.slice(0, Counter.makeGVC(Vrsn_1_0).length), Counter.makeGVC(Vrsn_1_0));
});

Deno.test("protocol exchange pathed embeds use requested gvrsn", () => {
  const embedded = signerMessage("/embedded");
  const embeddedWire = messagize(embedded.serder, { sigers: embedded.sigers, gvrsn: Vrsn_2_0 });
  const [, attachments] = exchange("/outer", {}, {
    sender: SENDER,
    embeds: { evt: embeddedWire },
    gvrsn: Vrsn_2_0,
  });
  const counter = parseCounterFromText(attachments, Vrsn_2_0);

  assertEquals(counter.code, CtrDexV2.PathedMaterialCouples);
});

Deno.test("protocol v2 signature serialization parses flat, sealed, and nested envelopes", async () => {
  const [serder] = exchange("/test", {}, { sender: SENDER, pvrsn: Vrsn_2_0, gvrsn: Vrsn_2_0 });
  const signer = Signer.random({ transferable: true });
  const sigers = [signer.sign(serder.raw, { index: 0 }) as Siger];
  const prefix = new Prefixer({ qb64: SENDER });
  const digest = new Diger({ qb64: serder.said! });
  for (const seal of [undefined, { i: prefix }, { i: prefix, s: "0", d: digest }]) {
    for (const nested of [false, true]) {
      const message = messagize(serder, { sigers, seal, nested, gvrsn: Vrsn_2_0, genusify: true });
      const frames = await parseBytes(message);
      assertEquals(frames.length, 1, `seal=${JSON.stringify(seal)} nested=${nested}`);
      const group = frames[0].attachments[0];
      const parsedSigs = group.items.flat(2).filter((item) => item instanceof Indexer);
      assertEquals(parsedSigs.map((siger) => siger.qb64), sigers.map((siger) => siger.qb64));
      assertEquals(group.items.length, 1);
    }
  }
});

Deno.test("messagize aggregates ordered stored reply groups with actual 714 counters", async () => {
  const { serder, sigers } = signerMessage();
  const groups = ["0AAAAAAAAAAAAAAAAAAAAAAA", "0AAAAAAAAAAAAAAAAAAAAAAB"].map((qb64) =>
    new TransIdxSigGroup(
      new Prefixer({ qb64: SENDER }),
      new Seqner({ qb64 }),
      new Diger({ qb64: serder.said! }),
      sigers,
    )
  );
  for (const gvrsn of [Vrsn_1_0, Vrsn_2_0]) {
    const wire = messagize(serder, { tsgs: groups, pipelined: true, gvrsn });
    // Independent 714 Hab.loadEndRole/fetchTsgs/messagize observation, two one-signature groups.
    assertEquals(
      new TextDecoder().decode(wire.slice(serder.raw.length, serder.raw.length + 8)),
      gvrsn.major === 1 ? "-VBn-FAC" : "-CBn-XBm",
    );
    const [frame] = await parseBytes(concatBytes(Counter.makeGVC(gvrsn), wire));
    const seals = frame.attachments[0].items as readonly (readonly { qb64: string }[])[];
    assertEquals(seals.map((seal) => seal[1].qb64), ["0AAAAAAAAAAAAAAAAAAAAAAA", "0AAAAAAAAAAAAAAAAAAAAAAB"]);
  }
  assertThrows(() => messagize(serder, { tsgs: [] }), ValidationError, "Missing attached signatures");
});

Deno.test("exchange signature groups preserve supplied v2 ordinals and widen only v1 Numbers", async () => {
  const { serder, sigers } = signerMessage();
  // Frozen Python 927c0cb8 Number(num=1) and Seqner(sn=1) produce these distinct qualified bytes.
  const compact = NumberPrimitive.fromNum(1n);
  const fixed = new Seqner({ qb64: "0AAAAAAAAAAAAAAAAAAAAAAB" });
  assertEquals(compact.qb64, "MAAB");
  for (const ordinal of [compact, fixed]) {
    const tsg = new TransIdxSigGroup(
      new Prefixer({ qb64: SENDER }),
      ordinal,
      new Diger({ qb64: serder.said! }),
      sigers,
    );
    for (const gvrsn of [Vrsn_1_0, Vrsn_2_0]) {
      const groups = messageAttachmentGroups({ tsgs: [tsg] }, gvrsn);
      const expected = gvrsn.major === 1 ? "0AAAAAAAAAAAAAAAAAAAAAAB" : ordinal.qb64;
      // Inspect both the actual wire span and parser readback, without relying only on a same-codec round trip.
      assertEquals(new TextDecoder().decode(groups[0].raw.slice(48, 48 + expected.length)), expected);
      const [frame] = await parseBytes(serializeMessage(serder, { tsgs: [tsg], gvrsn, genusify: true }));
      assertEquals((frame.attachments[0].items[0] as readonly { qb64: string }[])[1].qb64, expected);
      if (gvrsn.major === 2) assertEquals((groups[0].items[0] as readonly unknown[])[1], ordinal);
      const [live] = await parseBytes(messagize(serder, { tsgs: [tsg], gvrsn, pipelined: true, genusify: true }));
      assertEquals((live.attachments[0].items[0] as readonly { qb64: string }[])[1].qb64, expected);
    }
  }
});
