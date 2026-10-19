import { action, call, type Operation, run } from "effection";
import { assertEquals, assertExists, assertStrictEquals } from "jsr:@std/assert";
import { concatBytes, Counter, type Versionage, Vrsn_1_0, Vrsn_2_0 } from "../../../../cesr/mod.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { httpMailboxPollTransport } from "../../../src/app/forwarding.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { ipexCredentialGrant } from "../../../src/app/ipex-credentialing.ts";
import { VerifierAgent } from "../../../src/app/verifier-agent.ts";
import { Verifier } from "../../../src/app/verifying.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { createReger, type Reger } from "../../../src/db/reger.ts";
import { createVerifierCueBaser, type VerifierCueBaser } from "../../../src/db/verifier-cueing.ts";
import { Credentialer, Regery, type Registry } from "../../../src/vdr/credentialing.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";
import { httpClient } from "../../support/http-client.ts";

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

interface IssuedFixture {
  issuerHby: Habery;
  issuerReger: Reger;
  issuer: Hab;
  verifier: Hab;
  registry: Registry;
  creder: import("../../../../cesr/mod.ts").SerderACDC;
  grant: ReturnType<typeof ipexCredentialGrant>;
}

function issueFixture(
  issuerHby: Habery,
  issuerReger: Reger,
  verifierHby: Habery,
  gvrsn: Versionage = Vrsn_1_0,
): IssuedFixture {
  const issuer = issuerHby.makeHab("issuer", undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  });
  const verifier = verifierHby.makeHab("verifier", undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  });
  const schemer = new Schemer({ sed: schemaSed() });
  issuerHby.db.schema.pin(schemer.said, schemer);
  verifierHby.db.schema.pin(schemer.said, schemer);

  const issuerTvy = new Tevery({ db: issuerHby.db, reger: issuerReger });
  const issuerVry = new Verifier(issuerHby, { reger: issuerReger });
  const rgy = new Regery(issuerHby, { reger: issuerReger, tvy: issuerTvy, vry: issuerVry });
  const registry = rgy.makeRegistry("issuer-reg", issuer);
  const credentialer = new Credentialer(issuerHby, { reger: issuerReger, vry: issuerVry });
  const creder = credentialer.create({
    registry,
    schema: schemer.said,
    recipient: verifier.pre,
    data: { role: "verifier-subject" },
  });
  credentialer.issue(registry, creder);
  const grant = ipexCredentialGrant({
    hby: issuerHby,
    hab: issuer,
    reger: issuerReger,
    recipient: verifier.pre,
    credentialSaid: creder.said!,
    message: "grant",
    options: { gvrsn },
  });
  return { issuerHby, issuerReger, issuer, verifier, registry, creder, grant };
}

/** Admit supporting state before the grant, then settle escrows before each verifier assertion. */
function* ingestGrant(runtime: AgentRuntime, fixture: IssuedFixture): Operation<void> {
  for (const message of fixture.grant.support) {
    yield* runtime.reactor.processBytes(message);
  }
  yield* runtime.reactor.processBytes(
    concatBytes(Counter.makeGVC(fixture.grant.artifacts.acdc.genus), fixture.grant.wire),
  );
  yield* runtime.protocol.processEscrowsOnce();
}

