import { assertEquals } from "jsr:@std/assert";
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
} from "../../../src/primitives/disclosure.ts";
import { BlindState, BoundState, TypeMedia } from "../../../src/primitives/structing.ts";
import {
  KERIPY_DISCLOSURE_HELPER_VECTORS,
  KERIPY_STRUCTING_DATA_VECTORS,
} from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("primitives/disclosure - helpers preserve KERIpy blind/bound/media commitments", () => {
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
});
