import { concatBytes, Counter, Dater, type SerderACDC, type Versionage, Vrsn_1_0, Vrsn_2_0 } from "cesr-ts";
import { action, call, type Operation, run } from "effection";
import { assertEquals, assertExists, assertStrictEquals } from "jsr:@std/assert";
import { createReger, type Reger } from "keri-ts/db";
import {
  type AgentCue,
  type AgentRuntime,
  createAgentRuntime,
  createHabery,
  Credentialer,
  type Hab,
  type Habery,
  ipexCredentialGrant,
  Regery,
  type Registry,
  Schemer,
  Tevery,
  Verifier,
} from "keri-ts/runtime";
import { createVerifierCueBaser, VerifierAgent, type VerifierCueBaser } from "../mod.ts";
import { httpClient, manualClock } from "./fixtures.ts";

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
  creder: SerderACDC;
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
      { reger: verifierReger },
    );
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby, gvrsn);
      yield* ingestGrant(runtime, fixture);

      const agent = new VerifierAgent(
        verifierHby,
        verifierReger,
        cdb,
        runtime.protocol,
        runtime.cues,
        runtime.http,
        () => runtime.clock.now(),
        {},
        { hook: "http://example.test/hook", gvrsn },
      );
      if (gvrsn.major === 1) {
        const schema = fixture.creder.schema;
        if (typeof schema !== "string") throw new Error("Fixture requires a schema SAID");
        const refused = new VerifierAgent(
          verifierHby,
          verifierReger,
          cdb,
          runtime.protocol,
          runtime.cues,
          runtime.http,
          () => runtime.clock.now(),
          { [schema]: () => false },
          { hook: "http://example.test/hook", gvrsn },
        );
        const denied = yield* refused.processOnce();
        assertEquals(denied.webhooksSent, 0);
        assertEquals(denied.rejected, 1);
        assertEquals(requests.length, 0);
        assertEquals(verifierReger.saved.get(fixture.creder.said!)?.qb64, fixture.creder.said);
      }
      const result = yield* agent.processOnce();

      assertEquals(result.grantsQueued, 1);
      assertEquals(result.rejected, 0);
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
    const clock = manualClock(Date.UTC(2034, 0, 1));
    let acceptRevocation = false;
    const runtime = yield* createAgentRuntime(
      verifierHby,
      httpClient((_url, init) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Promise.resolve(
          new Response("", { status: requests.at(-1)!.action === "rev" && !acceptRevocation ? 503 : 200 }),
        );
      }),
      clock,
      { reger: verifierReger },
    );
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby);
      yield* ingestGrant(runtime, fixture);
      const agent = new VerifierAgent(
        verifierHby,
        verifierReger,
        cdb,
        runtime.protocol,
        runtime.cues,
        runtime.http,
        () => runtime.clock.now(),
        {},
        { hook: "http://example.test/hook" },
      );
      yield* agent.processOnce();

      const revocation = fixture.registry.revoke(fixture.creder.said!);
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
      assertReadyTime(cdb.revk, fixture.creder.said!, clock.now());
      assertEquals(result.webhooksFailed, 1);
      assertEquals(result.webhooksSent, 0);
      acceptRevocation = true;
      clock.advance(500);
      const delivered = yield* agent.processOnce();
      assertEquals(cues.toArray(), unrelated, "unrelated cues preserve order after duplicate consumption");
      cues.clear();

      assertEquals(result.revocationsQueued, 1);
      assertEquals(result.revocationsReady, 1);
      assertEquals(delivered.webhooksSent, 1);
      assertEquals(requests.length, 3);
      assertEquals(requests[1]!.action, "rev");
      assertEquals((requests[1]!.data as Record<string, unknown>).credential, fixture.creder.said);
      assertEquals((requests[1]!.data as Record<string, unknown>).revocationTimestamp, revocation.serder.ked!.dt);
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
    const clock = manualClock(Date.UTC(2034, 0, 1));
    let acceptRevocation = false;
    const runtime = yield* createAgentRuntime(
      verifierHby,
      httpClient((_url, init) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Promise.resolve(
          new Response("", { status: requests.at(-1)!.action === "rev" && !acceptRevocation ? 503 : 200 }),
        );
      }),
      clock,
      { reger: verifierReger },
    );
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby);
      yield* ingestGrant(runtime, fixture);
      const agent = new VerifierAgent(
        verifierHby,
        verifierReger,
        cdb,
        runtime.protocol,
        runtime.cues,
        runtime.http,
        () => runtime.clock.now(),
        {},
        { hook: "http://example.test/hook" },
      );
      yield* agent.processOnce();
      assertExists(cdb.ack.get([fixture.creder.said!]));

      const revocation = fixture.registry.revoke(fixture.creder.said!);
      for (const message of issuerHby.db.clonePreIter(fixture.issuer.pre)) {
        yield* runtime.reactor.processBytes(message);
      }
      for (const message of issuerReger.clonePreIter(fixture.creder.said!)) {
        yield* runtime.reactor.processBytes(message);
      }
      yield* runtime.protocol.processEscrowsOnce();
      runtime.cues.clear();

      const result = yield* agent.processOnce();
      assertReadyTime(cdb.revk, fixture.creder.said!, clock.now());
      assertEquals(result.webhooksFailed, 1);
      assertEquals(result.webhooksSent, 0);
      acceptRevocation = true;
      clock.advance(500);
      const delivered = yield* agent.processOnce();
      const repeat = yield* agent.processOnce();

      assertEquals(result.revocationsQueued, 1);
      assertEquals(result.revocationsReady, 1);
      assertEquals(delivered.webhooksSent, 1);
      assertEquals(repeat.revocationsQueued, 0);
      assertEquals(repeat.webhooksSent, 0);
      assertEquals(requests.length, 3);
      assertEquals(requests[1]!.action, "rev");
      assertEquals((requests[1]!.data as Record<string, unknown>).revocationTimestamp, revocation.serder.ked!.dt);
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

