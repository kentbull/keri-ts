// @file-test-lane db-fast

import { run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import {
  concatBytes,
  Counter,
  CtrDexV1,
  Diger,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  Seqner,
  SerderACDC,
  SerderKERI,
  Siger,
  Signer,
} from "../../../../cesr/mod.ts";
import { incept as inceptRegistry } from "../../../src/core/protocol-vdr-eventing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { createReger } from "../../../src/db/reger.ts";

const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);
const SCHEMA_SAID = "Eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function ordinal(num: number): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

function seqner(num: number): Seqner {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new Seqner({ code: NumDex.Huge, raw });
}

function makePrefixer(): Prefixer {
  const signer = Signer.random({ transferable: true });
  return new Prefixer({ code: "D", raw: signer.verfer.raw });
}

function makeCredential(
  issuer: string,
  extra: Record<string, unknown> = {},
): SerderACDC {
  return new SerderACDC({
    sad: {
      d: "",
      i: issuer,
      s: SCHEMA_SAID,
      a: { i: issuer },
      ...extra,
    },
    makify: true,
  });
}

Deno.test("db/reger - binds KERIpy Reger stores and broker subkeys", async () => {
  await run(function* () {
    const reger = yield* createReger({
      name: `reger-bind-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      assertEquals(reger.opened, true);
      assertExists(reger.tvts);
      assertExists(reger.tels);
      assertExists(reger.ancs);
      assertExists(reger.creds);
      assertExists(reger.txnsb);

      const raw = new TextEncoder().encode("tel-body");
      const diger = new Diger({
        code: "E",
        raw: Diger.digest(raw, "E"),
      });
      const pre = "Eregistry";
      const dgkey = dgKey(pre, diger.qb64);

      assertEquals(reger.tvts.put(dgkey, raw), true);
      assertEquals(reger.tvts.get(dgkey), raw);
      assertEquals(reger.tels.putOn(pre, 0, diger), true);
      assertEquals(reger.tels.getOn(pre, 0)?.qb64, diger.qb64);

      assertEquals(reger.baks.put(dgkey, ["Bbacker1", "Bbacker2"]), true);
      assertEquals(reger.baks.get(dgkey), ["Bbacker1", "Bbacker2"]);
    } finally {
      yield* reger.close(true);
    }
  });
});

Deno.test("db/reger - logs and clones ACDC credentials with anchors", async () => {
  await run(function* () {
    const reger = yield* createReger({
      name: `reger-cred-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const creder = makeCredential(issuer.qb64);
      const eventDiger = new Diger({ qb64: creder.said! });
      const number = ordinal(0);

      assertEquals(reger.logCred(creder, issuer, number, eventDiger), true);

      const [cloned, prefixer, clonedNumber, diger] = reger.cloneCred(
        creder.said!,
      );
      assertEquals(cloned instanceof SerderACDC, true);
      assertEquals(cloned.said, creder.said);
      assertEquals(prefixer.qb64, issuer.qb64);
      assertEquals(clonedNumber.qb64, number.qb64);
      assertEquals(diger.qb64, eventDiger.qb64);
    } finally {
      yield* reger.close(true);
    }
  });
});

Deno.test("db/reger - credential stores enforce SerderACDC hydration", async () => {
  await run(function* () {
    const reger = yield* createReger({
      name: `reger-acdc-enforce-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const keri = new SerderKERI({
        sad: {
          t: "rpy",
          dt: "2026-06-06T00:00:00.000000+00:00",
          r: "/test",
          a: {},
        },
        makify: true,
      });

      reger.creds.pin(["bad"], keri as unknown as SerderACDC);
      assertThrows(
        () => reger.creds.get(["bad"]),
        TypeError,
        "Expected SerderACDC",
      );
    } finally {
      yield* reger.close(true);
    }
  });
});

Deno.test("db/reger - cloneTvt rebuilds KERIpy TEL replay attachments", async () => {
  await run(function* () {
    const reger = yield* createReger({
      name: `reger-clone-tvt-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const backer = makePrefixer();
      const tel = inceptRegistry(issuer.qb64, {
        baks: [backer.qb64],
        nonce: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      });
      const regk = tel.said!;
      const dgkey = dgKey(regk, regk);
      const signer = Signer.random({ transferable: false });
      const wiger = signer.sign(tel.raw, { index: 0 }) as Siger;
      const sealNumber = ordinal(3);
      const sealDiger = new Diger({ qb64: regk });

      assertEquals(reger.tvts.put(dgkey, tel.raw), true);
      assertEquals(reger.tels.putOn(regk, 0, new Diger({ qb64: regk })), true);
      assertEquals(reger.tibs.pin([regk, regk], [wiger]), true);
      assertEquals(reger.ancs.put(dgkey, [sealNumber, sealDiger]), true);

      const atc = concatBytes(
        new Counter({
          code: CtrDexV1.WitnessIdxSigs,
          count: 1,
          version: KERI_V1,
        }).qb64b,
        wiger.qb64b,
        new Counter({
          code: CtrDexV1.SealSourceCouples,
          count: 1,
          version: KERI_V1,
        }).qb64b,
        seqner(3).qb64b,
        new Saider({ qb64: regk }).qb64b,
      );
      const expected = concatBytes(
        tel.raw,
        new Counter({
          code: CtrDexV1.AttachmentGroup,
          count: atc.length / 4,
          version: KERI_V1,
        }).qb64b,
        atc,
      );

      assertEquals(reger.cloneTvt(regk, regk), expected);
      assertEquals(reger.cloneTvtAt(regk, 0), expected);
      assertEquals([...reger.clonePreIter(regk)], [expected]);
    } finally {
      yield* reger.close(true);
    }
  });
});

Deno.test("db/reger - sources returns recursive source credentials with seal triples", async () => {
  await run(function* () {
    const reger = yield* createReger({
      name: `reger-sources-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const child = makeCredential(issuer.qb64);
      const parent = makeCredential(issuer.qb64, {
        e: {
          d: "",
          child: { n: child.said },
        },
      });
      const anchorDiger = new Diger({ qb64: child.said! });
      const number = ordinal(4);
      reger.logCred(child, issuer, number, anchorDiger);

      const sources = reger.sources(null, parent);
      assertEquals(sources.length, 1);
      assertEquals(sources[0]![0].said, child.said);
      assertEquals(
        sources[0]![1],
        concatBytes(
          new Counter({
            code: CtrDexV1.SealSourceTriples,
            count: 1,
            version: KERI_V1,
          }).qb64b,
          issuer.qb64b,
          number.qb64b,
          new Saider({ qb64: child.said! }).qb64b,
        ),
      );
    } finally {
      yield* reger.close(true);
    }
  });
});
