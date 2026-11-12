import { SerderACDC, type SerderKERI } from "cesr-ts";
import { type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertInstanceOf, assertStringIncludes } from "jsr:@std/assert";
import type { PosterEvent, PosterOutcome } from "../../../../src/app/delivery/forwarding.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  ipexExchangeStatus,
  type IpexSendDeps,
  type IpexStatusDeps,
  sendIpexAgree,
  sendIpexApply,
  sendIpexOffer,
  sendIpexSpurn,
  waitForIpexExchange,
} from "../../../../src/app/ipex/ipex-conversation.ts";
import { loadIpexHandlers } from "../../../../src/app/ipex/ipexing.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";

interface Posted {
  kind: "send" | "stream";
  dest: string;
  topic: string;
  msg: Uint8Array;
}

/** Records what the library hands to the Poster and answers with a scripted outcome. */
function fakePostman(fail?: Error) {
  const posted: Posted[] = [];
  const postman = {
    send(evt: { dest: string; topic: string; msg: Uint8Array }) {
      posted.push({ kind: "send", dest: evt.dest, topic: evt.topic, msg: evt.msg });
      return evt as unknown as PosterEvent;
    },
    sendStream(evt: { dest: string; topic: string; msgs: Uint8Array[] }) {
      posted.push({ kind: "stream", dest: evt.dest, topic: evt.topic, msg: evt.msgs[0]! });
      return evt as unknown as PosterEvent;
    },
    *wait(evt: PosterEvent): Operation<PosterOutcome> {
      return fail
        ? { kin: "failed", evt, deliveries: [], error: fail }
        : { kin: "sent", evt, deliveries: ["http://peer.test/"] } as unknown as PosterOutcome;
    },
  };
  return { posted, postman: postman as unknown as IpexSendDeps["postman"] };
}

/** Two local single-signature AIDs in one Habery stand in for the two parties. */
function* withParties(
  use: (ctx: {
    hby: Habery;
    alice: Hab;
    bob: Hab;
    deps: IpexSendDeps;
    posted: Posted[];
    changes: MemoryChangeSink;
  }) => Operation<void>,
  fail?: Error,
): Operation<void> {
  const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  try {
    const protocol = protocolFixture(hby);
    loadIpexHandlers(hby, protocol.exc);
    const { posted, postman } = fakePostman(fail);
    const changes = new MemoryChangeSink();
    const alice = hby.makeHab("alice", undefined, {});
    const bob = hby.makeHab("bob", undefined, {});
    yield* use({
      hby,
      alice,
      bob,
      deps: { hby, reactor: new Reactor(protocol), protocol, postman, changes },
      posted,
      changes,
    });
  } finally {
    yield* hby.close(true);
  }
}

const statusDeps = (hby: Habery): IpexStatusDeps => ({ hby, reger: { saved: { get: () => undefined } } as never });

function acdcBytes(pre: string): Uint8Array {
  return new SerderACDC({
    sad: { v: "ACDC10JSON000000_", d: "", i: pre, s: pre, a: { i: pre } },
    makify: true,
  }).raw;
}

Deno.test("apply, offer and agree each sign one exchange, send it, and move the conversation status", async () => {
  await run(function*() {
    yield* withParties(function*({ hby, alice, bob, deps, posted, changes }) {
      const apply = yield* sendIpexApply(deps, bob, { recipient: alice.pre, schema: bob.pre, message: "please" });
      assertEquals(apply.exn.route, "/ipex/apply");
      assertEquals(apply.exn.ked?.a, { m: "please", s: bob.pre, a: {}, i: alice.pre });
      assertEquals(apply.deliveries, ["http://peer.test/"]);
      assertEquals(posted.length, 1);
      assertEquals([posted[0]!.kind, posted[0]!.dest], ["send", alice.pre]);
      assertEquals(hby.db.exns.get([apply.exn.said!])?.said, apply.exn.said);
      assertEquals(ipexExchangeStatus(statusDeps(hby), apply.exn.said!), {
        state: "awaiting-reply",
        route: "/ipex/apply",
      });

      const offer = yield* sendIpexOffer(deps, alice, {
        recipient: bob.pre,
        apply: apply.exn.said!,
        acdc: acdcBytes(alice.pre),
      });
      assertEquals(offer.exn.route, "/ipex/offer");
      assertEquals(offer.exn.ked?.p, apply.exn.said);
      assertEquals(ipexExchangeStatus(statusDeps(hby), apply.exn.said!), {
        state: "replied",
        route: "/ipex/apply",
        reply: { said: offer.exn.said!, route: "/ipex/offer" },
      });

      const agree = yield* sendIpexAgree(deps, bob, { recipient: alice.pre, offer: offer.exn.said! });
      assertEquals(agree.exn.route, "/ipex/agree");
      assertEquals(agree.exn.ked?.p, offer.exn.said);
      assertEquals(posted.length, 3);
      assertEquals(
        changes.changes.map((change) => change.id),
        [
          apply.exn.said,
          apply.exn.said,
          offer.exn.said,
          offer.exn.said,
          agree.exn.said,
        ],
        "each exchange and the prior it answered are published after local acceptance",
      );
    });
  });
});

