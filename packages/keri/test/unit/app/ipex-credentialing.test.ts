// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  CtrDexV1,
  CtrDexV2,
  parseCounterFromText,
  SerderACDC,
  SerderKERI,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import {
  credentialPresentationArtifacts,
  ipexCredentialAdmit,
  ipexCredentialGrant,
  processCredentialPresentationArtifacts,
} from "../../../src/app/ipex-credentialing.ts";
import { IPEX_ADMIT_ROUTE, IPEX_GRANT_ROUTE } from "../../../src/app/ipexing.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { Verifier } from "../../../src/app/verifying.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { createReger } from "../../../src/db/reger.ts";
import { Credentialer, CredentialWallet, Regery } from "../../../src/vdr/credentialing.ts";
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
    },
  };
}

Deno.test("IPEX credential grant embeds ACDC, issue TEL, and anchor KEL artifacts", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `ipex-credential-grant-${crypto.randomUUID()}`,
      temp: true,
    });
    const reger = yield* createReger({
      name: `ipex-credential-grant-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const holder = hby.makeHab("holder", undefined, {
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
      const registry = rgy.makeRegistry("issuer-reg", issuer);
      const credentialer = new Credentialer(hby, { reger, vry });
      const creder = credentialer.create({
        registry,
        schema: schemer.said,
        recipient: holder.pre,
        data: { role: "holder" },
      });
      const issued = credentialer.issue(registry, creder);

      const grant = ipexCredentialGrant({
        hby,
        hab: issuer,
        reger,
        recipient: holder.pre,
        credentialSaid: creder.said!,
        message: "grant",
      });

      assertEquals(issued.verifierDecision.kind, "accept");
      assertEquals(grant.grant.route, IPEX_GRANT_ROUTE);
      assertEquals(grant.grant.ked?.p, "");
      assertEquals(grant.grant.ked?.a, { m: "grant", i: holder.pre });
      assertExists(grant.grant.ked?.e);
      assertEquals(new SerderACDC({ raw: grant.artifacts.acdc }).said, creder.said);
      assertEquals(grant.artifacts.acdc, new CredentialWallet(reger).exportCredential(creder.said!));
      assertEquals(grant.artifacts.iss, reger.cloneTvtAt(creder.said!, 0));
      assertEquals(
        grant.artifacts,
        credentialPresentationArtifacts(hby, reger, creder.said!),
      );
      const v2Artifacts = credentialPresentationArtifacts(
        hby,
        reger,
        creder.said!,
        Vrsn_2_0,
      );
      const acdcProofCounter = parseCounterFromText(
        v2Artifacts.acdc.slice(creder.raw.length),
        Vrsn_2_0,
      );
      const issSerder = new SerderKERI({ raw: v2Artifacts.iss });
      const issReplayCounter = parseCounterFromText(
        v2Artifacts.iss.slice(issSerder.size),
        Vrsn_1_0,
      );
      const ancSerder = new SerderKERI({ raw: v2Artifacts.anc });
      const ancReplayCounter = parseCounterFromText(
        v2Artifacts.anc.slice(ancSerder.size),
        Vrsn_1_0,
      );

      assertEquals(acdcProofCounter.code, CtrDexV2.SealSourceTriples);
      assertEquals(issReplayCounter.code, CtrDexV1.AttachmentGroup);
      assertEquals(ancReplayCounter.code, CtrDexV1.AttachmentGroup);
      assertEquals(grant.support.length > 0, true);
      assertEquals(grant.wire.length > grant.grant.raw.length, true);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("IPEX credential artifacts settle in a fresh holder verifier and admit references grant", async () => {
  await run(function*() {
    const issuerHby = yield* createHabery({
      name: `ipex-credential-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const issuerReger = yield* createReger({
      name: `ipex-credential-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const holderHby = yield* createHabery({
      name: `ipex-credential-holder-${crypto.randomUUID()}`,
      temp: true,
    });
    const holderReger = yield* createReger({
      name: `ipex-credential-holder-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = issuerHby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const holder = holderHby.makeHab("holder", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const schemer = new Schemer({ sed: schemaSed() });
      issuerHby.db.schema.pin(schemer.said, schemer);
      holderHby.db.schema.pin(schemer.said, schemer);

      const issuerTvy = new Tevery({ db: issuerHby.db, reger: issuerReger });
      const issuerVry = new Verifier(issuerHby, { reger: issuerReger });
      const rgy = new Regery(issuerHby, { reger: issuerReger, tvy: issuerTvy, vry: issuerVry });
      const registry = rgy.makeRegistry("issuer-reg", issuer);
      const credentialer = new Credentialer(issuerHby, { reger: issuerReger, vry: issuerVry });
      const creder = credentialer.create({
        registry,
        schema: schemer.said,
        recipient: holder.pre,
        data: { role: "holder" },
      });
      credentialer.issue(registry, creder);

      const grant = ipexCredentialGrant({
        hby: issuerHby,
        hab: issuer,
        reger: issuerReger,
        recipient: holder.pre,
        credentialSaid: creder.said!,
        message: "grant",
      });

      const holderTvy = new Tevery({ db: holderHby.db, reger: holderReger });
      const holderVry = new Verifier(holderHby, { reger: holderReger });
      const holderReactor = new Reactor(holderHby, {
        vdr: {
          reger: holderReger,
          tvy: holderTvy,
          vry: holderVry,
        },
      });
      for (const message of grant.support) {
        holderReactor.processChunk(message);
      }
      holderReactor.processEscrowsOnce();
      processCredentialPresentationArtifacts(holderReactor, grant.artifacts);

      assertEquals(holderReger.saved.get([creder.said!])?.qb64, creder.said);
      assertEquals(new CredentialWallet(holderReger).list({ aid: holder.pre }), [creder.said]);

      const admit = ipexCredentialAdmit({
        hab: holder,
        reger: holderReger,
        grant: grant.grant,
        message: "admit",
      });
      assertEquals(admit.admit.route, IPEX_ADMIT_ROUTE);
      assertEquals(admit.admit.ked?.p, grant.grant.said);
      assertEquals(admit.wire.length > admit.admit.raw.length, true);
    } finally {
      yield* holderReger.close(true);
      yield* holderHby.close(true);
      yield* issuerReger.close(true);
      yield* issuerHby.close(true);
    }
  });
});
