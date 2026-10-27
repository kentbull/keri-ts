import { assertEquals, assertThrows } from "jsr:@std/assert";
import { b } from "../../../../src/core/bytes.ts";
import { DigDex, NumDex } from "../../../../src/primitives/base/codex.ts";
import { Noncer } from "../../../../src/primitives/crypto/noncer.ts";
import { Salter } from "../../../../src/primitives/crypto/salter.ts";
import {
  commitBlindState,
  commitBoundState,
  commitTypeMedia,
  makeBlindState,
  makeBlindUuid,
  makeBoundState,
  makeTypeMedia,
  unblindBlindState,
  unblindBoundState,
} from "../../../../src/primitives/structuring/disclosure.ts";
import { BlindState, BoundState, TypeMedia } from "../../../../src/primitives/structuring/structing.ts";
import { Bexter } from "../../../../src/primitives/values/bexter.ts";
import { Labeler } from "../../../../src/primitives/values/labeler.ts";
import { NumberPrimitive } from "../../../../src/primitives/values/number.ts";
import {
  KERIPY_DISCLOSURE_HELPER_VECTORS,
  KERIPY_STRUCTING_DATA_VECTORS,
} from "../../../fixtures/keripy-primitive-vectors.ts";

// These tests teach the fixed-field disclosure workflow in the same order a
// maintainer should reason about it:
// 1. derive or validate the deterministic UUID
// 2. commit a blinded/bound/media record with placeholder-capable fields
// 3. search back through candidate disclosures with `unblind*`

Deno.test("primitives/disclosure - helpers preserve KERIpy blind/bound/media commitments", () => {
  // Placeholder vectors matter because KERIpy treats empty ACDC/state/bound
  // fields as real disclosure states, not as missing data.
  const placeholderBlind = makeBlindState({
    salt: KERIPY_DISCLOSURE_HELPER_VECTORS.salt,
    sn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.sn,
  });
  assertEquals(
    makeBlindUuid({
      salt: KERIPY_DISCLOSURE_HELPER_VECTORS.salt,
      sn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.sn,
    }).nonce,
    KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.uuid,
  );
  assertEquals(
    makeBlindUuid({
      raw: new Salter({ qb64: KERIPY_DISCLOSURE_HELPER_VECTORS.salt }).raw,
      salt: "ignored when raw is supplied",
      sn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.sn,
    }).nonce,
    KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.uuid,
  );
  const random = makeBlindUuid(), tierOnly = makeBlindUuid({ tier: "low" });
  assertEquals(random.raw.length, 32);
  assertEquals(tierOnly.raw.length, 32);
  assertEquals(random.nonce === tierOnly.nonce, false);
  assertEquals(BlindState.toSad(placeholderBlind), {
    d: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.said,
    u: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.uuid,
    td: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.acdc,
    ts: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.state,
  });
  assertEquals(
    unblindBlindState({
      said: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.said,
      acdc: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.acdc,
      states: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.states,
      salt: KERIPY_DISCLOSURE_HELPER_VECTORS.salt,
      sn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.sn,
    }),
    placeholderBlind,
  );

  const revokedBlind = makeBlindState({
    salt: KERIPY_DISCLOSURE_HELPER_VECTORS.salt,
    sn: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.sn,
    acdc: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.acdc,
    state: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.state,
  });
  assertEquals(BlindState.toSad(revokedBlind), {
    d: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.said,
    u: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.uuid,
    td: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.acdc,
    ts: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.state,
  });
  assertEquals(
    unblindBlindState({
      said: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.said,
      uuid: KERIPY_DISCLOSURE_HELPER_VECTORS.wrongUuid,
      acdc: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.acdc,
      states: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.states,
    }),
    null,
  );

  const placeholderBound = makeBoundState({
    salt: KERIPY_DISCLOSURE_HELPER_VECTORS.salt,
    sn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.sn,
  });
  assertEquals(BoundState.toSad(placeholderBound), {
    d: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.said,
    u: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.uuid,
    td: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.acdc,
    ts: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.state,
    bn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.bsn,
    bd: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.bd,
  });
  assertEquals(
    unblindBoundState({
      said: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.said,
      acdc: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.acdc,
      states: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.states,
      bounds: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.bounds,
      salt: KERIPY_DISCLOSURE_HELPER_VECTORS.salt,
      sn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.sn,
    }),
    placeholderBound,
  );

  const revokedBound = makeBoundState({
    salt: KERIPY_DISCLOSURE_HELPER_VECTORS.salt,
    sn: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.sn,
    acdc: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.acdc,
    state: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.state,
    bsn: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.bsn,
    bd: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.bd,
  });
  assertEquals(BoundState.toSad(revokedBound), {
    d: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.said,
    u: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.uuid,
    td: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.acdc,
    ts: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.state,
    bn: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.bsn,
    bd: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.bd,
  });
  assertEquals(
    unblindBoundState({
      said: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.said,
      uuid: KERIPY_DISCLOSURE_HELPER_VECTORS.wrongUuid,
      acdc: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.acdc,
      states: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.states,
      bounds: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.bounds,
    }),
    null,
  );

  const recommittedBlind = commitBlindState(
    BlindState.fromSad({
      d: "",
      u: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.uuid,
      td: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.acdc,
      ts: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.state,
    }),
  );
  assertEquals(recommittedBlind, revokedBlind);

  const recommittedBound = commitBoundState(
    BoundState.fromSad({
      d: "",
      u: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.uuid,
      td: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.acdc,
      ts: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.state,
      bn: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.bsn,
      bd: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBound.bd,
    }),
  );
  assertEquals(recommittedBound, revokedBound);

  const typeMedia = makeTypeMedia({
    uuid: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u,
    mt: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mt,
    mv: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mv,
  });
  assertEquals(TypeMedia.toSad(typeMedia), {
    d: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.d,
    u: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u,
    mt: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mt,
    mv: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mv,
  });
  assertEquals(
    commitTypeMedia(
      TypeMedia.fromSad({
        d: "",
        u: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u,
        mt: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mt,
        mv: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mv,
      }),
    ),
    typeMedia,
  );
  const raw = new Salter({ qb64: KERIPY_DISCLOSURE_HELPER_VECTORS.salt }).raw;
  assertEquals(
    unblindBlindState({
      said: placeholderBlind.d.nonce,
      raw,
      sn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBlind.sn,
    }),
    placeholderBlind,
  );
  assertEquals(
    unblindBoundState({
      said: placeholderBound.d.nonce,
      raw,
      sn: KERIPY_DISCLOSURE_HELPER_VECTORS.placeholderBound.sn,
    }),
    placeholderBound,
  );
  assertThrows(() => unblindBlindState({ said: placeholderBlind.d.nonce }), TypeError, "recovery");
  assertThrows(() => unblindBoundState({ said: placeholderBound.d.nonce }), TypeError, "recovery");
});

