import { run } from "effection";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import {
  Dater,
  Diger,
  Labeler,
  MtrDex,
  Noncer,
  NumberPrimitive,
  Prefixer,
  Seqner,
  SerderKERI,
  Texter,
  Verser,
} from "../../../../cesr/mod.ts";
import { encodeHugeNumber, Manager } from "../../../src/app/keeping.ts";
import {
  BlindedStateQuadruple,
  BoundStateSextuple,
  CigarCouple,
  FirstSeenReplayCouple,
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  SourceSealCouple,
  SourceSealTriple,
  TransIdxSigGroup,
  TransLastIdxSigGroup,
  TransReceiptQuadruple,
  TypedDigestSealCouple,
  TypedMediaQuadruple,
} from "../../../src/core/dispatch.ts";
import { createKeeper } from "../../../src/db/keeping.ts";

Deno.test("core/dispatch - named dispatch value objects round-trip tuples and derived getters", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `dispatch-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const manager = new Manager({
        ks: keeper,
        salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      });
      const [verfers, digers] = manager.incept({
        icount: 1,
        ncount: 1,
        transferable: true,
        temp: true,
      });
      const ser = new TextEncoder().encode("dispatch-value-objects");
      const sigers = manager.sign(ser, [verfers[0].qb64], true);
      const cigars = manager.sign(ser, [verfers[0].qb64], false);

      const prefixer = new Prefixer({ qb64: verfers[0].qb64 });
      const seqner = new Seqner({
        code: MtrDex.Salt_128,
        raw: new Uint8Array(16).fill(1),
      });
      const diger = digers[0];
      const firner = new NumberPrimitive({ qb64: encodeHugeNumber(5) });
      const dater = new Dater({ qb64: "1AAG2026-03-29T10c20c30d000000p00c00" });
      const verser = new Verser({ qb64: "YKERICAA" });
      const noncer = new Noncer({ qb64: "0AAxyHwW6htOZ_rANOaZb2N2" });
      const acdcer = new Noncer({ qb64: "1AAP" });
      const labeler = new Labeler({ qb64: "0J_i" });
      const texter = new Texter({ qb64: "4BABAAAA" });
      const typedDiger = new Diger({ code: diger.code, raw: diger.raw });

      const cigarCouple = CigarCouple.fromTuple([verfers[0], cigars[0]]);
      const cigarFromQb64b = CigarCouple.fromQb64bTuple([
        verfers[0].qb64b,
        cigars[0].qb64b,
      ]);
      const trq = TransReceiptQuadruple.fromTuple([
        prefixer,
        seqner,
        diger,
        sigers[0],
      ]);
      const trqFromQb64b = TransReceiptQuadruple.fromQb64bTuple([
        prefixer.qb64b,
        firner.qb64b,
        diger.qb64b,
        sigers[0].qb64b,
      ]);
      const tsg = TransIdxSigGroup.fromTuple([prefixer, seqner, diger, sigers]);
      const tsgFromQb64b = TransIdxSigGroup.fromQb64bTuple(
        [prefixer.qb64b, firner.qb64b, diger.qb64b],
        sigers,
      );
      const ssg = TransLastIdxSigGroup.fromTuple([prefixer, sigers]);
      const ssgFromQb64b = TransLastIdxSigGroup.fromQb64bTuple(
        prefixer.qb64b,
        sigers,
      );
      const frc = FirstSeenReplayCouple.fromTuple([firner, dater]);
      const frcFromQb64b = FirstSeenReplayCouple.fromQb64bTuple([
        firner.qb64b,
        dater.qb64b,
      ]);
      const ssc = SourceSealCouple.fromTuple([seqner, diger]);
      const sscFromQb64b = SourceSealCouple.fromQb64bTuple([
        firner.qb64b,
        diger.qb64b,
      ]);
      const sst = SourceSealTriple.fromTuple([prefixer, firner, diger]);
      const sstFromQb64b = SourceSealTriple.fromQb64bTuple([
        prefixer.qb64b,
        firner.qb64b,
        diger.qb64b,
      ]);
      const tdc = TypedDigestSealCouple.fromTuple([verser, typedDiger]);
      const tdcFromQb64b = TypedDigestSealCouple.fromQb64bTuple([
        verser.qb64b,
        typedDiger.qb64b,
      ]);
      const ptd = PathedMaterialGroup.fromRaw(new Uint8Array([1, 2, 3, 4]));
      const bsq = BlindedStateQuadruple.fromTuple([
        diger,
        noncer,
        acdcer,
        labeler,
      ]);
      const bsqFromQb64b = BlindedStateQuadruple.fromQb64bTuple([
        diger.qb64b,
        noncer.qb64b,
        acdcer.qb64b,
        labeler.qb64b,
      ]);
      const bss = BoundStateSextuple.fromTuple([
        diger,
        noncer,
        acdcer,
        labeler,
        firner,
        acdcer,
      ]);
      const bssFromQb64b = BoundStateSextuple.fromQb64bTuple([
        diger.qb64b,
        noncer.qb64b,
        acdcer.qb64b,
        labeler.qb64b,
        firner.qb64b,
        acdcer.qb64b,
      ]);
      const tmq = TypedMediaQuadruple.fromTuple([
        diger,
        noncer,
        labeler,
        texter,
      ]);
      const tmqFromQb64b = TypedMediaQuadruple.fromQb64bTuple([
        diger.qb64b,
        noncer.qb64b,
        labeler.qb64b,
        texter.qb64b,
      ]);

      assertEquals(cigarCouple.verferQb64, verfers[0].qb64);
      assertEquals(cigarFromQb64b.verferQb64, verfers[0].qb64);
      assertEquals(cigarCouple.toTuple()[1].qb64, cigars[0].qb64);
      assertEquals(trq.pre, prefixer.qb64);
      assertEquals(trq.snh, seqner.snh);
      assertEquals(trq.said, diger.qb64);
      assertEquals(trqFromQb64b.snh, firner.numh);
      assertEquals(
        tsg.routeKey,
        `${prefixer.qb64}.${seqner.snh}.${diger.qb64}`,
      );
      assertEquals(tsgFromQb64b.snh, firner.numh);
      assertEquals(tsg.toTuple()[3][0].qb64, sigers[0].qb64);
      assertEquals(ssg.pre, prefixer.qb64);
      assertEquals(ssgFromQb64b.pre, prefixer.qb64);
      assertEquals(frc.fnh, firner.numh);
      assertEquals(frcFromQb64b.fnh, firner.numh);
      assertEquals(frc.toTuple()[1].qb64, dater.qb64);
      assertEquals(ssc.said, diger.qb64);
      assertEquals(sscFromQb64b.snh, firner.numh);
      assertEquals(sst.pre, prefixer.qb64);
      assertEquals(sst.snh, firner.numh);
      assertEquals(sstFromQb64b.said, diger.qb64);
      assertEquals(tdc.said, typedDiger.qb64);
      assertEquals(tdcFromQb64b.said, typedDiger.qb64);
      assertEquals(new Uint8Array(ptd.raw), new Uint8Array([1, 2, 3, 4]));
      assertEquals(bsq.said, diger.qb64);
      assertEquals(bsqFromQb64b.said, diger.qb64);
      assertEquals(bss.toTuple()[4].qb64, firner.qb64);
      assertEquals(bssFromQb64b.toTuple()[4].qb64, firner.qb64);
      assertEquals(tmq.said, diger.qb64);
      assertEquals(tmqFromQb64b.said, diger.qb64);

      const envelope = new KeriDispatchEnvelope({
        serder: new SerderKERI({
          sad: {
            t: "rpy",
            dt: "2026-03-29T10:20:30.000000+00:00",
            r: "/test/route",
            a: {},
          },
          makify: true,
        }),
        attachmentGroups: [],
        local: false,
        cigars: [cigarCouple],
        trqs: [trq],
        tsgs: [tsg],
        ssgs: [ssg],
        frcs: [frc],
        sscs: [ssc],
        ssts: [sst],
        tdcs: [tdc],
        ptds: [ptd],
        bsqs: [bsq],
        bsss: [bss],
        tmqs: [tmq],
      });

      assertInstanceOf(envelope.lastFrc, FirstSeenReplayCouple);
      assertInstanceOf(envelope.lastSsc, SourceSealCouple);
      assertInstanceOf(envelope.lastSst, SourceSealTriple);
    } finally {
      yield* keeper.close(true);
    }
  });
});
