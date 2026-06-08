// @file-test-lane core-fast-a

import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  concatBytes,
  Counter,
  CtrDexV1,
  CtrDexV2,
  parseCounterFromText,
  type Siger,
  Signer,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { messagize, serializeMessage } from "../../../src/core/protocol-serialization.ts";

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