/** Assert actual persisted workflow keys, rather than the implementation's private clock helper. */
function assertReadyTime(db: VerifierCueBaser["recv"], said: string, expected: number): void {
  const rows = [...db.getTopItemIter([said, ""])];
  assertEquals(rows.length, 1);
  const dater = new Dater({ qb64: rows[0]![0][1]! });
  assertEquals(Date.parse(dater.dts), expected);
}

Deno.test("VerifierAgent uses one wall clock for webhook admission, headers and expiry", async () => {
  await run(function*() {
    const issuerHby = yield* createHabery({ name: "clock-issuer", temp: true });
    const issuerReger = yield* createReger({ name: "clock-issuer", temp: true });
    const verifierHby = yield* createHabery({ name: "clock-verifier", temp: true });
    const verifierReger = yield* createReger({ name: "clock-verifier", temp: true });
    const cdb = yield* createVerifierCueBaser({ name: "clock-cues", temp: true });
    // Deliberately differ from the real clock so accidental Date.now() calls cannot pass.
    const clock = manualClock(Date.UTC(2034, 0, 1));
    const requests: Array<{ headers: Headers; data: Record<string, unknown> }> = [];
    const http = httpClient((_url, init) => {
      requests.push({ headers: new Headers(init?.headers), data: JSON.parse(String(init?.body)).data });
      return Promise.resolve(new Response("refused", { status: 503 }));
    });
    const runtime = yield* createAgentRuntime(verifierHby, http, clock, {
      reger: verifierReger,
    });
    try {
      const fixture = issueFixture(issuerHby, issuerReger, verifierHby);
      yield* ingestGrant(runtime, fixture);
      const timeoutMs = 1000, admittedAt = clock.now();
      const agent = new VerifierAgent(
        verifierHby,
        verifierReger,
        cdb,
        runtime.protocol,
        runtime.cues,
        http,
        () => clock.now(),
        {},
        { hook: "https://hook.test/", timeoutMs },
      );

      const result = yield* agent.processOnce();
      assertEquals([result.presentationsReady, result.webhooksFailed], [1, 1]);
      assertReadyTime(cdb.recv, fixture.creder.said!, admittedAt);
      assertEquals(requests[0]!.headers.get("sally-timestamp"), new Date(admittedAt).toISOString());
      const attrs = fixture.creder.attrib as Record<string, unknown>;
      assertExists(attrs.dt);
      assertEquals(requests[0]!.data.issueTimestamp, attrs.dt);

      // Equality stays eligible. A later request samples current time without changing admission.
      clock.advance(timeoutMs);
      yield* agent.processOnce();
      assertReadyTime(cdb.recv, fixture.creder.said!, admittedAt);
      assertEquals(requests[1]!.headers.get("sally-timestamp"), new Date(clock.now()).toISOString());

      // Sending still precedes the existing post-refusal expiry decision.
      clock.advance(1);
      yield* agent.processOnce();
      assertEquals(requests.length, 3);
      assertEquals(requests[2]!.headers.get("sally-timestamp"), new Date(clock.now()).toISOString());
      assertEquals([...cdb.recv.getTopItemIter()].length, 0);
      assertEquals(cdb.ack.get([fixture.creder.said!]), null);
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
