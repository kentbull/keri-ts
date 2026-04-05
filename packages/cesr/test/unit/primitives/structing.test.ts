import { assert, assertEquals, assertInstanceOf, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { b } from "../../../src/core/bytes.ts";
import { Diger, Labeler, Noncer, NumberPrimitive, Prefixer, Texter, Verser } from "../../../src/index.ts";
import {
  ACastDom,
  AClanDom,
  BlindState,
  BoundState,
  BSCastDom,
  BSClanDom,
  castage,
  ClanToCodens,
  CodenToClans,
  ECastDom,
  EClanDom,
  SCastDom,
  SClanDom,
  SealBack,
  SealDigest,
  SealEvent,
  SealKind,
  SealLast,
  SealRoot,
  SealSource,
  TMCastDom,
  TMClanDom,
  TypeMedia,
} from "../../../src/primitives/structing.ts";
import { KERIPY_MATTER_VECTORS, KERIPY_STRUCTING_DATA_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("primitives/structing - registry metadata mirrors KERIpy clan and coden mapping", () => {
  assertEquals(EClanDom, {});
  assertEquals(ECastDom, {});

  assertEquals(Object.keys(SClanDom), [
    "SealDigest",
    "SealRoot",
    "SealSource",
    "SealEvent",
    "SealLast",
    "SealBack",
    "SealKind",
  ]);
  assertEquals(Object.keys(BSClanDom), ["BlindState", "BoundState"]);
  assertEquals(Object.keys(TMClanDom), ["TypeMedia"]);
  assertEquals(Object.keys(AClanDom), [
    "SealDigest",
    "SealRoot",
    "SealSource",
    "SealEvent",
    "SealLast",
    "SealBack",
    "SealKind",
    "BlindState",
    "BoundState",
    "TypeMedia",
  ]);

  assertStrictEquals(SClanDom.SealEvent, SealEvent);
  assertStrictEquals(SCastDom.SealEvent, SealEvent.cast);
  assertStrictEquals(BSClanDom.BoundState, BoundState);
  assertStrictEquals(TMCastDom.TypeMedia, TypeMedia.cast);

  assertEquals(ClanToCodens, {
    SealDigest: "DigestSealSingles",
    SealRoot: "MerkleRootSealSingles",
    SealSource: "SealSourceCouples",
    SealEvent: "SealSourceTriples",
    SealLast: "SealSourceLastSingles",
    SealBack: "BackerRegistrarSealCouples",
    SealKind: "TypedDigestSealCouples",
    BlindState: "BlindedStateQuadruples",
    BoundState: "BoundStateSextuples",
    TypeMedia: "TypedMediaQuadruples",
  });
  assertEquals(CodenToClans, {
    DigestSealSingles: "SealDigest",
    MerkleRootSealSingles: "SealRoot",
    SealSourceCouples: "SealSource",
    SealSourceTriples: "SealEvent",
    SealSourceLastSingles: "SealLast",
    BackerRegistrarSealCouples: "SealBack",
    TypedDigestSealCouples: "SealKind",
    BlindedStateQuadruples: "BlindState",
    BoundStateSextuples: "BoundState",
    TypedMediaQuadruples: "TypeMedia",
  });

  assertEquals(SCastDom.SealEvent.s, castage(NumberPrimitive, "numh"));
  assertEquals(BSCastDom.BoundState.d.ipn, "nonce");
  assertEquals(BSCastDom.BoundState.bn.ipn, "numh");
  assertEquals(TMCastDom.TypeMedia.mt.ipn, "text");
  assertEquals(ACastDom.SealDigest.d.ipn, null);
});

Deno.test("primitives/structing - seal records round-trip tuple values and crew serialization", () => {
  const diger = new Diger({ qb64: KERIPY_MATTER_VECTORS.digerBlake3 });
  const prefixer = new Prefixer({
    qb64: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i,
  });
  const number = new NumberPrimitive({
    qb64: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.sQb64,
  });
  const verser = new Verser({ qb64: KERIPY_STRUCTING_DATA_VECTORS.sealKind.t });

  const sealDigest = SealDigest.fromTuple([diger]);
  assertEquals(SealDigest.toCrew(sealDigest), { d: diger.qb64 });
  assertEquals(SealDigest.qb64(sealDigest), diger.qb64);
  assertEquals(SealDigest.qb64b(sealDigest), diger.qb64b);
  assertEquals(SealDigest.qb2(sealDigest), diger.qb2);

  const sealRoot = SealRoot.fromQb64bTuple([diger.qb64b]);
  assertEquals(sealRoot.rd.qb64, diger.qb64);
  assertEquals(SealRoot.toCrew(sealRoot), { rd: diger.qb64 });

  const sealSource = SealSource.fromQb64bTuple([number.qb64b, diger.qb64b]);
  assertEquals(sealSource.s.num, 14n);
  assertEquals(sealSource.s.numh, KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s);
  assertEquals(SealSource.toCrew(sealSource), {
    s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
    d: diger.qb64,
  });

  const sealEvent = SealEvent.fromQb64bTuple([
    prefixer.qb64b,
    number.qb64b,
    diger.qb64b,
  ]);
  assertEquals(sealEvent.i.qb64, prefixer.qb64);
  assertEquals(sealEvent.s.num, 14n);
  assertEquals(sealEvent.s.numh, KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s);
  assertEquals(sealEvent.d.qb64, diger.qb64);
  assertEquals(SealEvent.toCrew(sealEvent), {
    i: prefixer.qb64,
    s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
    d: diger.qb64,
  });
  assertEquals(
    SealEvent.qb64(sealEvent),
    KERIPY_STRUCTING_DATA_VECTORS.sealEvent.qb64,
  );
  assertEquals(SealEvent.toTuple(sealEvent).map((item) => item.qb64), [
    prefixer.qb64,
    number.qb64,
    diger.qb64,
  ]);
  assertEquals(
    SealEvent.isSad({
      i: prefixer.qb64,
      s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
      d: diger.qb64,
    }),
    true,
  );
  assertEquals(SealEvent.toSad(sealEvent), {
    i: prefixer.qb64,
    s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
    d: diger.qb64,
  });
  assertEquals(
    SealEvent.fromSad({
      i: prefixer.qb64,
      s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
      d: diger.qb64,
    }),
    sealEvent,
  );

  const sealLast = SealLast.fromTuple([prefixer]);
  assertEquals(sealLast.i.qb64, prefixer.qb64);
  assertEquals(SealLast.toCrew(sealLast), { i: prefixer.qb64 });

  const sealBack = SealBack.fromQb64bTuple([prefixer.qb64b, diger.qb64b]);
  assertEquals(sealBack.bi.qb64, prefixer.qb64);
  assertEquals(sealBack.d.qb64, diger.qb64);
  assertEquals(SealBack.toCrew(sealBack), { bi: prefixer.qb64, d: diger.qb64 });

  const sealKind = SealKind.fromTuple([
    verser,
    new Diger({ qb64: KERIPY_STRUCTING_DATA_VECTORS.sealKind.d }),
  ]);
  assertEquals(sealKind.t.proto, "OCSR");
  assertEquals(sealKind.t.pvrsn, { major: 2, minor: 0 });
  assertEquals(sealKind.d.qb64, KERIPY_STRUCTING_DATA_VECTORS.sealKind.d);
  assertEquals(SealKind.toCrew(sealKind), {
    t: KERIPY_STRUCTING_DATA_VECTORS.sealKind.t,
    d: KERIPY_STRUCTING_DATA_VECTORS.sealKind.d,
  });
  assertEquals(
    SealKind.qb64(sealKind),
    KERIPY_STRUCTING_DATA_VECTORS.sealKind.qb64,
  );
});

Deno.test("primitives/structing - blind and media records preserve KERIpy crew semantics", () => {
  const blindState = BlindState.fromQb64bTuple([
    b(KERIPY_STRUCTING_DATA_VECTORS.blindState.d),
    b(KERIPY_STRUCTING_DATA_VECTORS.blindState.u),
    b(KERIPY_STRUCTING_DATA_VECTORS.blindState.td),
    b(KERIPY_STRUCTING_DATA_VECTORS.blindState.tsQb64),
  ]);
  assertEquals(blindState.d.nonce, KERIPY_STRUCTING_DATA_VECTORS.blindState.d);
  assertEquals(blindState.u.nonce, KERIPY_STRUCTING_DATA_VECTORS.blindState.u);
  assertEquals(
    blindState.td.nonce,
    KERIPY_STRUCTING_DATA_VECTORS.blindState.td,
  );
  assertEquals(blindState.ts.text, KERIPY_STRUCTING_DATA_VECTORS.blindState.ts);
  assertEquals(BlindState.toCrew(blindState), {
    d: KERIPY_STRUCTING_DATA_VECTORS.blindState.d,
    u: KERIPY_STRUCTING_DATA_VECTORS.blindState.u,
    td: KERIPY_STRUCTING_DATA_VECTORS.blindState.td,
    ts: KERIPY_STRUCTING_DATA_VECTORS.blindState.ts,
  });
  assertEquals(BlindState.toSad(blindState), {
    d: KERIPY_STRUCTING_DATA_VECTORS.blindState.d,
    u: KERIPY_STRUCTING_DATA_VECTORS.blindState.u,
    td: KERIPY_STRUCTING_DATA_VECTORS.blindState.td,
    ts: KERIPY_STRUCTING_DATA_VECTORS.blindState.ts,
  });
  assertEquals(
    BlindState.qb64(blindState),
    KERIPY_STRUCTING_DATA_VECTORS.blindState.qb64,
  );

  const boundState = BoundState.fromQb64bTuple([
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.d),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.u),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.td),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.tsQb64),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.bnQb64),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.bd),
  ]);
  assertEquals(boundState.d.nonce, KERIPY_STRUCTING_DATA_VECTORS.boundState.d);
  assertEquals(boundState.u.nonce, KERIPY_STRUCTING_DATA_VECTORS.boundState.u);
  assertEquals(
    boundState.td.nonce,
    KERIPY_STRUCTING_DATA_VECTORS.boundState.td,
  );
  assertEquals(boundState.ts.text, KERIPY_STRUCTING_DATA_VECTORS.boundState.ts);
  assertEquals(boundState.bn.num, 2n);
  assertEquals(boundState.bn.numh, KERIPY_STRUCTING_DATA_VECTORS.boundState.bn);
  assertEquals(
    boundState.bd.nonce,
    KERIPY_STRUCTING_DATA_VECTORS.boundState.bd,
  );
  assertEquals(BoundState.toCrew(boundState), {
    d: KERIPY_STRUCTING_DATA_VECTORS.boundState.d,
    u: KERIPY_STRUCTING_DATA_VECTORS.boundState.u,
    td: KERIPY_STRUCTING_DATA_VECTORS.boundState.td,
    ts: KERIPY_STRUCTING_DATA_VECTORS.boundState.ts,
    bn: KERIPY_STRUCTING_DATA_VECTORS.boundState.bn,
    bd: KERIPY_STRUCTING_DATA_VECTORS.boundState.bd,
  });
  assertEquals(
    BoundState.qb64(boundState),
    KERIPY_STRUCTING_DATA_VECTORS.boundState.qb64,
  );

  const typeMedia = TypeMedia.fromQb64bTuple([
    b(KERIPY_STRUCTING_DATA_VECTORS.typeMedia.d),
    b(KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u),
    b(KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mtQb64),
    b(KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mvQb64),
  ]);
  assertEquals(typeMedia.d.nonce, KERIPY_STRUCTING_DATA_VECTORS.typeMedia.d);
  assertEquals(typeMedia.u.nonce, KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u);
  assertEquals(typeMedia.mt.text, KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mt);
  assertEquals(typeMedia.mv.text, KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mv);
  assertEquals(TypeMedia.toCrew(typeMedia), {
    d: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.d,
    u: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u,
    mt: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mt,
    mv: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mv,
  });
  assertEquals(
    TypeMedia.qb64(typeMedia),
    KERIPY_STRUCTING_DATA_VECTORS.typeMedia.qb64,
  );

  assertInstanceOf(blindState.d, Noncer);
  assertInstanceOf(boundState.bn, NumberPrimitive);
  assertInstanceOf(typeMedia.mt, Labeler);
  assertInstanceOf(typeMedia.mv, Texter);
});

