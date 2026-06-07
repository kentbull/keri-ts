// @file-test-lane db-fast

import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Counter, CtrDexV1, Diger, SerderACDC } from "../../../../cesr/mod.ts";
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
    '{"v":"ACDC10JSON00018a_","d":"EP5-9l2U6Nk4Tay7ZMmE2vMBbyst_wL-X-duR7_5fOYh","i":"EAzyYT43995Tzhs4dobIxATUmE6u6MTS87zdeIUxVILK","ri":"EC6A-9IZSURHyUHKN3kyabfwJPYeR9oQq2wcoIZAL8L2","s":"ENLj1SXm-UWWAHjoBCSDK1XSvlZ0A-yehZFQbdbwBI4V","a":{"d":"ECZxadZCtRi0BpLMb4JfTjLho40fR1BAkwOxQf2BmqJe","i":"EJ0d1ke927FIzyF7M1xRb7n6DBhiOh4GPg8ZMZjvhbPg","dt":"2026-06-07T02:23:37.535000+00:00","role":"holder"}}',
  );
});

Deno.test("vdr/credentialing - creates registry and records completion", async () => {
  await run(function* () {
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
  await run(function* () {
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
  await run(function* () {
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
  await run(function* () {
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
