import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { b, Diger, Prefixer, Siger, Texter, Vrsn_1_0, Vrsn_2_0 } from "../../../../../cesr/mod.ts";
import { Exchanger, type ExchangeRouteHandler } from "../../../../src/app/exchanges/exchanging.ts";
import {
  CHALLENGE_RESPONSE_ROUTE,
  findVerifiedChallengeResponse,
  loadChallengeHandlers,
} from "../../../../src/app/identity/challenging.ts";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { createAgentRuntime, settleRuntimeIngress } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { consoleLogger } from "../../../../src/core/logger.ts";
import { exchange as exchangeMessage } from "../../../../src/core/protocol-exchanging.ts";
import { EndpointRoles } from "../../../../src/core/roles.ts";

function makeExchangeSerder(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  return exchangeMessage(route, payload, args)[0];
}

Deno.test("exchange mirrors KERIpy v1 recipient projection rules and changes SAIDs accordingly", () => {
  const recipient = "EBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const sender = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const withRecipient = exchangeMessage(
    "/test",
    { words: ["able", "baker"] },
    {
      sender,
      recipient,
      stamp: "2026-04-10T00:00:00.000000+00:00",
    },
  )[0];
  const withoutRecipient = exchangeMessage(
    "/test",
    { words: ["able", "baker"] },
    {
      sender,
      stamp: "2026-04-10T00:00:00.000000+00:00",
    },
  )[0];

  assertEquals(withRecipient.ked?.rp, recipient);
  assertEquals(
    Object.keys(withRecipient.ked ?? {}),
    ["v", "t", "d", "i", "rp", "p", "dt", "r", "q", "a", "e"],
  );
  assertEquals(
    Object.keys((withRecipient.ked?.a as Record<string, unknown>) ?? {}),
    ["i", "words"],
  );
  assertEquals(
    (withRecipient.ked?.a as Record<string, unknown>)["i"],
    recipient,
  );
  assertEquals(withoutRecipient.ked?.rp, "");
  assertEquals(
    Object.keys(withoutRecipient.ked ?? {}),
    ["v", "t", "d", "i", "rp", "p", "dt", "r", "q", "a", "e"],
  );
  assertEquals(
    Object.keys((withoutRecipient.ked?.a as Record<string, unknown>) ?? {}),
    ["words"],
  );
  assertEquals(
    (withoutRecipient.ked?.a as Record<string, unknown>)["i"],
    undefined,
  );
  assertEquals(withRecipient.said === withoutRecipient.said, false);
});

