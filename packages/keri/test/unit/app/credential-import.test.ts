import { call, ensure, type Operation, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { concatBytes, type SerderACDC } from "../../../../cesr/mod.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { importCredentialStream } from "../../../src/app/credential-importing.ts";
import { credentialStreamBytes } from "../../../src/app/credential-workflows.ts";
import { createExchangeMessage } from "../../../src/app/exchange-messaging.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import {
  credentialSupportMessages,
  ipexCredentialGrant,
  processCredentialPresentationArtifacts,
} from "../../../src/app/ipex-credentialing.ts";
import { loadIpexHandlers } from "../../../src/app/ipexing.ts";
import { processMessages } from "../../../src/app/message-source.ts";
import { type ProtocolProcessor } from "../../../src/app/protocol-processing.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { Verifier } from "../../../src/app/verifying.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { Revery } from "../../../src/core/routing.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { createReger, type Reger } from "../../../src/db/reger.ts";
import { Credentialer, CredentialWallet, Regery, type Registry } from "../../../src/vdr/credentialing.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";
import { protocolFixture } from "../../protocol-fixture.ts";

/** Independent issuer and recipient stores; every assertion exercises real KEL/TEL/credential processing. */
interface ImportFixture {
  source: Habery;
  sourceReger: Reger;
  target: Habery;
  reger: Reger;
  protocol: ProtocolProcessor;
  issuer: Hab;
  holder: Hab;
  registry: Registry;
  credentialer: Credentialer;
  schema: Schemer;
  creder: SerderACDC;
}

