import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { b, Diger, essrPayload, Prefixer, Texter, Vrsn_1_0 } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { loadChallengeHandlers } from "../../../src/app/challenging.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";

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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      yield* call(() => ingestKeriBytes(runtime, sender.makeLocScheme("http://127.0.0.1:9001")));
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          sender.makeEndRole(sender.pre, EndpointRoles.controller, true),
        )
      );
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          recipient.makeLocScheme("http://127.0.0.1:9002"),
        )
      );
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true),
        )
      );
      yield* processRuntimeTurn(runtime, { hab: sender });

      const exchanger = new Exchanger(hby);
      loadChallengeHandlers(hby.db, exchanger);
      const serder = makeExchangeSerder(
        "/challenge/response",
        { i: sender.pre, words: ["baba", "coco"] },
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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      yield* call(() => ingestKeriBytes(runtime, sender.makeLocScheme("http://127.0.0.1:9011")));
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          sender.makeEndRole(sender.pre, EndpointRoles.controller, true),
        )
      );
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          recipient.makeLocScheme("http://127.0.0.1:9012"),
        )
      );
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true),
        )
      );
      yield* processRuntimeTurn(runtime, { hab: sender });

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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      yield* call(() => ingestKeriBytes(runtime, sender.makeLocScheme("http://127.0.0.1:9021")));
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          sender.makeEndRole(sender.pre, EndpointRoles.controller, true),
        )
      );
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          recipient.makeLocScheme("http://127.0.0.1:9022"),
        )
      );
      yield* call(() =>
        ingestKeriBytes(
          runtime,
          recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true),
        )
      );
      yield* processRuntimeTurn(runtime, { hab: sender });

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
      /** Tiny resident fixture exposes the same canonical wire contract as streamed ingress. */
      const payload = (parts: Texter[]) =>
        essrPayload(
          {
            size: parts.reduce((size, part) => size + part.qb64.length, 0),
            /** Keep fragment order observable to the signed concatenated-byte commitment. */
            async *open() {
              for (const part of parts) yield part.qb64b;
            },
            /** This fixture borrows resident primitives and owns no external resource. */
            async discard() {},
          },
          parts.length,
          parts.reduce((size, part) => size + part.raw.length, 0),
          Vrsn_1_0,
        );
      const exchanger = new Exchanger(hby);
      // This projection intentionally distinguishes string ESSR seals from array-valued seals.
      assertEquals(serder.a, digest.qb64);
      assertEquals(serder.seals, []);
      for (const parts of [[], [essrs[0]], [...essrs].reverse()]) {
        assertEquals((yield* exchanger.processEvent({ serder, tsgs, essr: payload(parts) })).kind, "reject");
        assertEquals(hby.db.exns.get([serder.said!]), null);
        assertEquals(hby.db.essrs.get([serder.said!]), []);
      }
      // Concatenation order is semantic even though fragment boundaries are not hashed.
      assertEquals((yield* exchanger.processEvent({ serder, tsgs, essr: payload(essrs) })).kind, "accept");
      assertEquals(hby.db.exns.get([serder.said!])?.said, serder.said);
      assertEquals(hby.db.essrs.get([serder.said!]).map((item) => item.text), ["abc", "xyz"]);
    } finally {
      yield* hby.close(true);
    }
  });
});
