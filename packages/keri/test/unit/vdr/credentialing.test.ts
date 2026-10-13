import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  concatBytes,
  Counter,
  CtrDexV1,
  Diger,
  NumberPrimitive,
  SerderACDC,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { createAgentRuntime, enqueueOobi } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Verifier } from "../../../src/app/verifying.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { createReger } from "../../../src/db/reger.ts";
import {
  credential,
  Credentialer,
  CredentialWallet,
  Regery,
  Registrar,
  serializeCredential,
} from "../../../src/vdr/credentialing.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";
import vectors from "../../fixtures/credential-replay-927.json" with { type: "json" };

function schemaSed(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["v", "d", "i", "ri", "s", "a"],
    properties: {
      v: { type: "string" },
      d: { type: "string" },
      i: { type: "string" },
      ri: { type: "string" },
      s: { type: "string" },
      a: {
        type: "object",
        required: ["i", "role"],
        properties: {
          i: { type: "string" },
          role: { type: "string" },
        },
      },
      dt: { type: "string" },
    },
  };
}

Deno.test("vdr/credentialing - builds KERIpy-compatible v1 ACDC credentials", () => {
  const creder = credential({
    schema: "ENLj1SXm-UWWAHjoBCSDK1XSvlZ0A-yehZFQbdbwBI4V",
    issuer: "EAzyYT43995Tzhs4dobIxATUmE6u6MTS87zdeIUxVILK",
    registry: "EC6A-9IZSURHyUHKN3kyabfwJPYeR9oQq2wcoIZAL8L2",
    recipient: "EJ0d1ke927FIzyF7M1xRb7n6DBhiOh4GPg8ZMZjvhbPg",
    data: {
      role: "holder",
      dt: "2026-06-07T02:23:37.535000+00:00",
    },
  });

  assertEquals(creder.said, "EP5-9l2U6Nk4Tay7ZMmE2vMBbyst_wL-X-duR7_5fOYh");
  assertEquals(
    (creder.sad?.a as Record<string, unknown>).d,
    "ECZxadZCtRi0BpLMb4JfTjLho40fR1BAkwOxQf2BmqJe",
  );
  assertEquals(
    new TextDecoder().decode(creder.raw),
    "{\"v\":\"ACDC10JSON00018a_\",\"d\":\"EP5-9l2U6Nk4Tay7ZMmE2vMBbyst_wL-X-duR7_5fOYh\",\"i\":\"EAzyYT43995Tzhs4dobIxATUmE6u6MTS87zdeIUxVILK\",\"ri\":\"EC6A-9IZSURHyUHKN3kyabfwJPYeR9oQq2wcoIZAL8L2\",\"s\":\"ENLj1SXm-UWWAHjoBCSDK1XSvlZ0A-yehZFQbdbwBI4V\",\"a\":{\"d\":\"ECZxadZCtRi0BpLMb4JfTjLho40fR1BAkwOxQf2BmqJe\",\"i\":\"EJ0d1ke927FIzyF7M1xRb7n6DBhiOh4GPg8ZMZjvhbPg\",\"dt\":\"2026-06-07T02:23:37.535000+00:00\",\"role\":\"holder\"}}",
  );
});

Deno.test("vdr/credentialing - preserves credential edge and rule sections", () => {
  const creder = credential({
    schema: "ENLj1SXm-UWWAHjoBCSDK1XSvlZ0A-yehZFQbdbwBI4V",
    issuer: "EAzyYT43995Tzhs4dobIxATUmE6u6MTS87zdeIUxVILK",
    registry: "EC6A-9IZSURHyUHKN3kyabfwJPYeR9oQq2wcoIZAL8L2",
    recipient: "EJ0d1ke927FIzyF7M1xRb7n6DBhiOh4GPg8ZMZjvhbPg",
    data: {
      role: "holder",
      dt: "2026-06-07T02:23:37.535000+00:00",
    },
    edges: {
      q: {
        n: "EP5-9l2U6Nk4Tay7ZMmE2vMBbyst_wL-X-duR7_5fOYh",
        o: "I2I",
        s: "ENLj1SXm-UWWAHjoBCSDK1XSvlZ0A-yehZFQbdbwBI4V",
      },
    },
    rules: [{ usageDisclaimer: "interop" }],
  });

  assertEquals(creder.sad?.e, {
    q: {
      n: "EP5-9l2U6Nk4Tay7ZMmE2vMBbyst_wL-X-duR7_5fOYh",
      o: "I2I",
      s: "ENLj1SXm-UWWAHjoBCSDK1XSvlZ0A-yehZFQbdbwBI4V",
    },
  });
  assertEquals(creder.sad?.r, [{ usageDisclaimer: "interop" }]);
});