Deno.test("Exchanger accepts signed challenge responses and records exchange state", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `exchange-accept-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        sender.makeLocScheme("http://127.0.0.1:9001"),
        sender.makeEndRole(sender.pre, EndpointRoles.controller, true),
        recipient.makeLocScheme("http://127.0.0.1:9002"),
        recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true),
      ]);

      const exchanger = new Exchanger(hby);
      loadChallengeHandlers(hby.db, exchanger);
      const serder = makeExchangeSerder(
        CHALLENGE_RESPONSE_ROUTE,
        { i: recipient.pre, words: ["baba", "coco"] },
        { sender: sender.pre, recipient: recipient.pre },
      );
      const sigers = sender.sign(serder.raw, true);
      const decision = yield* call(() =>
        exchanger.processEvent({
          serder,
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: sender.pre }),
              sender.kever!.sner,
              new Diger({ qb64: sender.kever!.said }),
              sigers,
            ),
          ],
        })
      );

      const said = serder.said;
      assertExists(said);
      assertEquals(decision.kind, "accept");
      assertEquals(hby.db.exns.get([said])?.said, said);
      assertEquals(
        hby.db.reps.get([sender.pre]).some((diger) => diger.qb64 === said),
        true,
      );
      assertEquals(
        [...hby.db.esigs.getTopItemIter([said, ""])].length > 0,
        true,
      );
      assertEquals(findVerifiedChallengeResponse(hby.db, sender.pre, ["baba", "coco"])?.said, said);
      assertEquals(findVerifiedChallengeResponse(hby.db, sender.pre, ["wrong"]), null);
      assertEquals(hby.db.reps.get([recipient.pre]).length, 0, "payload i cannot select the authenticated responder");
      for (const payload of [{}, { words: null }, { words: "baba coco" }, { words: ["baba", 7] }]) {
        const malformed = makeExchangeSerder(CHALLENGE_RESPONSE_ROUTE, payload, {
          sender: sender.pre,
          recipient: recipient.pre,
        });
        const rejected = yield* exchanger.processEvent({
          serder: malformed,
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: sender.pre }),
              sender.kever!.sner,
              new Diger({ qb64: sender.kever!.said }),
              sender.sign(malformed.raw, true),
            ),
          ],
        });
        assertEquals(rejected.kind, "reject");
        assertEquals(hby.db.exns.get([malformed.said!]), null);
      }
      assertEquals(hby.db.reps.get([sender.pre]).length, 1);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Exchanger replays partial-signature escrows once the missing signatures arrive", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `exchange-escrow-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 2,
        isith: "2",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        sender.makeLocScheme("http://127.0.0.1:9011"),
        sender.makeEndRole(sender.pre, EndpointRoles.controller, true),
        recipient.makeLocScheme("http://127.0.0.1:9012"),
        recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true),
      ]);

      const exchanger = new Exchanger(hby);
      loadChallengeHandlers(hby.db, exchanger);
      const serder = makeExchangeSerder(
        "/challenge/response",
        { i: sender.pre, words: ["dede", "fifi"] },
        { sender: sender.pre, recipient: recipient.pre },
      );
      const sigers = sender.sign(serder.raw, true);
      const group = new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sigers,
      );

      const initial = yield* call(() =>
        exchanger.processEvent({
          serder,
          tsgs: [
            new TransIdxSigGroup(group.prefixer, group.seqner, group.diger, [
              sigers[0],
            ]),
          ],
        })
      );
      const said = serder.said;
      assertExists(said);
      assertEquals(initial.kind, "escrow");
      assertExists(hby.db.epse.get([said]));

      const quadKey = [said, group.pre, group.snh, group.said] as const;
      hby.db.esigs.add(quadKey, sigers[1]);
      yield* call(() => exchanger.processEscrows());

      assertEquals(hby.db.epse.get([said]), null);
      assertEquals(hby.db.exns.get([said])?.said, said);
      assertEquals(
        hby.db.reps.get([sender.pre]).some((diger) => diger.qb64 === said),
        true,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Exchanger retains the authenticated group lead after member and group rotation", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `exchange-lead-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const alice = hby.makeHab("alice");
      const bob = hby.makeHab("bob");
      const members = [alice.pre, bob.pre];
      const group = hby.makeGroupHab("group", bob, members, members, undefined, { isith: "1", nsith: "1" });
      assertEquals(group.hab.accepted, true);
      const exchanger = new Exchanger(hby);
      const serder = makeExchangeSerder("/test/lead", {}, { sender: group.hab.pre, recipient: alice.pre });
      const signature = bob.sign(serder.raw, true)[0];
      const proof = (index: number) =>
        new TransIdxSigGroup(
          new Prefixer({ qb64: group.hab.pre }),
          group.serder.sner!,
          new Diger({ qb64: group.serder.said! }),
          [new Siger({ code: signature.code, raw: signature.raw, index })],
        );
      // Bob's signature cannot authenticate Alice's lower index, but ordinary partial escrow retains it.
      assertEquals((yield* exchanger.processEvent({ serder, tsgs: [proof(0)] })).kind, "escrow");
      assertEquals(exchanger.lead(group.hab, serder.said!), false, "Incomplete evidence must not elect a sender");
      assertEquals((yield* exchanger.processEvent({ serder, tsgs: [proof(1)] })).kind, "accept");
      assertEquals(exchanger.complete(serder.said!), true);
      assertEquals(exchanger.lead(group.hab, serder.said!), true, "Only the valid contribution selects the lead");
      const pending = hby.makeGroupHab("pending", bob, members, members, undefined, { isith: "2", nsith: "2" });
      const incomplete = makeExchangeSerder("/test/lead", {}, { sender: pending.hab.pre, recipient: alice.pre });
      const partial = bob.sign(incomplete.raw, true)[0];
      assertEquals(
        (yield* exchanger.processEvent({
          serder: incomplete,
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: pending.hab.pre }),
              pending.serder.sner!,
              new Diger({ qb64: pending.serder.said! }),
              [new Siger({ code: partial.code, raw: partial.raw, index: 1 })],
            ),
          ],
        })).kind,
        "escrow",
      );
      assertEquals(
        exchanger.lead(pending.hab, incomplete.said!),
        false,
        "A valid partial signer is not an elected sender",
      );
      bob.rotate();
      assertEquals(
        exchanger.lead(group.hab, serder.said!),
        true,
        "Historical approval belongs to the same member after rotation",
      );
      const rotation = hby.rotateGroupHab("group", [bob.pre, alice.pre], members, { isith: "1", nsith: "1" });
      assertEquals(rotation.hab.kever!.said, rotation.serder.said);
      assertEquals(
        exchanger.lead(group.hab, serder.said!),
        true,
        "Current group index order cannot reinterpret an older proof",
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Exchanger accepts nested weighted threshold combinations from partial escrow", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `exchange-nested-escrow-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 3,
        isith: [{ "1": ["1/2", "1/2"] }, "1"],
        ncount: 3,
        nsith: [{ "1": ["1/2", "1/2"] }, "1"],
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        sender.makeLocScheme("http://127.0.0.1:9021"),
        sender.makeEndRole(sender.pre, EndpointRoles.controller, true),
        recipient.makeLocScheme("http://127.0.0.1:9022"),
        recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true),
      ]);

      const exchanger = new Exchanger(hby);
      loadChallengeHandlers(hby.db, exchanger);
      const serder = makeExchangeSerder(
        "/challenge/response",
        { i: sender.pre, words: ["gaga", "haha"] },
        { sender: sender.pre, recipient: recipient.pre },
      );
      const sigers = sender.sign(serder.raw, true);
      const group = new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sigers,
      );

      const initial = yield* call(() =>
        exchanger.processEvent({
          serder,
          tsgs: [
            new TransIdxSigGroup(group.prefixer, group.seqner, group.diger, [
              sigers[0],
            ]),
          ],
        })
      );
      const said = serder.said;
      assertExists(said);
      assertEquals(initial.kind, "escrow");
      assertExists(hby.db.epse.get([said]));

      const quadKey = [said, group.pre, group.snh, group.said] as const;
      hby.db.esigs.add(quadKey, sigers[1]);
      yield* call(() => exchanger.processEscrows());

      assertEquals(hby.db.epse.get([said]), null);
      assertEquals(hby.db.exns.get([said])?.said, said);
      assertEquals(
        [...hby.db.esigs.getTopItemIter([said, ""])].map(([, siger]) => siger.index),
        [0, 1],
      );
      assertEquals(exchanger.lead(sender, said), true);

      const alternate = makeExchangeSerder(
        "/challenge/response",
        { i: sender.pre, words: ["jaja", "kaka"] },
        { sender: sender.pre, recipient: recipient.pre },
      );
      const alternateSigers = sender.sign(alternate.raw, true);
      const accepted = yield* call(() =>
        exchanger.processEvent({
          serder: alternate,
          tsgs: [
            new TransIdxSigGroup(group.prefixer, group.seqner, group.diger, [
              alternateSigers[2],
            ]),
          ],
        })
      );
      assertExists(alternate.said);
      assertEquals(accepted.kind, "accept");
      assertEquals(hby.db.exns.get([alternate.said])?.said, alternate.said);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Exchanger verifies an ESSR string digest before accepting payload state", async () => {
  await run(function*() {
    // Isolated real LMDB state proves rejection occurs before accepted storage writes.
    const hby = yield* createHabery({ name: `essr-digest-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      // A current transferable signer makes payload integrity the remaining acceptance gate.
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      // The commitment covers concatenated raw fragments rather than Texter qualification.
      const digest = new Diger({ raw: Diger.digest(b("abcxyz"), "E"), code: "E" });
      // A string-valued a field exercises the ESSR commitment form of an exchange.
      const serder = exchangeMessage("/essr", {}, { sender: sender.pre, diger: digest })[0];
      // Real signatures establish sender authorization independently of payload correctness.
      const tsgs = [
        new TransIdxSigGroup(
          new Prefixer({ qb64: sender.pre }),
          sender.kever!.sner,
          new Diger({ qb64: sender.kever!.said }),
          sender.sign(serder.raw, true),
        ),
      ];
      // Separate fragments make order and completeness observable without a giant fixture.
      const essrs = ["abc", "xyz"].map((text) => new Texter({ raw: b(text), code: "4B" }));
      const exchanger = new Exchanger(hby);
      // This projection intentionally distinguishes string ESSR seals from array-valued seals.
      assertEquals(serder.a, digest.qb64);
      assertEquals(serder.seals, []);
      for (const parts of [[], [essrs[0]], [...essrs].reverse()]) {
        assertEquals((yield* exchanger.processEvent({ serder, tsgs, essrs: parts })).kind, "reject");
        assertEquals(hby.db.exns.get([serder.said!]), null);
        assertEquals(hby.db.getEssrs(serder.said!), null);
      }
      // Concatenation order is semantic even though fragment boundaries are not hashed.
      assertEquals((yield* exchanger.processEvent({ serder, tsgs, essrs })).kind, "accept");
      assertEquals(hby.db.exns.get([serder.said!])?.said, serder.said);
      assertEquals(hby.db.getEssrs(serder.said!)!.map((item) => item.text), ["abc", "xyz"]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("missing schemas preserve EXN evidence and one absolute deadline through reopen and retry", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const warn = consoleLogger.warn, warnings: unknown[][] = [];
    consoleLogger.warn = (...args) => {
      warnings.push(args);
    };
    let now = Date.parse("2026-10-13T01:00:00.000000+00:00"), calls = 0, handled = 0;
    const first = new Diger({ raw: Diger.digest(b("schema one"), "E"), code: "E" }).qb64;
    const second = new Diger({ raw: Diger.digest(b("schema two"), "E"), code: "E" }).qb64;
    let missing: string | undefined = first, proof = false;
    try {
      const sender = hby.makeHab("sender");
      const serder = exchangeMessage("/ipex/grant", {}, { sender: sender.pre, version: Vrsn_2_0 })[0];
      const child = exchangeMessage("/child", {}, { sender: sender.pre, version: Vrsn_2_0 })[0];
      const said = serder.said!;
      const handlers: ExchangeRouteHandler[] = [{
        resource: "/ipex/grant",
        acceptsNests: true,
        verify({ nests, mailboxAid }) {
          calls++;
          assertEquals(nests?.map((node) => node.body.raw), [child.raw], `schema verification ${calls}`);
          assertEquals(mailboxAid, sender.pre);
          if (proof) return { kind: "escrow" as const, reason: "missing proof" };
          return missing ? { kind: "escrow" as const, reason: "missing schema", schema: missing } : true;
        },
        handle() {
          handled++;
        },
      }];
      let exchanger = new Exchanger(hby, { handlers, now: () => now });
      const tsgs = [
        new TransIdxSigGroup(
          new Prefixer({ qb64: sender.pre }),
          sender.kever!.sner,
          new Diger({ qb64: sender.kever!.said }),
          sender.sign(serder.raw, true),
        ),
      ];
      const input = { serder, tsgs, nests: [{ body: child, attachments: [] }], mailboxAid: sender.pre };
      // Missing schema is never consulted before independent sender authentication.
      yield* exchanger.processEvent({ ...input, tsgs: [] });
      assertEquals(calls, 0);
      assertEquals(hby.db.emse!.get([said, first]), null);
      assertEquals((yield* exchanger.processEvent(input)).kind, "escrow");
      const deadline = hby.db.emsd!.get([said])!.dts;
      assertEquals(deadline, "2026-10-13T01:00:20.000000+00:00");
      yield* exchanger.processEvent(input);
      assertEquals([...exchanger.cues].filter((cue) => cue.kin === "query"), [{
        kin: "query",
        q: { r: "schema", said: first },
      }]);
      assertEquals(hby.db.epse.get([said]), null);
      assertEquals([...hby.db.esigs.getTopItemIter([said, ""])].length, 1);
      assertEquals(hby.db.exns.get([said]), null);
      yield* hby.db.close();
      yield* hby.db.reopen({ reuse: true });
      exchanger = new Exchanger(hby, { handlers, now: () => now });
      now += 10_000;
      proof = true;
      yield* exchanger.processEscrows();
      assertExists(hby.db.epse.get([said]));
      assertEquals(hby.db.emsd!.get([said])!.dts, deadline, "proof migration keeps the absolute schema deadline");
      proof = false;
      missing = second;
      yield* exchanger.processEscrows();
      assertEquals(hby.db.emse!.get([said, first]), null);
      assertExists(hby.db.emse!.get([said, second]));
      assertEquals(hby.db.emsd!.get([said])!.dts, deadline);
      assertEquals([...exchanger.cues].filter((cue) => cue.kin === "query"), [{
        kin: "query",
        q: { r: "schema", said: second },
      }]);
      now += 10_000;
      yield* exchanger.processEscrows();
      assertExists(hby.db.emse!.get([said, second]), "deadline equality remains eligible");
      missing = undefined;
      yield* exchanger.processEscrows();
      assertEquals(handled, 1);
      assertExists(hby.db.exns.get([said]));
      assertEquals(hby.db.emsd!.get([said]), null);
      assertEquals([...hby.db.emse!.getTopItemIter([said])], []);
      assertEquals([...hby.db.esigs.getTopItemIter([said, ""])].length, 1, "accepted proofs survive cleanup");
      assertEquals(warnings, [], "pending work, migration and accepted cleanup are not ejections");
      // Expiry is strict, terminal, and releases the stored nested evidence.
      missing = first;
      const expired = exchangeMessage("/ipex/grant", { expired: true }, { sender: sender.pre, version: Vrsn_2_0 })[0];
      const expiredInput = {
        ...input,
        serder: expired,
        tsgs: [new TransIdxSigGroup(tsgs[0].prefixer, tsgs[0].seqner, tsgs[0].diger, sender.sign(expired.raw, true))],
      };
      yield* exchanger.processEvent(expiredInput);
      now += 19_000;
      proof = true;
      yield* exchanger.processEscrows();
      assertExists(hby.db.epse.get([expired.said!]));
      now += 1_001;
      consoleLogger.warn = (...args) => {
        assertEquals(hby.db.epse.get([expired.said!]), null);
        assertEquals(hby.db.enst.get([expired.said!]), [], "report expiry only after evidence cleanup");
        warnings.push(args);
      };
      yield* exchanger.processEscrows();
      assertEquals(hby.db.emsd!.get([expired.said!]), null);
      assertEquals(hby.db.enst.get([expired.said!]), []);
      assertEquals([...hby.db.esigs.getTopItemIter([expired.said!, ""])], []);
      assertEquals(handled, 1);
      assertEquals(warnings, [["Exchanger ejected exchange escrow", {
        family: "epse",
        said: expired.said,
        pre: sender.pre,
        route: "/ipex/grant",
        reason: "expired",
        detail: "Exchange dependency exceeded its pending lifetime or absolute schema deadline.",
      }]]);
      proof = false;
      const lifetime =
        exchangeMessage("/ipex/grant", { lifetime: true }, { sender: sender.pre, version: Vrsn_2_0, xid: first })[0];
      const cacheKey = [sender.pre, first, lifetime.said!];
      hby.db.tmsc.pin(cacheKey, { xdt: "2026-10-13T01:00:00.000123+00:00", pxl: 25_000 });
      const lifetimeInput = {
        ...input,
        serder: lifetime,
        tsgs: [new TransIdxSigGroup(tsgs[0].prefixer, tsgs[0].seqner, tsgs[0].diger, sender.sign(lifetime.raw, true))],
      };
      yield* exchanger.processEvent(lifetimeInput);
      assertEquals(hby.db.emsd!.get([lifetime.said!])!.dts, "2026-10-13T01:00:25.000123+00:00");
      const get = hby.db.emsd!.get.bind(hby.db.emsd);
      hby.db.emsd!.get = () => {
        throw new Error("schema deadline storage unavailable");
      };
      try {
        yield* call(() =>
          assertRejects(() => run(() => exchanger.processEvent(lifetimeInput)), Error, "storage unavailable")
        );
      } finally {
        hby.db.emsd!.get = get;
      }
      assertExists(hby.db.emse!.get([lifetime.said!, first]));
      // Corrupt durable deadlines propagate and retain retry evidence instead of becoming ordinary expiry.
      hby.db.emsd!.rem([lifetime.said!]);
      yield* call(() =>
        assertRejects(() => run(() => exchanger.processEscrows()), Error, "Corrupt missing-schema deadline.")
      );
      assertExists(hby.db.emse!.get([lifetime.said!, first]));
      assertEquals(warnings.length, 1, "storage and corruption failures do not report an ejection");
    } finally {
      consoleLogger.warn = warn;
      yield* hby.close(true);
    }
  });
});
