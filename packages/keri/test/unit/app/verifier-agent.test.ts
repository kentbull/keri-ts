// @file-test-lane app-fast-parallel

import { action, type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { ipexCredentialGrant } from "../../../src/app/ipex-credentialing.ts";
import { VerifierAgent, type VerifierAgentProcessResult } from "../../../src/app/verifier-agent.ts";
import { Verifier } from "../../../src/app/verifying.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { createReger, type Reger } from "../../../src/db/reger.ts";
import { createVerifierCueBaser, type VerifierCueBaser } from "../../../src/db/verifier-cueing.ts";
import { Credentialer, Regery, type Registry } from "../../../src/vdr/credentialing.ts";
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
  });
  return { issuerHby, issuerReger, issuer, verifier, registry, creder, grant };
}

function ingestGrant(runtime: AgentRuntime, fixture: IssuedFixture): void {
  for (const message of fixture.grant.support) {
    runtime.reactor.processChunk(message);
  }
  runtime.reactor.processChunk(fixture.grant.wire);
  runtime.reactor.processEscrowsOnce();
}

Deno.test("VerifierAgent scans accepted grants and sends issuance webhook without notifier dependency", async () => {
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
    const runtime = yield* createAgentRuntime(verifierHby, {
      mode: "local",
      vdr: { reger: verifierReger },
      services: {
        clock: fixedClock(),
        http: {
          fetch: (_url, init) => {
            requests.push({
              body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
              headers: new Headers(init?.headers),
            });
            return Promise.resolve(new Response("", { status: 202 }));
          },
        },
      },
    });
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby);
      ingestGrant(runtime, fixture);

      const agent = new VerifierAgent({
        hby: verifierHby,
        reger: verifierReger,
        cdb,
        reactor: runtime.reactor,
        cues: runtime.cues,
        services: runtime.services,
        hook: "http://example.test/hook",
      });
      const result = yield* processAgentOnce(agent);

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
});

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
    const runtime = yield* createAgentRuntime(verifierHby, {
      mode: "local",
      vdr: { reger: verifierReger },
      services: {
        clock: fixedClock(),
        http: {
          fetch: (_url, init) => {
            requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
            return Promise.resolve(new Response("", { status: 200 }));
          },
        },
      },
    });
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby);
      ingestGrant(runtime, fixture);
      const agent = new VerifierAgent({
        hby: verifierHby,
        reger: verifierReger,
        cdb,
        reactor: runtime.reactor,
        cues: runtime.cues,
        services: runtime.services,
        hook: "http://example.test/hook",
      });
      yield* processAgentOnce(agent);

      fixture.registry.revoke(fixture.creder.said!);
      for (const message of issuerHby.db.clonePreIter(fixture.issuer.pre)) {
        runtime.reactor.processChunk(message);
      }
      for (const message of issuerReger.clonePreIter(fixture.creder.said!)) {
        runtime.reactor.processChunk(message);
      }
      runtime.reactor.processEscrowsOnce();

      const result = yield* processAgentOnce(agent);

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
    const runtime = yield* createAgentRuntime(verifierHby, {
      mode: "local",
      vdr: { reger: verifierReger },
      services: {
        clock: fixedClock(),
        http: {
          fetch: (_url, init) => {
            requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
            return Promise.resolve(new Response("", { status: 200 }));
          },
        },
      },
    });
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby);
      ingestGrant(runtime, fixture);
      const agent = new VerifierAgent({
        hby: verifierHby,
        reger: verifierReger,
        cdb,
        reactor: runtime.reactor,
        cues: runtime.cues,
        services: runtime.services,
        hook: "http://example.test/hook",
      });
      yield* processAgentOnce(agent);
      assertExists(cdb.ack.get([fixture.creder.said!]));

      fixture.registry.revoke(fixture.creder.said!);
      for (const message of issuerHby.db.clonePreIter(fixture.issuer.pre)) {
        runtime.reactor.processChunk(message);
      }
      for (const message of issuerReger.clonePreIter(fixture.creder.said!)) {
        runtime.reactor.processChunk(message);
      }
      runtime.reactor.processEscrowsOnce();
      while (!runtime.cues.empty) {
        runtime.cues.pull();
      }

      const result = yield* processAgentOnce(agent);
      const repeat = yield* processAgentOnce(agent);

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

function* processAgentOnce(agent: VerifierAgent): Operation<VerifierAgentProcessResult> {
  return yield* action((resolve, reject) => {
    agent.processOnce().then(resolve, reject);
    return () => {};
  });
}