Deno.test("spurn goes out as a one-message stream", async () => {
  await run(function*() {
    yield* withParties(function*({ hby, alice, bob, deps, posted }) {
      const apply = yield* sendIpexApply(deps, bob, { recipient: alice.pre, schema: bob.pre });
      const spurn = yield* sendIpexSpurn(deps, alice, { recipient: bob.pre, prior: apply.exn.said!, message: "no" });
      assertEquals(spurn.exn.route, "/ipex/spurn");
      assertEquals(spurn.deliveries, ["http://peer.test/"]);
      assertEquals(posted.map((p) => p.kind), ["send", "stream"]);
      assertEquals(ipexExchangeStatus(statusDeps(hby), apply.exn.said!).state, "replied");
    });
  });
});

/** Run `op` and require a ValidationError containing `text`. */
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

Deno.test("each response verb refuses a missing, wrongly routed, mismatched or answered prior before signing", async () => {
  await run(function*() {
    yield* withParties(function*({ hby, alice, bob, deps, posted }) {
      const apply = yield* sendIpexApply(deps, bob, { recipient: alice.pre, schema: bob.pre });
      const before = posted.length;
      const acdc = acdcBytes(alice.pre);

      yield* refused(
        () => sendIpexOffer(deps, alice, { recipient: bob.pre, apply: "Eunknown", acdc }),
        "Prior IPEX exchange is not accepted.",
      );
      yield* refused(
        () => sendIpexAgree(deps, alice, { recipient: bob.pre, offer: apply.exn.said! }),
        "missing or has the wrong route",
      );
      yield* refused(
        () => sendIpexSpurn(deps, alice, { recipient: alice.pre, prior: apply.exn.said! }),
        "response parties do not match",
      );
      yield* refused(
        () => sendIpexOffer(deps, bob, { recipient: alice.pre, apply: apply.exn.said!, acdc }),
        "response parties do not match",
      );
      assertEquals(posted.length, before, "a refused prior sends nothing");

      yield* sendIpexSpurn(deps, alice, { recipient: bob.pre, prior: apply.exn.said! });
      yield* refused(
        () => sendIpexSpurn(deps, alice, { recipient: bob.pre, prior: apply.exn.said! }),
        "already has an accepted response; resume the existing exchange.",
      );
      yield* refused(
        () => sendIpexOffer(deps, alice, { recipient: bob.pre, apply: apply.exn.said!, acdc }),
        "already has an accepted response",
      );
      assertEquals(posted.length, before + 1, "answering twice does not sign or send again");
      assert(hby.db.erpy.get([apply.exn.said!]));
    });
  });
});

Deno.test("an unknown or group sender is refused before anything is signed or sent", async () => {
  await run(function*() {
    yield* withParties(function*({ alice, deps, posted }) {
      const other = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const stranger = other.makeHab("stranger", undefined, {});
        yield* refused(
          () => sendIpexApply(deps, stranger, { recipient: alice.pre, schema: alice.pre }),
          "No local AID found for sender",
        );
        assertEquals(posted.length, 0);
        assertEquals([...deps.hby.db.exns.getTopItemIter()].length, 0);
      } finally {
        yield* other.close(true);
      }
    });
  });
});

