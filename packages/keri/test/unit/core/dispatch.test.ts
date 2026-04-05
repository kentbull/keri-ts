import { run } from "effection";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import {
  BlindState,
  BoundState,
  Cigar,
  Dater,
  Diger,
  Labeler,
  MtrDex,
  Noncer,
  NumberPrimitive,
  Prefixer,
  SealEvent,
  SealKind,
  SealSource,
  Seqner,
  SerderKERI,
  Texter,
  TypeMedia,
  Verser,
} from "../../../../cesr/mod.ts";
import { encodeHugeNumber, Manager } from "../../../src/app/keeping.ts";
import {
  FirstSeenReplayCouple,
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  TransIdxSigGroup,
  TransLastIdxSigGroup,
  TransReceiptQuadruple,
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

      const normalizedCigar = new Cigar({ qb64b: cigars[0].qb64b }, verfers[0]);
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
      const ssc = SealSource.fromTuple([firner, diger]);
      const sscFromQb64b = SealSource.fromQb64bTuple([
        firner.qb64b,
        diger.qb64b,
      ]);
      const sst = SealEvent.fromTuple([prefixer, firner, diger]);
      const sstFromQb64b = SealEvent.fromQb64bTuple([
        prefixer.qb64b,
        firner.qb64b,
        diger.qb64b,
      ]);
      const tdc = SealKind.fromTuple([verser, typedDiger]);
      const tdcFromQb64b = SealKind.fromQb64bTuple([
        verser.qb64b,
        typedDiger.qb64b,
      ]);
      const ptd = PathedMaterialGroup.fromRaw(new Uint8Array([1, 2, 3, 4]));
      const bsq = BlindState.fromTuple([
        noncer,
        noncer,
        acdcer,
        labeler,
      ]);
      const bsqFromQb64b = BlindState.fromQb64bTuple([
        noncer.qb64b,
        noncer.qb64b,
        acdcer.qb64b,
        labeler.qb64b,
      ]);
      const bss = BoundState.fromTuple([
        noncer,
        noncer,
        acdcer,
        labeler,
        firner,
        acdcer,
      ]);
      const bssFromQb64b = BoundState.fromQb64bTuple([
        noncer.qb64b,
        noncer.qb64b,
        acdcer.qb64b,
        labeler.qb64b,
        firner.qb64b,
        acdcer.qb64b,
      ]);
      const tmq = TypeMedia.fromTuple([
        noncer,
        noncer,
        labeler,
        texter,
      ]);
      const tmqFromQb64b = TypeMedia.fromQb64bTuple([
        noncer.qb64b,
        noncer.qb64b,
        labeler.qb64b,
        texter.qb64b,
      ]);

      assertEquals(normalizedCigar.verfer?.qb64, verfers[0].qb64);
      assertEquals(normalizedCigar.qb64, cigars[0].qb64);
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
      assertEquals(ssc.d.qb64, diger.qb64);
      assertEquals(sscFromQb64b.s.numh, firner.numh);
      assertEquals(sst.i.qb64, prefixer.qb64);
      assertEquals(sst.s.numh, firner.numh);
      assertEquals(sstFromQb64b.d.qb64, diger.qb64);
      assertEquals(tdc.d.qb64, typedDiger.qb64);
      assertEquals(tdcFromQb64b.d.qb64, typedDiger.qb64);
      assertEquals(new Uint8Array(ptd.raw), new Uint8Array([1, 2, 3, 4]));
      assertEquals(bsq.d.nonce, noncer.nonce);
      assertEquals(bsqFromQb64b.d.nonce, noncer.nonce);
      assertEquals(BoundState.toTuple(bss)[4].qb64, firner.qb64);
      assertEquals(BoundState.toTuple(bssFromQb64b)[4].qb64, firner.qb64);
      assertEquals(tmq.d.nonce, noncer.nonce);
      assertEquals(tmqFromQb64b.d.nonce, noncer.nonce);

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
        cigars: [normalizedCigar],
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
      assertInstanceOf(envelope.lastSsc?.s, NumberPrimitive);
      assertInstanceOf(envelope.lastSst?.i, Prefixer);
      assertInstanceOf(envelope.cigars[0], Cigar);
      assertEquals(envelope.cigars[0].verfer?.qb64, verfers[0].qb64);
    } finally {
      yield* keeper.close(true);
    }
  });
});
