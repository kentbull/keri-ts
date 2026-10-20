import { call, ensure, type Operation, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { concatBytes, parseBytes, type SerderACDC } from "../../../../cesr/mod.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { importCredentialStream } from "../../../src/app/credential-importing.ts";
import { credentialStreamBytes } from "../../../src/app/credential-workflows.ts";
import { createExchangeMessage } from "../../../src/app/exchange-messaging.ts";
import type { ExchangeRouteVerification } from "../../../src/app/exchanging.ts";
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
import { consoleLogger } from "../../../src/core/logger.ts";
import { Revery } from "../../../src/core/routing.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { createReger, type Reger } from "../../../src/db/reger.ts";
import { Credentialer, CredentialWallet, Regery, type Registry } from "../../../src/vdr/credentialing.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";
import { protocolFixture } from "../../protocol-fixture.ts";
import { ManualRuntimeClock } from "../../support/runtime-fakes.ts";

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
    assertEquals(first.unaccepted, []);
    const again = yield* importCredentialStream(f.protocol, f.reger, bytes, systemClock);
    assertEquals(again.complete, true);
    assertEquals(again.saved, []);
    assertEquals(again.unaccepted, []);

    const revoked = f.registry.revoke(f.creder.said!);
    const revocation = concatBytes(
      ...f.source.db.clonePreIter(f.issuer.pre),
      ...f.sourceReger.clonePreIter(f.creder.said!),
    );
    const result = yield* importCredentialStream(f.protocol, f.reger, revocation, systemClock);
    assertEquals(result.complete, true);
    assertEquals(result.saved, []);
    assertEquals(result.unaccepted, []);
    assertEquals(f.reger.tels.getOn(f.creder.said!, 1)?.qb64, revoked.serder.said);
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
    const dispatch = f.protocol.dispatch.bind(f.protocol);
    let dispatches = 0;
    f.protocol.dispatch = function*(...args) {
      dispatches++;
      return yield* dispatch(...args);
    };
    const result = yield* importCredentialStream(f.protocol, f.reger, bytes, systemClock);
    assertEquals(result.complete, true);
    assertEquals(creds.every((creder) => f.reger.saved.get([creder.said!]) !== null), true);
    assertEquals(result.saved.length > 0, true);
    assertEquals(
      dispatches,
      parseBytes(bytes).length,
      "escrows recover dependencies without redispatching input frames",
    );
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
      5,
    );
    assertEquals(result.complete, false);
    assertEquals(result.saved, []);
    assertExists(f.reger.creds.get([f.creder.said!]));
    assertEquals(f.reger.saved.get([f.creder.said!]), null);
    assertEquals(result.unaccepted, [f.creder.said]);
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
    const warn = consoleLogger.warn, warnings: unknown[][] = [];
    consoleLogger.warn = (...args) => warnings.push(args);
    try {
      const rejected = yield* importCredentialStream(f.protocol, f.reger, f.creder.raw, systemClock, 5);
      assertEquals(rejected.complete, false);
      assertEquals(rejected.unaccepted, [f.creder.said]);
      const partial = yield* importCredentialStream(
        f.protocol,
        f.reger,
        concatBytes(credentialStreamBytes(f.source, f.sourceReger, f.creder, f.holder.pre), f.creder.raw),
        systemClock,
      );
      assertEquals(partial.complete, true, "a refused duplicate cannot override persisted acceptance");
      assertEquals(partial.saved, [f.creder.said]);
      assertEquals(partial.unaccepted, []);
      const refusals = warnings.filter(([message]) => message === "Credential import message refused");
      assertEquals(refusals.length, 2);
      for (const [, detail] of refusals) {
        assertEquals((detail as { said: string }).said, f.creder.said);
        assertEquals((detail as { reason: string }).reason, "missingAnchor");
      }
    } finally {
      consoleLogger.warn = warn;
    }
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

Deno.test("finite import handles receipt/reply input without inventing unaccepted targets", async () => {
  await run(function*() {
    const f = yield* fixture();
    const receiptor = f.source.makeHab("receiptor", undefined, { transferable: false });
    const support = concatBytes(...f.source.db.clonePreIter(f.issuer.pre), ...f.source.db.clonePreIter(receiptor.pre));
    yield* importCredentialStream(f.protocol, f.reger, support, systemClock);
    const event = f.issuer.kever!.serder;
    const bytes = concatBytes(
      receiptor.receipt(event),
      f.issuer.reply("/loc/scheme", { eid: f.issuer.pre, scheme: "http", url: "http://issuer.test" }),
    );
    const result = yield* importCredentialStream(f.protocol, f.reger, bytes, systemClock);
    assertEquals(result, { saved: [], complete: true, unaccepted: [] });
    assertEquals(f.target.db.rcts.get(dgKey(f.issuer.pre, event.said!)).length, 1);
    assertEquals(f.target.db.locs.get([f.issuer.pre, "http"])?.url, "http://issuer.test");
  });
});

