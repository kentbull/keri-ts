import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { b } from "../../../src/core/bytes.ts";
import { Diger, Labeler, Noncer, NumberPrimitive, Prefixer, Texter, Verser } from "../../../src/index.ts";
import {
  ACastDom,
  AClanDom,
  BlindState,
  BoundState,
  BSCastDom,
  BSClanDom,
  Castage,
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

  assertInstanceOf(SCastDom.SealEvent.s, Castage);
  assertEquals(SCastDom.SealEvent.s.ipn, "numh");
  assertEquals(BSCastDom.BoundState.d.ipn, "nonce");
  assertEquals(BSCastDom.BoundState.bn.ipn, "numh");
  assertEquals(TMCastDom.TypeMedia.mt.ipn, "text");
  assertEquals(ACastDom.SealDigest.d.ipn, null);
});

Deno.test("primitives/structing - seal classes round-trip tuple values and crew serialization", () => {
  const diger = new Diger({ qb64: KERIPY_MATTER_VECTORS.digerBlake3 });
  const prefixer = new Prefixer({
    qb64: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i,
  });
  const seqner = new NumberPrimitive({
    qb64: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.sQb64,
  });
  const verser = new Verser({ qb64: KERIPY_STRUCTING_DATA_VECTORS.sealKind.t });

  const sealDigest = SealDigest.fromTuple([diger]);
  assertEquals(sealDigest.said, diger.qb64);
  assertEquals(sealDigest.crew, { d: diger.qb64 });
  assertEquals(sealDigest.qb64, diger.qb64);
  assertEquals(sealDigest.qb2, diger.qb2);

  const sealRoot = SealRoot.fromQb64bTuple([diger.qb64b]);
  assertEquals(sealRoot.root, diger.qb64);
  assertEquals(sealRoot.crew, { rd: diger.qb64 });

  const sealSource = SealSource.fromQb64bTuple([seqner.qb64b, diger.qb64b]);
  assertEquals(sealSource.sn, 14n);
  assertEquals(sealSource.snh, KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s);
  assertEquals(sealSource.crew, {
    s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
    d: diger.qb64,
  });

  const sealEvent = SealEvent.fromQb64bTuple([
    prefixer.qb64b,
    seqner.qb64b,
    diger.qb64b,
  ]);
  assertEquals(sealEvent.pre, prefixer.qb64);
  assertEquals(sealEvent.sn, 14n);
  assertEquals(sealEvent.snh, KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s);
  assertEquals(sealEvent.said, diger.qb64);
  assertEquals(sealEvent.crew, {
    i: prefixer.qb64,
    s: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.s,
    d: diger.qb64,
  });
  assertEquals(sealEvent.qb64, KERIPY_STRUCTING_DATA_VECTORS.sealEvent.qb64);
  assertEquals(sealEvent.toTuple().map((item) => item.qb64), [
    prefixer.qb64,
    seqner.qb64,
    diger.qb64,
  ]);

  const sealLast = SealLast.fromTuple([prefixer]);
  assertEquals(sealLast.pre, prefixer.qb64);
  assertEquals(sealLast.crew, { i: prefixer.qb64 });

  const sealBack = SealBack.fromQb64bTuple([prefixer.qb64b, diger.qb64b]);
  assertEquals(sealBack.backer, prefixer.qb64);
  assertEquals(sealBack.said, diger.qb64);
  assertEquals(sealBack.crew, { bi: prefixer.qb64, d: diger.qb64 });

  const sealKind = SealKind.fromTuple([
    verser,
    new Diger({
      qb64: KERIPY_STRUCTING_DATA_VECTORS.sealKind.d,
    }),
  ]);
  assertEquals(sealKind.proto, "OCSR");
  assertEquals(sealKind.pvrsn, { major: 2, minor: 0 });
  assertEquals(sealKind.said, KERIPY_STRUCTING_DATA_VECTORS.sealKind.d);
  assertEquals(sealKind.crew, {
    t: KERIPY_STRUCTING_DATA_VECTORS.sealKind.t,
    d: KERIPY_STRUCTING_DATA_VECTORS.sealKind.d,
  });
  assertEquals(sealKind.qb64, KERIPY_STRUCTING_DATA_VECTORS.sealKind.qb64);
});

