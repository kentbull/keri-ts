import { concatBytes } from "cesr-ts";
import { type Operation, run, sleep } from "effection";
import { assert, assertEquals, assertInstanceOf, assertStringIncludes } from "jsr:@std/assert";
import { Verifier } from "../../../../src/app/credentials/verifying.ts";
import type { PosterEvent, PosterOutcome } from "../../../../src/app/delivery/forwarding.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { ipexExchangeStatus } from "../../../../src/app/ipex/ipex-conversation.ts";
import {
  type IpexGrantDeps,
  sendIpexAdmit,
  sendIpexGrant,
  settleGrantCredential,
} from "../../../../src/app/ipex/ipex-granting.ts";
import { loadIpexHandlers } from "../../../../src/app/ipex/ipexing.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { Revery } from "../../../../src/core/routing.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import { createReger } from "../../../../src/db/lmdb-stores.ts";
import type { Reger } from "../../../../src/db/reger.ts";
import { Credentialer, Regery } from "../../../../src/vdr/credentialing.ts";
import { Tevery } from "../../../../src/vdr/eventing.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";

const schemaSed = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["v", "d", "i", "ri", "s", "a"],
  properties: {
    v: { type: "string" },
    d: { type: "string" },
    i: { type: "string" },
    ri: { type: "string" },
    s: { type: "string" },
    a: { type: "object", required: ["i", "role"], properties: { i: { type: "string" }, role: { type: "string" } } },
  },
};

interface Party {
  hby: Habery;
  reger: Reger;
  hab: Hab;
  reactor: Reactor;
  deps: IpexGrantDeps;
  /** Everything the party handed to its Poster, as `[kind, dest, messages]`. */
  posted: Array<[string, string, Uint8Array[]]>;
  changes: MemoryChangeSink;
}

function* party(name: string, schemer: Schemer, fail?: Error): Operation<Party> {
  const hby = yield* createHabery({ name: `${name}-${crypto.randomUUID()}`, temp: true, skipConfig: true });
  const reger = yield* createReger({ name: `${name}-${crypto.randomUUID()}`, temp: true });
  const hab = hby.makeHab(name, undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  });
  hby.db.schema.pin(schemer.said, schemer);
  const revery = new Revery(hby.db);
  const tevery = new Tevery({ db: hby.db, reger, rvy: revery });
  const verifier = new Verifier(hby, { reger });
  const protocol = protocolFixture(hby, { revery, tevery, verifier });
  loadIpexHandlers(hby, protocol.exc);
  const posted: Party["posted"] = [];
  const outcome = (evt: PosterEvent) =>
    (fail
      ? { kin: "failed", evt, deliveries: [], error: fail }
      : { kin: "sent", evt, deliveries: ["http://peer.test/"] }) as unknown as PosterOutcome;
  const postman = {
    send: (evt: { dest: string; msg: Uint8Array }) => (posted.push(["send", evt.dest, [evt.msg]]), evt),
    sendStream: (evt: { dest: string; msgs: Uint8Array[] }) => (posted.push(["stream", evt.dest, evt.msgs]), evt),
    *wait(evt: PosterEvent) {
      return outcome(evt);
    },
  } as unknown as IpexGrantDeps["postman"];
  const changes = new MemoryChangeSink();
  const reactor = new Reactor(protocol);
  return { hby, reger, hab, reactor, deps: { hby, reactor, protocol, postman, reger, changes }, posted, changes };
}

function* close(...parties: Party[]): Operation<void> {
  for (const p of parties) {
    yield* p.reger.close(true);
    yield* p.hby.close(true);
  }
}

/** Issue a credential to the holder, then deliver the issuer's KEL/TEL support to the holder as a peer would. */
function* issuedGrantWorld(use: (world: { issuer: Party; holder: Party; credential: string }) => Operation<void>) {
  const schemer = new Schemer({ sed: schemaSed });
  const issuer = yield* party("issuer", schemer);
  const holder = yield* party("holder", schemer);
  try {
    const rgy = new Regery(issuer.hby, {
      reger: issuer.reger,
      tvy: issuer.deps.protocol.tvy!,
      vry: issuer.deps.protocol.vry!,
    });
    const registry = rgy.makeRegistry("issuer-reg", issuer.hab);
    const credentialer = new Credentialer(issuer.hby, { reger: issuer.reger, vry: issuer.deps.protocol.vry! });
    const creder = credentialer.create({
      registry,
      schema: schemer.said,
      recipient: holder.hab.pre,
      data: { role: "holder" },
    });
    credentialer.issue(registry, creder);
    yield* use({ issuer, holder, credential: creder.said! });
  } finally {
    yield* close(issuer, holder);
  }
}

