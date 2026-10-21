import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  concatBytes,
  Counter,
  CtrDexV2,
  Diger,
  parseCounterFromText,
  SerderACDC,
  SerderKERI,
  type Versionage,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import {
  credentialGrantReady,
  credentialPresentationArtifacts,
  ipexCredentialAdmit,
  ipexCredentialGrant,
  processCredentialPresentationArtifacts,
  storedGrantArtifacts,
} from "../../../src/app/ipex-credentialing.ts";
import { storedExchangeMessage } from "../../../src/app/ipex-grouping.ts";
import { IPEX_ADMIT_ROUTE, IPEX_GRANT_ROUTE, ipexGrantExn, loadIpexHandlers } from "../../../src/app/ipexing.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { Verifier } from "../../../src/app/verifying.ts";
import { attachmentCounterPayloadQb64b } from "../../../src/core/attachment-countering.ts";
import { Revery } from "../../../src/core/routing.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { createReger } from "../../../src/db/reger.ts";
import { Credentialer, CredentialWallet, Regery } from "../../../src/vdr/credentialing.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";
import { protocolFixture } from "../../protocol-fixture.ts";

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
      assertEquals(new SerderACDC({ raw: grant.artifacts.acdc.wire }).said, creder.said);
      assertEquals(grant.artifacts.acdc.wire, new CredentialWallet(reger).exportCredential(creder.said!));
      assertEquals(grant.artifacts.iss.wire, reger.cloneTvtAt(creder.said!, 0));
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
        v2Artifacts.acdc.wire.slice(creder.raw.length),
        Vrsn_2_0,
      );
      const issSerder = new SerderKERI({ raw: v2Artifacts.iss.wire });
      const issReplayCounter = parseCounterFromText(
        v2Artifacts.iss.wire.slice(issSerder.size),
        Vrsn_2_0,
      );
      const ancSerder = new SerderKERI({ raw: v2Artifacts.anc.wire });
      const ancReplayCounter = parseCounterFromText(
        v2Artifacts.anc.wire.slice(ancSerder.size),
        Vrsn_2_0,
      );

      assertEquals(acdcProofCounter.code, CtrDexV2.SealSourceTriples);
      assertEquals(issReplayCounter.code, CtrDexV2.AttachmentGroup);
      assertEquals(ancReplayCounter.code, CtrDexV2.AttachmentGroup);
      assertEquals(grant.support.length > 0, true);
      assertEquals(grant.wire.length > grant.grant.raw.length, true);
      // A later accepted issuer event may repeat the TEL seal among other seals.
      // Grant approval checks membership, not the one-event proposal-signing policy.
      const reanchor = issuer.interact({
        data: [{ i: creder.said, s: "0", d: issued.tel.said }, { i: holder.pre, s: "0", d: schemer.said }],
      });
      const anchor = new SerderKERI({ raw: reanchor });
      const seal = [anchor.sner!.qb64b, new Diger({ qb64: anchor.said! }).qb64b];
      const reanchoredIss = concatBytes(
        issued.tel.raw,
        attachmentCounterPayloadQb64b("SealSourceCouples", 1, seal, Vrsn_1_0),
        ...seal,
      );
      const [reanchored, paths] = ipexGrantExn(
        issuer,
        holder.pre,
        "repeated source anchor",
        grant.artifacts.acdc.wire,
        { iss: reanchoredIss, anc: reanchor },
      );
      assertEquals(credentialGrantReady(hby, reger, reanchored, paths, Vrsn_1_0), true);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

/** Exercise the same independent issuer/holder workflow with each attachment genus. */
async function assertCredentialArtifactIntake(genus: Versionage, envelopeGenus = genus): Promise<void> {
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

      const issuerRevery = new Revery(issuerHby.db);
      const issuerTvy = new Tevery({ db: issuerHby.db, reger: issuerReger, rvy: issuerRevery });
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

      let grant = ipexCredentialGrant({
        hby: issuerHby,
        hab: issuer,
        reger: issuerReger,
        recipient: holder.pre,
        credentialSaid: creder.said!,
        message: "grant",
        options: { gvrsn: genus },
      });

      if (envelopeGenus.major !== genus.major) {
        // KERIpy rebuilds legacy grant envelopes with V1 while preserving child proofs.
        const [envelope, attachments] = ipexGrantExn(issuer, holder.pre, "grant", grant.artifacts.acdc.wire, {
          iss: grant.artifacts.iss.wire,
          anc: grant.artifacts.anc.wire,
          gvrsn: envelopeGenus,
        });
        grant = {
          ...grant,
          grant: envelope,
          wire: concatBytes(issuer.endorse(envelope, { pipelined: false, gvrsn: envelopeGenus }), attachments),
        };
      }

      const issuerReactor = new Reactor(protocolFixture(issuerHby, {
        revery: issuerRevery,
        tevery: issuerTvy,
        verifier: issuerVry,
      }));
      loadIpexHandlers(issuerHby, issuerReactor.protocol.exc);
      yield* issuerReactor.processBytes(concatBytes(Counter.makeGVC(envelopeGenus), grant.wire), { local: true });
      yield* issuerHby.db.reopen();
      const acceptedGrant = issuerHby.db.exns.get([grant.grant.said!]);
      assertExists(acceptedGrant);
      // The recipient receives reconstructed durable evidence, not the builder's original wire.
      const replay = storedExchangeMessage(issuerHby, acceptedGrant, envelopeGenus);
      assertEquals(replay, grant.wire);

      const revery = new Revery(holderHby.db);
      const holderTvy = new Tevery({ db: holderHby.db, reger: holderReger, rvy: revery });
      const holderVry = new Verifier(holderHby, { reger: holderReger });
      const holderReactor = new Reactor(protocolFixture(holderHby, {
        revery,
        tevery: holderTvy,
        verifier: holderVry,
      }));
      for (const message of grant.support) {
        yield* holderReactor.processBytes(message);
      }
      yield* holderReactor.protocol.processEscrowsOnce();
      loadIpexHandlers(holderHby, holderReactor.protocol.exc);
      yield* holderReactor.processBytes(concatBytes(Counter.makeGVC(envelopeGenus), replay));
      yield* holderHby.db.reopen();
      const storedGrant = holderHby.db.exns.get([grant.grant.said!]);
      assertExists(storedGrant);
      const artifacts = storedGrantArtifacts(holderHby, storedGrant, genus);
      assertEquals(artifacts, grant.artifacts);
      yield* processCredentialPresentationArtifacts(holderReactor.protocol, artifacts);

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
}

for (const genus of [Vrsn_1_0, Vrsn_2_0]) {
  Deno.test(`IPEX credential artifacts with genus ${genus.major} settle in a fresh holder verifier and admit references grant`, () =>
    assertCredentialArtifactIntake(genus));
}

Deno.test("IPEX stored V1 grant framing preserves V2 child proofs after database reopen", () =>
  assertCredentialArtifactIntake(Vrsn_2_0, Vrsn_1_0));