Deno.test("primitives/structing - blind and media classes preserve KERIpy crew semantics", () => {
  const blindState = BlindState.fromQb64bTuple([
    b(KERIPY_STRUCTING_DATA_VECTORS.blindState.d),
    b(KERIPY_STRUCTING_DATA_VECTORS.blindState.u),
    b(KERIPY_STRUCTING_DATA_VECTORS.blindState.td),
    b(KERIPY_STRUCTING_DATA_VECTORS.blindState.tsQb64),
  ]);
  assertEquals(blindState.said, KERIPY_STRUCTING_DATA_VECTORS.blindState.d);
  assertEquals(blindState.blid, KERIPY_STRUCTING_DATA_VECTORS.blindState.d);
  assertEquals(blindState.uuid, KERIPY_STRUCTING_DATA_VECTORS.blindState.u);
  assertEquals(blindState.acdc, KERIPY_STRUCTING_DATA_VECTORS.blindState.td);
  assertEquals(blindState.state, KERIPY_STRUCTING_DATA_VECTORS.blindState.ts);
  assertEquals(blindState.crew, {
    d: KERIPY_STRUCTING_DATA_VECTORS.blindState.d,
    u: KERIPY_STRUCTING_DATA_VECTORS.blindState.u,
    td: KERIPY_STRUCTING_DATA_VECTORS.blindState.td,
    ts: KERIPY_STRUCTING_DATA_VECTORS.blindState.ts,
  });
  assertEquals(blindState.qb64, KERIPY_STRUCTING_DATA_VECTORS.blindState.qb64);

  const boundState = BoundState.fromQb64bTuple([
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.d),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.u),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.td),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.tsQb64),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.bnQb64),
    b(KERIPY_STRUCTING_DATA_VECTORS.boundState.bd),
  ]);
  assertEquals(boundState.said, KERIPY_STRUCTING_DATA_VECTORS.boundState.d);
  assertEquals(boundState.uuid, KERIPY_STRUCTING_DATA_VECTORS.boundState.u);
  assertEquals(boundState.acdc, KERIPY_STRUCTING_DATA_VECTORS.boundState.td);
  assertEquals(boundState.state, KERIPY_STRUCTING_DATA_VECTORS.boundState.ts);
  assertEquals(boundState.bsn, 2n);
  assertEquals(boundState.bnh, KERIPY_STRUCTING_DATA_VECTORS.boundState.bn);
  assertEquals(
    boundState.boundSaid,
    KERIPY_STRUCTING_DATA_VECTORS.boundState.bd,
  );
  assertEquals(boundState.crew, {
    d: KERIPY_STRUCTING_DATA_VECTORS.boundState.d,
    u: KERIPY_STRUCTING_DATA_VECTORS.boundState.u,
    td: KERIPY_STRUCTING_DATA_VECTORS.boundState.td,
    ts: KERIPY_STRUCTING_DATA_VECTORS.boundState.ts,
    bn: KERIPY_STRUCTING_DATA_VECTORS.boundState.bn,
    bd: KERIPY_STRUCTING_DATA_VECTORS.boundState.bd,
  });
  assertEquals(boundState.qb64, KERIPY_STRUCTING_DATA_VECTORS.boundState.qb64);

  const typeMedia = TypeMedia.fromQb64bTuple([
    b(KERIPY_STRUCTING_DATA_VECTORS.typeMedia.d),
    b(KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u),
    b(KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mtQb64),
    b(KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mvQb64),
  ]);
  assertEquals(typeMedia.said, KERIPY_STRUCTING_DATA_VECTORS.typeMedia.d);
  assertEquals(typeMedia.uuid, KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u);
  assertEquals(typeMedia.mediaType, KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mt);
  assertEquals(
    typeMedia.mediaValue,
    KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mv,
  );
  assertEquals(typeMedia.crew, {
    d: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.d,
    u: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.u,
    mt: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mt,
    mv: KERIPY_STRUCTING_DATA_VECTORS.typeMedia.mv,
  });
  assertEquals(typeMedia.qb64, KERIPY_STRUCTING_DATA_VECTORS.typeMedia.qb64);

  assertInstanceOf(blindState.d, Noncer);
  assertInstanceOf(boundState.bn, NumberPrimitive);
  assertInstanceOf(typeMedia.mt, Labeler);
  assertInstanceOf(typeMedia.mv, Texter);
});