/** Verify grant reconstruction reaches the webhook through the configured receiver genus. */
async function assertIssuanceWebhook(gvrsn: Versionage): Promise<void> {
  await run(function*() {
    const issuerHby = yield* createHabery({
      name: `verifier-agent-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const issuerReger = yield* createReger({
      name: `verifier-agent-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const verifierHby = yield* createHabery({
      name: `verifier-agent-holder-${crypto.randomUUID()}`,
      temp: true,
    });
    const verifierReger = yield* createReger({
      name: `verifier-agent-holder-${crypto.randomUUID()}`,
      temp: true,
    });
    const cdb = yield* createVerifierCueBaser({
      name: `verifier-agent-cdb-${crypto.randomUUID()}`,
      temp: true,
    });
    const requests: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    const runtime = yield* createAgentRuntime(
      verifierHby,
      httpClient((_url, init) => {
        requests.push({
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
          headers: new Headers(init?.headers),
        });
        return Promise.resolve(new Response("", { status: 202 }));
      }),
      fixedClock(),
      httpMailboxPollTransport,
      { reger: verifierReger },
    );
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby, gvrsn);
      yield* ingestGrant(runtime, fixture);

      const agent = new VerifierAgent(
        verifierHby,
        verifierReger,
        cdb,
        runtime.reactor,
        runtime.cues,
        runtime.http,
        () => runtime.clock.now(),
        {},
        { hook: "http://example.test/hook", gvrsn },
      );
      const result = yield* agent.processOnce();

      assertEquals(result.grantsQueued, 1);
      assertEquals(result.presentationsReady, 1);
      assertEquals(result.webhooksSent, 1);
      assertEquals(requests.length, 1);
      assertEquals(requests[0]!.body.action, "iss");
      assertEquals(requests[0]!.body.actor, fixture.issuer.pre);
      assertEquals((requests[0]!.body.data as Record<string, unknown>).credential, fixture.creder.said);
      assertEquals((requests[0]!.body.data as Record<string, unknown>).recipient, fixture.verifier.pre);
      assertEquals(requests[0]!.headers.get("sally-resource"), fixture.creder.schema);
      assertExists(cdb.ack.get([fixture.creder.said!]));
      assertEquals(cdb.iss.get([fixture.creder.said!]), null);
    } finally {
      yield* runtime.close();
      yield* cdb.close(true);
      yield* verifierReger.close(true);
      yield* verifierHby.close(true);
      yield* issuerReger.close(true);
      yield* issuerHby.close(true);
    }
  });
}

for (const genus of [Vrsn_1_0, Vrsn_2_0]) {
  Deno.test(`VerifierAgent scans genus ${genus.major} grants and sends issuance webhook without notifier dependency`, () =>
    assertIssuanceWebhook(genus));
}

Deno.test("VerifierAgent queues revocation cues and sends revocation webhook", async () => {
  await run(function*() {
    const issuerHby = yield* createHabery({
      name: `verifier-agent-rev-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const issuerReger = yield* createReger({
      name: `verifier-agent-rev-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const verifierHby = yield* createHabery({
      name: `verifier-agent-rev-holder-${crypto.randomUUID()}`,
      temp: true,
    });
    const verifierReger = yield* createReger({
      name: `verifier-agent-rev-holder-${crypto.randomUUID()}`,
      temp: true,
    });
    const cdb = yield* createVerifierCueBaser({
      name: `verifier-agent-rev-cdb-${crypto.randomUUID()}`,
      temp: true,
    });
    const requests: Array<Record<string, unknown>> = [];
    const runtime = yield* createAgentRuntime(
      verifierHby,
      httpClient((_url, init) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Promise.resolve(new Response("", { status: 200 }));
      }),
      fixedClock(),
      httpMailboxPollTransport,
      { reger: verifierReger },
    );
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby);
      yield* ingestGrant(runtime, fixture);
      const agent = new VerifierAgent(
        verifierHby,
        verifierReger,
        cdb,
        runtime.reactor,
        runtime.cues,
        runtime.http,
        () => runtime.clock.now(),
        {},
        { hook: "http://example.test/hook" },
      );
      yield* agent.processOnce();

      fixture.registry.revoke(fixture.creder.said!);
      for (const message of issuerHby.db.clonePreIter(fixture.issuer.pre)) {
        yield* runtime.reactor.processBytes(message);
      }
      for (const message of issuerReger.clonePreIter(fixture.creder.said!)) {
        yield* runtime.reactor.processBytes(message);
      }
      yield* runtime.protocol.processEscrowsOnce();

      const revoked = runtime.cues.toArray().find((cue) => cue.kin === "revoked");
      assertExists(revoked, "actual accepted TEL processing must produce the borrowed revocation");
      const unrelated: AgentCue[] = [
        { kin: "oobiQueued", url: "https://peer.test/first" },
        { kin: "oobiFailed", url: "https://peer.test/last", reason: "gone" },
      ];
      const cues = runtime.cues, duplicate = { ...revoked };
      cues.clear();
      cues.extend([unrelated[0], revoked, unrelated[1], duplicate]);
      const pin = cdb.rev.pin;
      for (const failure of [new Error("revocation storage fault"), undefined]) {
        cdb.rev.pin = () => {
          throw failure;
        };
        let caught = false;
        try {
          yield* call(() => run(() => agent.processOnce()));
        } catch (error) {
          caught = true;
          assertStrictEquals(error, failure);
        } finally {
          cdb.rev.pin = pin;
        }
        assertEquals(caught, true, "storage failure must preserve its exact identity");
        assertEquals(cues.toArray(), [unrelated[0], revoked, unrelated[1], duplicate]);
        assertEquals(cdb.rev.get([fixture.creder.said!]), null);
        assertEquals(requests.length, 1, "failed publication must not send a webhook");
      }
      const result = yield* agent.processOnce();
      assertEquals(cues.toArray(), unrelated, "unrelated cues preserve order after duplicate consumption");
      cues.clear();

      assertEquals(result.revocationsQueued, 1);
      assertEquals(result.revocationsReady, 1);
      assertEquals(result.webhooksSent, 1);
      assertEquals(requests.length, 2);
      assertEquals(requests[1]!.action, "rev");
      assertEquals((requests[1]!.data as Record<string, unknown>).credential, fixture.creder.said);
      assertExists((requests[1]!.data as Record<string, unknown>).revocationTimestamp);
    } finally {
      yield* runtime.close();

      yield* cdb.close(true);
      yield* verifierReger.close(true);
      yield* verifierHby.close(true);
      yield* issuerReger.close(true);
      yield* issuerHby.close(true);
    }
  });
});