Deno.test("vdr/credentialing - creates registry and records completion", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `credentialing-reg-${crypto.randomUUID()}`,
      temp: true,
    });
    const reger = yield* createReger({
      name: `credentialing-reg-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const tvy = new Tevery({ db: hby.db, reger });
      const vry = new Verifier(hby, { reger });
      const rgy = new Regery(hby, { reger, tvy, vry });

      const registry = rgy.makeRegistry("issuer-reg", hab);

      assertExists(registry.regk);
      assertEquals(reger.regs.get("issuer-reg")?.registryKey, registry.regk);
      assertEquals(reger.states.get(registry.regk!)?.i, registry.regk);
      assertEquals(registry.complete(registry.regk!), true);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("vdr/credentialing - creates, issues, saves, exports, and revokes a credential", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `credentialing-issue-${crypto.randomUUID()}`,
      temp: true,
    });
    const reger = yield* createReger({
      name: `credentialing-issue-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const schemer = new Schemer({ sed: schemaSed() });
      hby.db.schema.pin(schemer.said, schemer);
      const tvy = new Tevery({ db: hby.db, reger });
      const vry = new Verifier(hby, { reger });
      const rgy = new Regery(hby, { reger, tvy, vry });
      const registry = rgy.makeRegistry("issuer-reg", hab);
      const credentialer = new Credentialer(hby, { reger, vry });

      const creder = credentialer.create({
        registry,
        schema: schemer.said,
        recipient: hab.pre,
        data: { role: "issuer" },
      });
      const result = credentialer.issue(registry, creder);

      assertEquals(result.telDecision.kind, "accept");
      assertEquals(result.verifierDecision.kind, "accept");
      assertEquals(credentialer.complete(creder.said!), true);
      assertEquals(reger.saved.get([creder.said!])?.qb64, creder.said);
      assertEquals(registry.complete(creder.said!), true);

      const wallet = new CredentialWallet(reger);
      assertEquals(wallet.list({ aid: hab.pre }), [creder.said]);
      assertEquals(wallet.list({ issued: true, aid: hab.pre }), [creder.said]);
      assertEquals(wallet.getCredentials(schemer.said)[0]?.[0].said, creder.said);

      const [stored, prefixer, seqner, diger] = reger.cloneCred(creder.said!);
      const exported = wallet.exportCredential(creder.said!);
      assertEquals(exported, serializeCredential(stored, prefixer, seqner, diger));
      assertEquals(new SerderACDC({ raw: stored.raw }).said, creder.said);
      assertEquals(
        exported.slice(stored.raw.length, stored.raw.length + 4),
        new Counter({
          code: CtrDexV1.SealSourceTriples,
          count: 1,
          version: { major: 1, minor: 0 },
        }).qb64b,
      );

      const revoked = registry.revoke(creder.said!);
      assertEquals(revoked.decision.kind, "accept");
      assertEquals(tvy.tevers.get(registry.regk!)?.vcState(creder.said!)?.et, "rev");
      assertEquals(reger.tels.getOn(creder.said!, 1)?.qb64, revoked.serder.said);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("vdr/credentialing - registrar facade delegates single-sig completion", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `credentialing-registrar-${crypto.randomUUID()}`,
      temp: true,
    });
    const reger = yield* createReger({
      name: `credentialing-registrar-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const rgy = new Regery(hby, { reger });
      const registrar = new Registrar(rgy);
      const registry = rgy.makeRegistry("issuer-reg", hab);

      assertEquals(registrar.complete(registry, registry.regk!), true);
      registrar.processEscrows();
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("vdr/credentialing - reloads registry TEL state from persisted records", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `credentialing-reload-${crypto.randomUUID()}`,
      temp: true,
    });
    const reger = yield* createReger({
      name: `credentialing-reload-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const rgy = new Regery(hby, { reger });
      const registry = rgy.makeRegistry("issuer-reg", hab);
      const regk = registry.regk!;

      reger.tevers.clear();
      const tvy = new Tevery({ db: hby.db, reger });
      const vry = new Verifier(hby, { reger });
      const reloaded = new Regery(hby, { reger, tvy, vry }).registryByName("issuer-reg");

      assertExists(reloaded);
      assertEquals(tvy.tevers.get(regk)?.regk, regk);
      assertEquals(reloaded!.complete(regk), true);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("vdr/credentialing - imports frozen Python issuance and replays both genera after reopen", async () => {
  for (const vector of vectors.vectors) {
    await run(function*() {
      const hby = yield* createHabery({ name: `frozen-issuer-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      const reger = yield* createReger({ name: `frozen-credential-${crypto.randomUUID()}`, temp: true });
      try {
        yield* call(function*() {
          const gvrsn = vector.version === 1 ? Vrsn_1_0 : Vrsn_2_0;
          const bytes = new TextEncoder();
          const tvy = new Tevery({ db: hby.db, reger });
          const vry = new Verifier(hby, { reger });
          const runtime = yield* createAgentRuntime(hby, { vdr: { reger, tvy, vry } });
          const reactor = runtime.reactor;
          hby.db.schema.pin(vectors.schema.$id, new Schemer({ sed: vectors.schema }));
          // Arrival before the issuer KEL exercises durable source-seal escrow as well.
          for (const tel of vector.tels) {
            yield* reactor.processBytes(concatBytes(bytes.encode(vector.genus), bytes.encode(tel.wire)));
            if (vector.version === 2) {
              assertEquals(reger.ancs.get([tel.pre, tel.said])?.[0].qb64, tel.number);
            }
          }
          // Resolve the independently signed KEL through actual HTTP/OOBI ingestion.
          const server = Deno.serve(
            { hostname: "127.0.0.1", port: 0, onListen() {} },
            () =>
              new Response(vector.genus + vector.kel, {
                headers: { "Content-Type": "application/cesr", "Oobi-Aid": vector.pre },
              }),
          );
          try {
            const url = `http://127.0.0.1:${server.addr.port}/oobi/${vector.pre}/controller`;
            enqueueOobi(runtime, { url });
            yield* runtime.oobiery.processOnce();
            assertEquals(hby.db.roobi.get(url)?.state, "resolved");
            assertEquals(hby.db.getState(vector.pre)?.s, "2");
          } finally {
            yield* call(() => server.shutdown());
          }
          yield* reactor.processEscrowsOnce();
          for (const tel of vector.tels) {
            assertEquals(reger.tvts.get([tel.pre, tel.said]), bytes.encode(tel.body));
          }
          yield* reactor.processBytes(concatBytes(bytes.encode(vector.genus), bytes.encode(vector.credential)));
          assertEquals(reger.saved.get([vector.said])?.qb64, vector.said);
          yield* reger.close();
          yield* reger.reopen({ reuse: true });
          const [creder, prefixer, number, diger] = reger.cloneCred(vector.said);
          assertEquals(creder.raw, bytes.encode(vector.body));
          assertEquals(serializeCredential(creder, prefixer, number, diger, gvrsn), bytes.encode(vector.credential));
          // A small Number must widen by value for v1, rather than copying its two raw bytes.
          const small = new NumberPrimitive({ qb64: vector.seal.number });
          assertEquals(serializeCredential(creder, prefixer, small, diger, gvrsn), bytes.encode(vector.credential));
          for (const tel of vector.tels) {
            assertEquals(reger.cloneTvtAt(tel.pre, 0, gvrsn), bytes.encode(tel.wire));
            assertEquals([...reger.clonePreIter(tel.pre, 0, gvrsn)], [bytes.encode(tel.wire)]);
          }
          // Source-chain export must use the same ordinal/counter rules as direct export.
          const parent = new SerderACDC({ sad: { ...creder.sad, e: { source: { n: vector.said } } }, makify: true });
          const [[source, attachment]] = reger.sources(hby.db, parent, gvrsn);
          assertEquals(concatBytes(source.raw, attachment), bytes.encode(vector.credential));
        });
      } finally {
        yield* reger.close(true);
        yield* hby.close(true);
      }
    });
  }
});