Deno.test("primitives/structing - SAD guards require exact field sets and valid primitive content", () => {
  assertEquals(
    SealEvent.isSad({
      i: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i,
      s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
      d: KERIPY_MATTER_VECTORS.digerBlake3,
    }),
    true,
  );
  assertEquals(
    SealEvent.isSad({
      i: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i,
      s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
      d: KERIPY_MATTER_VECTORS.digerBlake3,
      extra: "nope",
    }),
    false,
  );
  assertEquals(
    SealEvent.isSad({
      i: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i,
      s: 14,
      d: KERIPY_MATTER_VECTORS.digerBlake3,
    }),
    false,
  );

  assertThrows(
    () =>
      SealEvent.fromSad({
        i: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i,
        s: "zz-not-hex",
        d: KERIPY_MATTER_VECTORS.digerBlake3,
      } as never),
  );
  assertThrows(
    () =>
      TypeMedia.fromSad({
        d: "not-a-nonce",
        u: "",
        mt: "application/json",
        mv: "text/plain",
      } as never),
  );
});

Deno.test("primitives/structing - struct values are frozen plain objects", () => {
  const sealEvent = SealEvent.fromQb64bTuple([
    b(KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i),
    b(KERIPY_STRUCTING_DATA_VECTORS.sealEvent.sQb64),
    b(KERIPY_MATTER_VECTORS.digerBlake3),
  ]);

  assert(Object.isFrozen(sealEvent));
  assertStrictEquals(Object.getPrototypeOf(sealEvent), Object.prototype);
  assertEquals(Object.keys(sealEvent), ["i", "s", "d"]);
  assertEquals("qb64" in sealEvent, false);
  assertInstanceOf(sealEvent.i, Prefixer);
  assertInstanceOf(sealEvent.s, NumberPrimitive);
  assertInstanceOf(sealEvent.d, Diger);
});