Deno.test("VerifierAgent rescans persisted revoked credentials after cue loss", async () => {
  await run(function*() {
    const issuerHby = yield* createHabery({
      name: `verifier-agent-persisted-rev-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const issuerReger = yield* createReger({
      name: `verifier-agent-persisted-rev-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const verifierHby = yield* createHabery({
      name: `verifier-agent-persisted-rev-holder-${crypto.randomUUID()}`,
      temp: true,
    });
    const verifierReger = yield* createReger({
      name: `verifier-agent-persisted-rev-holder-${crypto.randomUUID()}`,
      temp: true,
    });
    const cdb = yield* createVerifierCueBaser({
      name: `verifier-agent-persisted-rev-cdb-${crypto.randomUUID()}`,
      temp: true,
    });
    const requests: Array<Record<string, unknown>> = [];
    const runtime = yield* createAgentRuntime(
      verifierHby,
      httpClient((_url, init) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Promise.resolve(new Response("", { status: 200 }));
      }),
      fixedClock(),
      httpMailboxPollTransport,
      { reger: verifierReger },
    );
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby);
      yield* ingestGrant(runtime, fixture);
      const agent = new VerifierAgent(
        verifierHby,
        verifierReger,
        cdb,
        runtime.reactor,
        runtime.cues,
        runtime.http,
        () => runtime.clock.now(),
        {},
        { hook: "http://example.test/hook" },
      );
      yield* agent.processOnce();
      assertExists(cdb.ack.get([fixture.creder.said!]));

      fixture.registry.revoke(fixture.creder.said!);
      for (const message of issuerHby.db.clonePreIter(fixture.issuer.pre)) {
        yield* runtime.reactor.processBytes(message);
      }
      for (const message of issuerReger.clonePreIter(fixture.creder.said!)) {
        yield* runtime.reactor.processBytes(message);
      }
      yield* runtime.protocol.processEscrowsOnce();
      runtime.cues.clear();

      const result = yield* agent.processOnce();
      const repeat = yield* agent.processOnce();

      assertEquals(result.revocationsQueued, 1);
      assertEquals(result.revocationsReady, 1);
      assertEquals(result.webhooksSent, 1);
      assertEquals(repeat.revocationsQueued, 0);
      assertEquals(repeat.webhooksSent, 0);
      assertEquals(requests.length, 2);
      assertEquals(requests[1]!.action, "rev");
      assertExists(cdb.rack.get([fixture.creder.said!]));
    } finally {
      yield* runtime.close();
      yield* cdb.close(true);
      yield* verifierReger.close(true);
      yield* verifierHby.close(true);
      yield* issuerReger.close(true);
      yield* issuerHby.close(true);
    }
  });
});

function fixedClock() {
  return {
    now: () => Date.parse("2026-06-06T12:00:00.000Z"),
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
}