Deno.test("apply is not idempotent: sending it twice authors two distinct applies", async () => {
  await run(function*() {
    yield* withParties(function*({ hby, alice, bob, deps, posted }) {
      const first = yield* sendIpexApply(deps, bob, { recipient: alice.pre, schema: bob.pre });
      yield* sleep(2);
      const second = yield* sendIpexApply(deps, bob, { recipient: alice.pre, schema: bob.pre });
      assert(first.exn.said !== second.exn.said);
      assertEquals(posted.length, 2);
      assertEquals([...hby.db.exns.getTopItemIter()].length, 2);
    });
  });
});

Deno.test("a failed delivery throws its error and leaves the accepted exchange stored", async () => {
  await run(function*() {
    const refusal = new Error("endpoint refused");
    yield* withParties(function*({ hby, alice, bob, deps }) {
      let caught: unknown;
      try {
        yield* sendIpexApply(deps, bob, { recipient: alice.pre, schema: bob.pre });
      } catch (error) {
        caught = error;
      }
      assertEquals(caught, refusal);
      assertEquals([...hby.db.exns.getTopItemIter()].length, 1);
    }, refusal);
  });
});

/** Durable-state fake: only the stores the status read touches. */
function fakeStores() {
  const exns = new Map<string, SerderKERI>();
  const erpy = new Map<string, { qb64: string }>();
  const saved = new Set<string>();
  const deps = {
    hby: {
      db: { exns: { get: ([said]: string[]) => exns.get(said) }, erpy: { get: ([said]: string[]) => erpy.get(said) } },
    },
    reger: { saved: { get: ([said]: string[]) => saved.has(said) ? true : undefined } },
  } as unknown as IpexStatusDeps;
  const add = (said: string, route: string, extra: object = {}) =>
    exns.set(said, { said, route, ked: {}, ...extra } as unknown as SerderKERI);
  return { deps, add, erpy, saved };
}

Deno.test("status is unknown, awaiting-reply or replied, and a grant reports its credential", () => {
  const { deps, add, erpy, saved } = fakeStores();
  assertEquals(ipexExchangeStatus(deps, "Egrant"), { state: "unknown" });
  add("Egrant", "/ipex/grant", { ked: { e: { acdc: { d: "Ecred" } } } });
  assertEquals(ipexExchangeStatus(deps, "Egrant"), {
    state: "awaiting-reply",
    route: "/ipex/grant",
    credential: { said: "Ecred", saved: false },
  });
  saved.add("Ecred");
  erpy.set("Egrant", { qb64: "Eadmit" });
  add("Eadmit", "/ipex/admit");
  assertEquals(ipexExchangeStatus(deps, "Egrant"), {
    state: "replied",
    route: "/ipex/grant",
    reply: { said: "Eadmit", route: "/ipex/admit" },
    credential: { said: "Ecred", saved: true },
  });
});

Deno.test("waitForIpexExchange only observes: a timeout is a value and the host's own work settles it", async () => {
  const { deps, add, erpy, saved } = fakeStores();
  add("Egrant", "/ipex/grant", { ked: { e: { acdc: { d: "Ecred" } } } });
  // The wait receives stores only: it has no Poster, reactor or runtime to start.
  const timedOut = await run(() => waitForIpexExchange(deps, "Egrant", { timeoutMs: 30, pollMs: 5 }));
  assertEquals(timedOut.outcome, "timed-out");
  assertEquals(timedOut.status.state, "awaiting-reply");
  assertEquals(timedOut.outcome === "timed-out" && timedOut.timeoutMs, 30);

  const replied = await run(function*() {
    yield* spawn(function*() {
      yield* sleep(10);
      erpy.set("Egrant", { qb64: "Eadmit" });
    });
    return yield* waitForIpexExchange(deps, "Egrant", { timeoutMs: 1000, pollMs: 5 });
  });
  assertEquals(replied.outcome, "settled");
  assertEquals(replied.status.state, "replied");

  const credential = await run(function*() {
    yield* spawn(function*() {
      yield* sleep(10);
      saved.add("Ecred");
    });
    return yield* waitForIpexExchange(deps, "Egrant", { timeoutMs: 1000, pollMs: 5, until: "credential-saved" });
  });
  assertEquals(credential.outcome, "settled");
  assertEquals(await run(() => waitForIpexExchange(deps, "Eunknown", { timeoutMs: 0 })), {
    outcome: "timed-out",
    status: { state: "unknown" },
    timeoutMs: 0,
  });
});