/** Open independent stores and join their shutdown after all input/handler children finish. */
function fixture(): Operation<ImportFixture> {
  return resource<ImportFixture>(function*(provide) {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sourceReger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = source.makeHab("issuer", undefined, { transferable: true });
      const holder = target.makeHab("holder", undefined, { transferable: true });
      const schema = new Schemer({ sed: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" } });
      source.db.schema.pin(schema.said, schema);
      target.db.schema.pin(schema.said, schema);
      const rgy = new Regery(source, { reger: sourceReger });
      const registry = rgy.makeRegistry("registry", issuer);
      const credentialer = new Credentialer(source, { reger: sourceReger, vry: rgy.vry });
      const creder = credentialer.create({
        registry,
        schema: schema.said,
        recipient: holder.pre,
        data: { role: "holder" },
      });
      assertEquals(credentialer.issue(registry, creder).verifierDecision.kind, "accept");
      const output = new Deck<AgentCue>();
      const revery = new Revery(target.db, { cues: output });
      const protocol = protocolFixture(target, {
        protocolCues: output,
        revery,
        tevery: new Tevery({ db: target.db, reger, rvy: revery, cues: output }),
        verifier: new Verifier(target, { reger, cues: output }),
      });
      yield* provide({
        source,
        sourceReger,
        target,
        reger,
        protocol,
        issuer,
        holder,
        registry,
        credentialer,
        schema,
        creder,
      });
    } finally {
      yield* reger.close(true);
      yield* target.close(true);
      yield* sourceReger.close(true);
      yield* source.close(true);
    }
  });
}

Deno.test("finite credential import reports ordered acceptance, duplicates, KEL/TEL support and revocation", async () => {
  await run(function*() {
    const f = yield* fixture();
    const bytes = credentialStreamBytes(f.source, f.sourceReger, f.creder, f.holder.pre);
    const first = yield* importCredentialStream(f.protocol, f.reger, bytes, systemClock);
    assertEquals(first.complete, true);
    assertEquals(first.saved, [f.creder.said]);
    assertEquals(new Set(first.targets.map((target) => target.kind)), new Set(["kel", "tel", "credential"]));
    assertEquals(first.targets.every((target) => target.status === "accepted"), true);
    const again = yield* importCredentialStream(f.protocol, f.reger, bytes, systemClock);
    assertEquals(again.complete, true);
    assertEquals(again.saved, []);
    assertEquals(again.targets.every((target) => target.status === "alreadyAccepted"), true);

    const revoked = f.registry.revoke(f.creder.said!);
    const revocation = concatBytes(
      ...f.source.db.clonePreIter(f.issuer.pre),
      ...f.sourceReger.clonePreIter(f.creder.said!),
    );
    const result = yield* importCredentialStream(f.protocol, f.reger, revocation, systemClock);
    assertEquals(result.complete, true);
    assertEquals(result.saved, []);
    assertEquals(result.targets.find((target) => target.said === revoked.serder.said)?.status, "accepted");
  });
});

Deno.test("finite credential import settles reverse chain dependencies that two escrow passes leave unresolved", async () => {
  await run(function*() {
    const f = yield* fixture();
    const creds: SerderACDC[] = [];
    // Descending SAID initials force parent-before-child iteration in the real sorted credential escrow.
    for (const initial of ["P", "O", "N", "M", "L", "K", "J", "I"]) {
      let creder: SerderACDC | undefined;
      for (let nonce = 0; nonce < 10_000; nonce++) {
        const child = creds.at(-1);
        const candidate = f.credentialer.create({
          registry: f.registry,
          schema: f.schema.said,
          recipient: f.holder.pre,
          data: { nonce, initial },
          ...(child ? { edges: { child: { n: child.said, o: "NI2I" } } } : {}),
        });
        if (candidate.said![1] === initial) {
          creder = candidate;
          break;
        }
      }
      assertExists(creder);
      assertEquals(f.credentialer.issue(f.registry, creder).verifierDecision.kind, "accept");
      creds.push(creder);
    }
    const wallet = new CredentialWallet(f.sourceReger);
    const bytes = concatBytes(
      ...[...creds].reverse().map((creder) => wallet.exportCredential(creder.said!)),
      ...f.source.db.clonePreIter(f.issuer.pre),
      ...f.sourceReger.clonePreIter(f.registry.regk!),
      ...creds.flatMap((creder) => [...f.sourceReger.clonePreIter(creder.said!)]),
    );
    // Reproduce the old two-pass rule using the actual parser and owners before exercising settlement.
    yield* processMessages((signal) => chunkBytes(bytes, { signal }), f.protocol, f.protocol.makeKevery());
    yield* f.protocol.processEscrowsOnce();
    yield* f.protocol.processEscrowsOnce();
    assertEquals(f.reger.saved.get([creds.at(-1)!.said!]), null);
    const result = yield* importCredentialStream(f.protocol, f.reger, bytes, systemClock);
    assertEquals(result.complete, true);
    assertEquals(creds.every((creder) => f.reger.saved.get([creder.said!]) !== null), true);
    assertEquals(result.saved.length > 0, true);
  });
});

Deno.test("finite import returns incomplete for missing schema without counting raw credential storage as acceptance", async () => {
  await run(function*() {
    const f = yield* fixture();
    f.target.db.schema.rem(f.schema.said);
    const result = yield* importCredentialStream(
      f.protocol,
      f.reger,
      credentialStreamBytes(f.source, f.sourceReger, f.creder, f.holder.pre),
      systemClock,
      30,
    );
    assertEquals(result.complete, false);
    assertEquals(result.saved, []);
    assertExists(f.reger.creds.get([f.creder.said!]));
    assertEquals(f.reger.saved.get([f.creder.said!]), null);
    assertEquals(result.targets.find((target) => target.said === f.creder.said)?.status, "unresolved");
    assertEquals(result.targets.find((target) => target.said === f.creder.said)?.reason, "missingSchema");
  });
});

Deno.test("finite import ignores unrelated existing escrows and reports only this input's saved credentials", async () => {
  await run(function*() {
    const f = yield* fixture();
    const otherSchema = new Schemer({
      sed: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", title: "other" },
    });
    f.source.db.schema.pin(otherSchema.said, otherSchema);
    const other = f.credentialer.create({
      registry: f.registry,
      schema: otherSchema.said,
      recipient: f.holder.pre,
      data: {},
    });
    f.credentialer.issue(f.registry, other);
    const first = yield* importCredentialStream(
      f.protocol,
      f.reger,
      credentialStreamBytes(f.source, f.sourceReger, other, f.holder.pre),
      systemClock,
      10,
    );
    assertEquals(first.complete, false);
    // A ready target completes even while the unrelated schema escrow remains unresolved.
    const support = acceptedEventReplayMessage(f.source, f.issuer.pre, 0).message;
    assertEquals((yield* importCredentialStream(f.protocol, f.reger, support, systemClock)).complete, true);
    assertExists(f.reger.mse.get([other.said!]));

    f.target.db.schema.pin(otherSchema.said, otherSchema);
    const bytes = concatBytes(
      new CredentialWallet(f.sourceReger).exportCredential(f.creder.said!),
      ...credentialSupportMessages(f.source, f.sourceReger, f.creder, f.holder.pre),
    );
    f.target.db.schema.rem(f.schema.said);
    const unresolved = yield* importCredentialStream(f.protocol, f.reger, bytes, systemClock, 30);
    assertEquals(unresolved.complete, false);
    assertEquals(unresolved.saved, []);
    // Shared escrow recovery is real, but its credential is outside this import's result scope.
    assertExists(f.reger.saved.get([other.said!]));
    f.target.db.schema.pin(f.schema.said, f.schema);
    const result = yield* importCredentialStream(f.protocol, f.reger, bytes, systemClock);
    assertEquals(result.complete, true);
    assertEquals(result.saved, [f.creder.said]);
  });
});

Deno.test("importing an IPEX grant does not admit its embedded credential", async () => {
  await run(function*() {
    const f = yield* fixture();
    loadIpexHandlers(f.target, f.protocol.exc);
    const grant = ipexCredentialGrant({
      hby: f.source,
      hab: f.issuer,
      reger: f.sourceReger,
      recipient: f.holder.pre,
      credentialSaid: f.creder.said!,
    });
    const result = yield* importCredentialStream(
      f.protocol,
      f.reger,
      concatBytes(...grant.support, grant.wire),
      systemClock,
    );
    assertEquals(result.complete, true);
    assertEquals(result.saved, []);
    assertEquals(f.reger.saved.get([f.creder.said!]), null);
    yield* processCredentialPresentationArtifacts(f.protocol, grant.artifacts);
    assertExists(f.reger.saved.get([f.creder.said!]));
  });
});

Deno.test("finite import reports raw credential rejection and preserves acceptance before a malformed later frame", async () => {
  await run(function*() {
    const f = yield* fixture();
    const rejected = yield* importCredentialStream(f.protocol, f.reger, f.creder.raw, systemClock);
    assertEquals(rejected.complete, false);
    assertEquals(rejected.targets[0]?.status, "rejected");
    assertEquals(rejected.targets[0]?.reason, "missingAnchor");
    const partial = yield* importCredentialStream(
      f.protocol,
      f.reger,
      concatBytes(credentialStreamBytes(f.source, f.sourceReger, f.creder, f.holder.pre), f.creder.raw),
      systemClock,
    );
    assertEquals(partial.complete, false);
    assertEquals(partial.saved, [f.creder.said]);
    assertEquals(partial.targets.find((target) => target.said === f.creder.said)?.status, "rejected");
    const fresh = f.source.makeHab("before-malformed");
    const kel = acceptedEventReplayMessage(f.source, fresh.pre, 0).message;
    assertEquals(f.target.db.getKever(fresh.pre), null);
    yield* call(() =>
      assertRejects(() =>
        run(() =>
          importCredentialStream(
            f.protocol,
            f.reger,
            concatBytes(kel, new TextEncoder().encode("{\"v\":\"bad\"}")),
            systemClock,
          )
        )
      )
    );
    assertExists(f.target.db.getKever(fresh.pre));
  });
});

Deno.test("cancelling finite import joins a suspended handler before releasing its source and protocol turn", async () => {
  await run(function*() {
    const f = yield* fixture();
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = false, returned = false;
    f.protocol.exc.addHandler({
      resource: "/import/blocked",
      verify: () => true,
      *handle() {
        yield* ensure(function*() {
          yield* call(() => cleanup);
          closed = true;
        });
        entered();
        yield* suspend();
      },
    });
    const intro = acceptedEventReplayMessage(f.source, f.issuer.pre, 0).message;
    const first = createExchangeMessage(f.issuer, { dest: f.holder.pre, route: "/import/blocked", payload: {} });
    const later = f.source.makeHab("later");
    const task = yield* spawn(function*() {
      yield* importCredentialStream(
        f.protocol,
        f.reger,
        concatBytes(intro, first.msg, acceptedEventReplayMessage(f.source, later.pre, 0).message),
        systemClock,
      );
      returned = true;
    });
    yield* call(() => entry);
    let joined = false;
    const halt = task.halt().then(() => {
      joined = true;
    });
    yield* call(() => Promise.resolve());
    assertEquals(joined, false);
    release();
    yield* call(() => halt);
    assertEquals([closed, returned], [true, false]);
    assertEquals(f.target.db.getKever(later.pre), null);
    // Cancellation cannot leave the shared protocol turn locked.
    yield* f.protocol.processEscrowsOnce();
    assertStrictEquals(joined, true);
  });
});

Deno.test("finite import preserves the original handler failure and earlier accepted state", async () => {
  await run(function*() {
    const f = yield* fixture();
    const failure = new Error("credential input handler failed");
    f.protocol.exc.addHandler({
      resource: "/import/failure",
      verify: () => true,
      handle() {
        throw failure;
      },
    });
    const msg = createExchangeMessage(f.issuer, { dest: f.holder.pre, route: "/import/failure", payload: {} });
    let observed: unknown;
    try {
      yield* importCredentialStream(
        f.protocol,
        f.reger,
        concatBytes(acceptedEventReplayMessage(f.source, f.issuer.pre, 0).message, msg.msg),
        systemClock,
      );
    } catch (error) {
      observed = error;
    }
    assertStrictEquals(observed, failure);
    assertExists(f.target.db.getKever(f.issuer.pre));
    yield* f.protocol.processEscrowsOnce();
  });
});