Deno.test("primitives/disclosure - exact opening bytes and declared recovery digest stay bound", async () => {
  const options = {
    uuid: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.uuid,
    acdc: KERIPY_DISCLOSURE_HELPER_VECTORS.revokedBlind.acdc,
    state: "issued",
    code: DigDex.SHA2_256,
  };
  const blind = makeBlindState(options), bound = makeBoundState({ ...options, bsn: 1, bd: options.acdc });
  const alternateText = new Labeler(new Bexter({ code: "4A", raw: Bexter.rawify("issued") }));
  const alternateNumber = new NumberPrimitive({ code: NumDex.Long, raw: new Uint8Array([0, 0, 0, 1]) });
  const alternative = BoundState.fromTuple([bound.d, bound.u, bound.td, alternateText, alternateNumber, bound.bd]);
  assertEquals(alternative.ts.text, bound.ts.text);
  assertEquals(alternative.bn.num, bound.bn.num);
  assertEquals(alternative.ts.qb64 === bound.ts.qb64, false);
  assertEquals(alternative.bn.qb64 === bound.bn.qb64, false);
  // WebCrypto is independent of the Diger hash implementation used by commitment helpers.
  const material = "#".repeat(44) + BoundState.toTuple(alternative).slice(1).map((field) => field.qb64).join("");
  const expected = new Noncer({
    code: DigDex.SHA2_256,
    raw: new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b(material)))),
  });
  const committed = commitBoundState(alternative);
  assertEquals(committed.d.nonce, expected.nonce);
  assertEquals(committed.ts.qb64, alternateText.qb64);
  assertEquals(committed.bn.qb64, alternateNumber.qb64);
  const search = { uuid: options.uuid, acdc: options.acdc, states: [options.state] };
  assertEquals(unblindBlindState({ ...search, said: blind.d.nonce }), blind);
  assertEquals(
    unblindBoundState({ ...search, said: bound.d.nonce, code: DigDex.SHA2_256, bounds: [[1, options.acdc]] }),
    bound,
  );
  assertThrows(
    () => unblindBlindState({ ...search, said: blind.d.nonce, code: DigDex.Blake3_256 }),
    TypeError,
    "match",
  );
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const padBits = blind.d.nonce[0] + alphabet[alphabet.indexOf(blind.d.nonce[1]) + 16] + blind.d.nonce.slice(2);
  assertEquals(new Noncer({ qb64: padBits }).raw, blind.d.raw, "only discarded pad bits changed");
  for (const said of ["", options.uuid, blind.d.nonce + "1AAP", padBits]) {
    assertThrows(() => unblindBlindState({ ...search, said }));
  }
});
