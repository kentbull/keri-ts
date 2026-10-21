import { run } from "effection";
import { assertEquals, assertInstanceOf, assertStrictEquals } from "jsr:@std/assert";
import {
  b,
  BlindState,
  BoundState,
  Cigar,
  concatBytes,
  Dater,
  Diger,
  FirstSeen,
  isGroupTuple,
  Labeler,
  MtrDex,
  Noncer,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SealEvent,
  SealKind,
  SealSource,
  Seqner,
  SerderKERI,
  Texter,
  TypeMedia,
  Verser,
  Vrsn_1_0,
} from "../../../../cesr/mod.ts";
import { decodeB64 } from "../../../../cesr/src/core/bytes.ts";
import { hexWire } from "../../../../cesr/test/fixtures/current-reference-vectors.ts";
import vectors from "../../../../cesr/test/fixtures/current-structing-vectors.json" with { type: "json" };
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../../../cesr/test/fixtures/external-vectors.ts";
import { encodeHugeNumber, Manager } from "../../../src/app/identity/keeping.ts";
import { envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import {
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
      const typedDiger = new Noncer({ code: diger.code, raw: diger.raw });

      const normalizedCigar = new Cigar({ qb64b: cigars[0].qb64b }, verfers[0]);
      const trq = TransReceiptQuadruple.fromTuple([
        prefixer,
        seqner,
        diger,
        sigers[0],
      ]);
      const tsg = TransIdxSigGroup.fromTuple([prefixer, seqner, diger, sigers]);
      const ssg = TransLastIdxSigGroup.fromTuple([prefixer, sigers]);
      const frc = FirstSeen.fromTuple([firner, dater]);
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
      assertEquals(
        tsg.routeKey,
        `${prefixer.qb64}.${seqner.snh}.${diger.qb64}`,
      );
      assertEquals(tsg.toTuple()[3][0].qb64, sigers[0].qb64);
      assertEquals(ssg.pre, prefixer.qb64);
      assertEquals(frc.f.numh, firner.numh);
      assertEquals(FirstSeen.toTuple(frc)[1].qb64, dater.qb64);
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

      assertEquals(envelope.lastFrc, frc);
      assertInstanceOf(envelope.lastSsc?.s, NumberPrimitive);
      assertInstanceOf(envelope.lastSst?.i, Prefixer);
      assertInstanceOf(envelope.cigars[0], Cigar);
      assertEquals(envelope.cigars[0].verfer?.qb64, verfers[0].qb64);
    } finally {
      yield* keeper.close(true);
    }
  });
});

Deno.test("core/dispatch - current fixed-field records retain parser-hydrated roles and identity", async () => {
  const v1 = new SerderKERI({
    sad: { t: "rpy", dt: "2026-10-13T01:02:03.000004+00:00", r: "/test", a: {} },
    makify: true,
    pvrsn: Vrsn_1_0,
  });
  for (const row of vectors.groups) {
    for (const domain of ["txt", "bny"] as const) {
      const body = row.version === 1
        ? v1.raw
        : domain === "txt"
        ? b(KERIPY_NATIVE_V2_ICP_FIX_BODY)
        : decodeB64(KERIPY_NATIVE_V2_ICP_FIX_BODY);
      const wire = concatBytes(body, domain === "txt" ? b(row.qb64) : hexWire(row.qb2));
      const [frame] = await parseBytes(wire);
      const envelope = envelopeFromFrame(frame);
      const values = row.clan === "SealKind" ? envelope.tdcs : envelope.frcs;
      const expected = vectors.records.filter((record) => record.clan === row.clan);
      assertEquals(values.length, expected.length);
      for (const [index, item] of frame.attachments[0].items.entries()) {
        if (!isGroupTuple(item)) throw new Error("Expected fixed-field tuple");
        if (row.clan === "SealKind") {
          assertStrictEquals(envelope.tdcs[index].t, item[0]);
          assertStrictEquals(envelope.tdcs[index].d, item[1]);
          assertInstanceOf(envelope.tdcs[index].d, Noncer);
          assertEquals<unknown>(SealKind.toSad(envelope.tdcs[index]), expected[index].sad);
        } else {
          assertStrictEquals(envelope.frcs[index].f, item[0]);
          assertStrictEquals(envelope.frcs[index].dt, item[1]);
          assertEquals<unknown>(FirstSeen.toSad(envelope.frcs[index]), expected[index].sad);
        }
      }
      if (row.clan === "FirstSeen") assertStrictEquals(envelope.lastFrc, envelope.frcs.at(-1));
    }
  }
});