/** The holder receives every message the issuer posted, in order. */
function* deliver(to: Party, messages: Uint8Array[]): Operation<void> {
  for (const message of messages) yield* to.reactor.processBytes(message);
  yield* to.deps.protocol.processEscrowsOnce();
}

function* refused(op: () => Operation<unknown>, text: string): Operation<void> {
  let caught: unknown;
  try {
    yield* op();
  } catch (error) {
    caught = error;
  }
  assertInstanceOf(caught, ValidationError);
  assertStringIncludes(caught.message, text);
}

Deno.test("grant, settle and admit run a v1 credential end to end and a second admit is refused", async () => {
  await run(function*() {
    yield* issuedGrantWorld(function*({ issuer, holder, credential }) {
      const sent = yield* sendIpexGrant(issuer.deps, issuer.hab, {
        recipient: holder.hab.pre,
        credential,
        message: "here",
      });
      assertEquals(sent.grant.route, "/ipex/grant");
      assertEquals(sent.credential, credential);
      assertEquals(sent.deliveries, ["http://peer.test/"]);
      assert(sent.support.length > 0);
      assertEquals(issuer.posted.length, 1);
      const [kind, dest, messages] = issuer.posted[0]!;
      assertEquals([kind, dest], ["stream", holder.hab.pre]);
      assertEquals(concatBytes(...messages), concatBytes(...sent.support, sent.wire), "support precedes the grant");
      assertEquals(issuer.changes.changes, [{ kind: "ipex", id: sent.grant.said! }]);
      assertEquals(ipexExchangeStatus(issuer.deps, sent.grant.said!), {
        state: "awaiting-reply",
        route: "/ipex/grant",
        credential: { said: credential, saved: true },
      });

      // Holder: grant arrives, not yet saved; settle saves the credential and is idempotent.
      yield* deliver(holder, messages);
      assertEquals(ipexExchangeStatus(holder.deps, sent.grant.said!), {
        state: "awaiting-reply",
        route: "/ipex/grant",
        credential: { said: credential, saved: false },
      });
      const settled = yield* settleGrantCredential(holder.deps, holder.hab.pre, sent.grant.said!);
      assertEquals(settled, {
        state: "awaiting-reply",
        route: "/ipex/grant",
        credential: { said: credential, saved: true },
      });
      assertEquals(
        yield* settleGrantCredential(holder.deps, holder.hab.pre, sent.grant.said!),
        settled,
        "settling a saved credential changes nothing",
      );

      const admit = yield* sendIpexAdmit(holder.deps, holder.hab, sent.grant.said!, { message: "thanks" });
      assertEquals(admit.admit.route, "/ipex/admit");
      assertEquals(admit.admit.ked?.p, sent.grant.said);
      assertEquals([admit.credential, admit.saved], [credential, true]);
      assertEquals(holder.posted.map(([kind, to]) => [kind, to]), [["stream", issuer.hab.pre]]);
      assertEquals(holder.posted[0]![2], [admit.wire]);
      assertEquals(ipexExchangeStatus(holder.deps, sent.grant.said!).state, "replied");

      // Re-running admit is refused and neither signs nor sends again.
      yield* refused(
        () => sendIpexAdmit(holder.deps, holder.hab, sent.grant.said!),
        "already has an accepted response; resume the existing exchange.",
      );
      assertEquals(holder.posted.length, 1);

      // The granter observes the admit.
      const inception = holder.hby.db.cloneEvtMsg(holder.hab.pre, 0, holder.hby.db.kels.getLast(holder.hab.pre, 0)!);
      yield* deliver(issuer, [inception, admit.wire]);
      const status = ipexExchangeStatus(issuer.deps, sent.grant.said!);
      assertEquals(status.state === "replied" && status.reply.route, "/ipex/admit");
    });
  });
});

Deno.test("granting the same credential again without an agree authors another grant", async () => {
  await run(function*() {
    yield* issuedGrantWorld(function*({ issuer, holder, credential }) {
      const first = yield* sendIpexGrant(issuer.deps, issuer.hab, { recipient: holder.hab.pre, credential });
      yield* sleep(2);
      const second = yield* sendIpexGrant(issuer.deps, issuer.hab, { recipient: holder.hab.pre, credential });
      assert(first.grant.said !== second.grant.said);
      assertEquals(issuer.posted.length, 2);
    });
  });
});