Deno.test("finite import normalizes its deadline and waits for it when evidence stays missing", async () => {
  await run(function*() {
    const f = yield* fixture();
    f.target.db.schema.rem(f.schema.said);
    const bytes = credentialStreamBytes(f.source, f.sourceReger, f.creder, f.holder.pre);
    for (const [input, expected] of [[undefined, 5000], [0.25, 1], [1.9, 1], [25.9, 25]] as const) {
      const clock = new ManualRuntimeClock();
      const schedule = clock.setTimeout.bind(clock), cancel = clock.clearTimeout.bind(clock);
      const active = new Set<unknown>(), delays: number[] = [];
      let yielded!: () => void;
      const waiting = new Promise<void>((resolve) => {
        yielded = resolve;
      });
      clock.setTimeout = (callback, ms) => {
        let timer: unknown;
        timer = schedule(() => {
          active.delete(timer);
          callback();
        }, ms);
        active.add(timer);
        delays.push(ms);
        if (delays.length === 2) yielded();
        return timer;
      };
      clock.clearTimeout = (timer) => {
        active.delete(timer);
        cancel(timer);
      };
      let finished = false;
      const task = yield* spawn(function*() {
        const result = yield* importCredentialStream(f.protocol, f.reger, bytes, clock, input);
        finished = true;
        return result;
      });
      // The second timer is the first yield after a full ordinary sweep, even if it changed nothing.
      yield* call(() => waiting);
      assertEquals(delays, [expected, 1]);
      clock.advance(expected - 1);
      yield* call(() => Promise.resolve());
      assertEquals(finished, false);
      clock.advance(1);
      assertEquals(yield* task, { saved: [], complete: false, unaccepted: [f.creder.said!] });
      assertEquals(active.size, 0, "Deadline and sweep timers are joined/cancelled before returning");
    }
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      yield* call(() =>
        assertRejects(
          () =>
            run(() =>
              importCredentialStream(f.protocol, f.reger, new TextEncoder().encode("malformed"), systemClock, invalid)
            ),
          RangeError,
          "finite and positive",
        )
      );
    }
  });
});

Deno.test("finite import deadline joins a post-commit escrow handler and preserves acceptance", async () => {
  await run(function*() {
    const f = yield* fixture(), clock = new ManualRuntimeClock();
    let entered!: () => void, cancelling!: () => void, release!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      cancelling = resolve;
    });
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempts = 0, closed = false, returned = false, recovered = false;
    f.protocol.exc.addHandler({
      resource: "/import/settlement",
      verify(): ExchangeRouteVerification {
        return ++attempts === 1 ? { kind: "escrow", reason: "dependency pending" } : true;
      },
      *handle() {
        if (recovered) return;
        yield* ensure(function*() {
          cancelling();
          yield* call(() => cleanup);
          closed = true;
        });
        entered();
        yield* suspend();
      },
    });
    const msg = createExchangeMessage(f.issuer, { dest: f.holder.pre, route: "/import/settlement", payload: {} });
    const bytes = concatBytes(acceptedEventReplayMessage(f.source, f.issuer.pre, 0).message, msg.msg);
    const task = yield* spawn(function*() {
      const result = yield* importCredentialStream(f.protocol, f.reger, bytes, clock, 5);
      returned = true;
      return result;
    });
    yield* call(() => entry);
    clock.advance(5);
    yield* call(() => cancelled);
    assertEquals([closed, returned], [false, false]);
    release();
    assertEquals(yield* task, { saved: [], complete: true, unaccepted: [] });
    assertEquals([closed, returned], [true, true]);
    assertEquals(f.protocol.exc.complete(msg.serder.said!), true);
    // Cancellation joins effects but cannot undo acceptance; an explicit duplicate can run its handler again.
    recovered = true;
    for (const frame of parseBytes(msg.msg)) yield* f.protocol.dispatch(frame);
  });
});