Deno.test("deliver false authors and accepts locally but leaves the bytes to the caller", async () => {
  await run(function*() {
    yield* issuedGrantWorld(function*({ issuer, holder, credential }) {
      const sent = yield* sendIpexGrant(issuer.deps, issuer.hab, {
        recipient: holder.hab.pre,
        credential,
        deliver: false,
      });
      assertEquals(sent.deliveries, []);
      assertEquals(issuer.posted.length, 0);
      assert(issuer.hby.db.exns.get([sent.grant.said!]));

      yield* deliver(holder, [...sent.support, sent.wire]);
      const admit = yield* sendIpexAdmit(holder.deps, holder.hab, sent.grant.said!, {
        requireSaved: false,
        deliver: false,
      });
      assertEquals([admit.saved, admit.deliveries, holder.posted.length], [false, [], 0]);
    });
  });
});

Deno.test("admit refuses an unsaved credential unless saving is not required, and refuses unknown grants and senders", async () => {
  await run(function*() {
    yield* issuedGrantWorld(function*({ issuer, holder, credential }) {
      const sent = yield* sendIpexGrant(issuer.deps, issuer.hab, { recipient: holder.hab.pre, credential });
      yield* deliver(holder, [...sent.support, sent.wire]);

      yield* refused(() => sendIpexAdmit(holder.deps, holder.hab, sent.grant.said!), "is not saved locally");
      yield* refused(() => sendIpexAdmit(holder.deps, holder.hab, "Eunknown"), "not stored as accepted");
      yield* refused(() => sendIpexAdmit(holder.deps, issuer.hab, sent.grant.said!), "No local AID found for sender");
      yield* refused(
        () => sendIpexAdmit(issuer.deps, issuer.hab, sent.grant.said!),
        "response parties do not match",
      );
      yield* refused(
        () => sendIpexGrant(holder.deps, issuer.hab, { recipient: holder.hab.pre, credential }),
        "No local AID found for sender",
      );
      yield* refused(
        () => sendIpexGrant(issuer.deps, issuer.hab, { recipient: holder.hab.pre, credential, agree: "Eunknown" }),
        "Prior IPEX exchange is not accepted.",
      );
      assertEquals(holder.posted.length, 0);
      assertEquals(issuer.posted.length, 1);
    });
  });
});

Deno.test("settleGrantCredential refuses a grant that is not stored or not addressed to the holder", async () => {
  await run(function*() {
    yield* issuedGrantWorld(function*({ issuer, holder, credential }) {
      const sent = yield* sendIpexGrant(issuer.deps, issuer.hab, { recipient: holder.hab.pre, credential });
      yield* refused(
        () => settleGrantCredential(holder.deps, holder.hab.pre, sent.grant.said!),
        "not stored as accepted",
      );
      yield* deliver(holder, [...sent.support, sent.wire]);
      yield* refused(
        () => settleGrantCredential(holder.deps, issuer.hab.pre, sent.grant.said!),
        "does not match the admitting identifier",
      );
    });
  });
});

Deno.test("a failed grant delivery throws and leaves the accepted grant stored", async () => {
  await run(function*() {
    const schemer = new Schemer({ sed: schemaSed });
    const failing = new Error("endpoint refused");
    const issuer = yield* party("issuer", schemer, failing);
    const holder = yield* party("holder", schemer);
    try {
      const rgy = new Regery(issuer.hby, {
        reger: issuer.reger,
        tvy: issuer.deps.protocol.tvy!,
        vry: issuer.deps.protocol.vry!,
      });
      const registry = rgy.makeRegistry("issuer-reg", issuer.hab);
      const credentialer = new Credentialer(issuer.hby, { reger: issuer.reger, vry: issuer.deps.protocol.vry! });
      const creder = credentialer.create({
        registry,
        schema: schemer.said,
        recipient: holder.hab.pre,
        data: { role: "holder" },
      });
      credentialer.issue(registry, creder);
      let caught: unknown;
      try {
        yield* sendIpexGrant(issuer.deps, issuer.hab, { recipient: holder.hab.pre, credential: creder.said! });
      } catch (error) {
        caught = error;
      }
      assertEquals(caught, failing);
      assertEquals([...issuer.hby.db.exns.getTopItemIter()].length, 1);
    } finally {
      yield* close(issuer, holder);
    }
  });
});
