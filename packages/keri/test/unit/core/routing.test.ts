import { run } from "effection";
import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import {
  Dater,
  Diger,
  NumberPrimitive,
  Prefixer,
  SerderKERI,
} from "../../../../cesr/mod.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/identity/habbing.ts";
import { createProtocolProcessor } from "../../../src/app/protocol/protocol-processing.ts";
import { Reactor } from "../../../src/app/protocol/reactor.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { consoleLogger } from "../../../src/core/logger.ts";
import { Roles } from "../../../src/core/roles.ts";
import {
  BasicReplyRouteHandler,
  type ReplyPlan,
  type ReplyProcessDecision,
  type ReplyProofDecision,
  Revery,
  Router,
  unverifiedReplyDecision,
} from "../../../src/core/routing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../src/time/mod.ts";
import type { RegistryReplyDecision } from "../../../src/vdr/eventing.ts";
import { expectKind, routingTestApi, withPatchedMethod } from "../../private-access.ts";

// @ts-expect-error An accepted proof plan requires verified material and its prior-reply policy.
void ({ kind: "accept", escrows: [], cues: [] } satisfies ReplyPlan);

// Compile-time checks: dependency outcomes require their receiver's family;
// proof verification alone cannot claim a semantic dependency escrow.
// @ts-expect-error A dependency outcome must name its escrow family.
void ({ kind: "unverified", reason: "dependencyPending", message: "waiting" } satisfies RegistryReplyDecision);
void ({
  kind: "unverified",
  reason: "dependencyPending",
  // @ts-expect-error Registry TSN processing cannot return a credential escrow family.
  family: "credential-mae",
  message: "waiting",
} satisfies RegistryReplyDecision);
void ({
  kind: "unverified",
  // @ts-expect-error Proof verification cannot choose a semantic receiver's family.
  reason: "dependencyPending",
  family: "registry-mae",
  message: "waiting",
} satisfies ReplyProofDecision);

for (const route of ["/end/role", "/loc/scheme"] as const) {
  for (const transferable of [false, true]) {
    Deno.test(`endpoint reply replacement is atomic: ${route}, transferable=${transferable}`, async () => {
      await run(function*() {
        const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true });
        const cues = new Deck<AgentCue>();
        try {
          const hab = hby.makeHab("endpoint", undefined, { transferable, toad: 0 });
          const rvy = new Revery(hby.db, { cues });
          new BasicReplyRouteHandler(rvy).registerReplyRoutes();
          const body = (replacement: boolean) =>
            new SerderKERI({
              sad: {
                t: "rpy",
                dt: replacement ? "2026-10-13T00:00:00.000002+00:00" : "2026-10-13T00:00:00.000001+00:00",
                r: route === "/end/role" ? `/end/role/${replacement ? "cut" : "add"}` : route,
                a: route === "/end/role"
                  ? { cid: hab.pre, role: Roles.mailbox, eid: hab.pre }
                  : { eid: hab.pre, scheme: "http", url: replacement ? "http://after.test" : "http://before.test" },
              },
              makify: true,
            });
          const process = (serder: SerderKERI, pending = false) => {
            const group = (missing: boolean) =>
              new TransIdxSigGroup(
                new Prefixer({ qb64: hab.pre }),
                missing ? NumberPrimitive.fromNum(1n) : hab.kever!.sner,
                new Diger({ qb64: hab.kever!.said }),
                hab.sign(serder.raw, true),
              );
            return rvy.processReply({
              serder,
              ...(transferable
                ? { tsgs: pending ? [group(true), group(false)] : [group(false)] }
                : { cigars: hab.sign(serder.raw, false) }),
            });
          };
          const prior = body(false), incoming = body(true);
          const keys: [string, string, string] = [hab.pre, Roles.mailbox, hab.pre];
          const locKeys: [string, string] = [hab.pre, "http"];
          const pointer = () => route === "/end/role" ? hby.db.eans.get(keys) : hby.db.lans.get(locKeys);
          const projection = () => route === "/end/role" ? hby.db.ends.get(keys) : hby.db.locs.get(locKeys);
          assertEquals(process(prior).kind, "accept");
          const previousProjection = projection();
          const previousSignatures = [...hby.db.ssgs.getTopItemIter([prior.said!], { topive: true })];
          const previousCigars = hby.db.scgs.get([prior.said!]).map(([verfer, cigar]) => [verfer.qb64, cigar.qb64]);
          const unchanged = () => {
            assertEquals(pointer()?.qb64, prior.said);
            assertEquals(projection(), previousProjection);
            assertEquals(hby.db.rpys.get([prior.said!])?.said, prior.said);
            assertExists(hby.db.sdts.get([prior.said!]));
            assertEquals([...hby.db.ssgs.getTopItemIter([prior.said!], { topive: true })], previousSignatures);
            assertEquals(
              hby.db.scgs.get([prior.said!]).map(([verfer, cigar]) => [verfer.qb64, cigar.qb64]),
              previousCigars,
            );
            assertEquals(hby.db.rpys.get([incoming.said!]), null);
            assertEquals(hby.db.sdts.get([incoming.said!]), null);
            assertEquals([...hby.db.ssgs.getTopItemIter([incoming.said!], { topive: true })], []);
            assertEquals(hby.db.scgs.get([incoming.said!]), []);
            assertEquals(hby.db.rpes.get([route]), []);
            assertEquals(cues.length, 0);
          };
          const failure = new Error("projection write failed");
          const refuse = () => {
            throw failure;
          };
          const attempt = () => assertEquals(assertThrows(() => process(incoming, true)), failure);
          if (route === "/end/role") withPatchedMethod(hby.db.ends, "pin", refuse, attempt);
          else withPatchedMethod(hby.db.locs, "pin", refuse, attempt);
          unchanged();
          assertThrows(
            () => hby.db.env!.transactionSync(() => process(incoming, true)),
            Error,
            "must own the reply transaction",
          );
          unchanged();
          assertEquals(process(incoming, true).kind, "accept");
          assertEquals(pointer()?.qb64, incoming.said);
          assertEquals(
            projection()?.asDict(),
            route === "/end/role" ? { allowed: false } : { url: "http://after.test" },
          );
          assertEquals(hby.db.rpys.get([prior.said!]), null);
          assertEquals(hby.db.rpys.get([incoming.said!])?.said, incoming.said);
          assertEquals(cues.toArray().map((cue) => cue.kin), transferable ? ["query"] : []);
          cues.clear();
        } finally {
          cues.clear();
          yield* hby.close(true);
        }
      });
    });
  }
}

Deno.test("Router validates semantic reply outcomes returned by reflective handlers", () => {
  const serder = new SerderKERI({
    sad: { t: "rpy", dt: makeNowIso8601(), r: "/decision", a: {} },
    makify: true,
  });
  const diger = new Diger({ qb64: serder.said! });
  const dispatch = (outcome: unknown) => {
    const router = new Router();
    router.addRoute("/decision", { processReply: () => outcome });
    return router.dispatch({ serder, diger });
  };
  for (
    const invalid of [
      undefined,
      { kind: "unverified", message: "no reason" },
      { kind: "unverified", reason: "dependencyPending", message: "no family" },
      { kind: "unverified", reason: "dependencyPending", family: 1, message: "invalid family" },
      { kind: "unverified", reason: "proofPending", message: 1 },
      { kind: "unverified", reason: "unknown", message: "unknown reason" },
    ]
  ) {
    assertThrows(() => dispatch(invalid), TypeError, "valid reply decision");
  }
  const missingHandler = new Router();
  missingHandler.addRoute("/decision", {});
  assertThrows(() => missingHandler.dispatch({ serder, diger }), TypeError, "does not implement");
  for (
    const valid of [
      { kind: "accept" },
      unverifiedReplyDecision("not accepted"),
      { kind: "unverified", reason: "proofPending", message: "missing signatures" },
      { kind: "unverified", reason: "dependencyPending", family: "registry-mae", message: "missing signer" },
    ] satisfies ReplyProcessDecision[]
  ) {
    assertEquals(dispatch(valid), valid);
  }
});

function createEscrowedReplyFixture(
  hby: {
    db: Revery["db"];
    makeHab(
      name: string,
      transferable?: unknown,
      options?: {
        transferable: true;
        icount: number;
        isith: string;
        ncount: number;
        nsith: string;
        toad: number;
      },
    ): {
      pre: string;
      kever: { sner: TransIdxSigGroup["seqner"]; said: string } | null;
      sign: (ser: Uint8Array, indexed: true) => TransIdxSigGroup["sigers"];
    };
  },
  name: string,
  route: string,
) {
  const hab = hby.makeHab(name, undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  });
  const kever = hab.kever;
  assertExists(kever);

  const serder = new SerderKERI({
    sad: {
      t: "rpy",
      dt: makeNowIso8601(),
      r: route,
      a: { aid: hab.pre },
    },
    makify: true,
  });
  const saider = new Diger({ qb64: serder.said ?? "" });
  const replyVerifier = new Revery(hby.db);
  replyVerifier.escrowReply({
    serder,
    saider,
    dater: new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
    route,
    prefixer: new Prefixer({ qb64: hab.pre }),
    seqner: kever.sner,
    diger: new Diger({ qb64: kever.said }),
    sigers: hab.sign(serder.raw, true),
  });

  return { hab, kever, serder, saider, replyVerifier };
}

Deno.test("Revery.acceptReply aggregates weighted reply signatures until the threshold is met", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-weighted-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("weighted", undefined, {
        transferable: true,
        icount: 2,
        isith: ["1/2", "1/2"],
        ncount: 2,
        nsith: ["1/2", "1/2"],
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/weighted/reply",
          a: {
            aid: hab.pre,
          },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const sigers = hab.sign(serder.raw, true);
      const makeGroup = (groupSigs: typeof sigers) =>
        new TransIdxSigGroup(
          new Prefixer({ qb64: hab.pre }),
          kever.sner,
          new Diger({ qb64: kever.said }),
          groupSigs,
        );
      const replyVerifier = new Revery(hby.db);

      const firstDecision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/weighted/reply",
        aid: hab.pre,
        tsgs: [makeGroup([sigers[0]])],
      });
      assertEquals(firstDecision.kind, "unverified");
      assertEquals(
        hby.db.ssgs.get([saider.qb64, hab.pre, kever.sner.numh, kever.said])
          .length,
        1,
      );

      const secondDecision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/weighted/reply",
        aid: hab.pre,
        tsgs: [makeGroup([sigers[1]])],
      });
      assertEquals(secondDecision.kind, "accept");
      assertExists(hby.db.rpys.get([saider.qb64]));
      assertEquals(
        hby.db.ssgs.get([saider.qb64, hab.pre, kever.sner.numh, kever.said])
          .length,
        2,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery publishes ordered proof effects and preserves external escrow ownership", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `revery-cue-admission-${crypto.randomUUID()}`, temp: true });
    try {
      const hab = hby.makeHab("weighted", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2", toad: 0 });
      const kever = hab.kever!;
      const cues = new Deck<AgentCue>();
      const rvy = new Revery(hby.db, { cues });
      const body = (dt: string) =>
        new SerderKERI({ sad: { t: "rpy", dt, r: "/admission", a: { aid: hab.pre } }, makify: true });
      const group = (serder: SerderKERI, indices: number[], sn = kever.sner) =>
        new TransIdxSigGroup(
          new Prefixer({ qb64: hab.pre }),
          sn,
          new Diger({ qb64: kever.said }),
          indices.map((i) => hab.sign(serder.raw, true)[i]),
        );
      const prior = body("2026-10-13T00:00:00.000001+00:00");
      const priorSaid = new Diger({ qb64: prior.said! });
      assertEquals(
        rvy.acceptReply({
          serder: prior,
          saider: priorSaid,
          route: "/admission",
          aid: hab.pre,
          tsgs: [group(prior, [0, 1])],
        }).kind,
        "accept",
      );
      const serder = body("2026-10-13T00:00:00.000002+00:00");
      const saider = new Diger({ qb64: serder.said! });
      const args = {
        serder,
        saider,
        route: "/admission",
        aid: hab.pre,
        osaider: priorSaid,
        tsgs: [group(serder, [0]), group(serder, [0], NumberPrimitive.fromNum(1n)), group(serder, [1])],
      };
      const unchanged = () => {
        assertEquals(hby.db.rpys.get([saider.qb64]), null);
        assertEquals(hby.db.sdts.get([saider.qb64]), null);
        assertEquals([...hby.db.ssgs.getTopItemIter([saider.qb64], { topive: true })], []);
        assertEquals(hby.db.rpes.get([args.route]), []);
        assertExists(hby.db.rpys.get([priorSaid.qb64]));
        assertEquals(cues.length, 0);
      };
      // External escrow must not virtually aggregate proofs which its semantic owner has not published.
      const pending = expectKind(rvy.acceptReply({ ...args, externalEscrow: true }), "unverified");
      assertEquals(pending.reason, "proofPending");
      assertEquals(cues.toArray(), [{ kin: "query", pre: hab.pre, route: "logs", q: {} }]);
      cues.clear();
      unchanged();
      withPatchedMethod(hby.db.sdts, "pin", () => {
        throw new Error("proof publication failed");
      }, () => {
        assertThrows(() => rvy.acceptReply(args), Error, "proof publication failed");
      });
      unchanged();
      assertEquals(rvy.acceptReply({ ...args, retainPrevious: true }).kind, "accept");
      assertExists(hby.db.rpys.get([priorSaid.qb64]));
      assertEquals(hby.db.rpys.get([saider.qb64])?.said, serder.said);
      assertEquals(
        hby.db.ssgs.get([saider.qb64, hab.pre, kever.sner.numh, kever.said]).length,
        2,
        "staged signatures aggregate in input order",
      );
      assertEquals(cues.length, 1, "three proof groups need only one actual query slot");
      assertEquals(cues.pull()?.kin, "query");
      const latest = body("2026-10-13T00:00:00.000003+00:00");
      assertEquals(
        rvy.acceptReply({
          serder: latest,
          saider: new Diger({ qb64: latest.said! }),
          route: args.route,
          aid: hab.pre,
          osaider: saider,
          tsgs: [group(latest, [0, 1])],
        }).kind,
        "accept",
      );
      assertEquals(hby.db.rpys.get([saider.qb64]), null, "default BADA supersession removes previous proof");
      assertEquals(cues.length, 0, "complete proof needs no query cue");
      const preparedBody = body("2026-10-13T00:00:00.000004+00:00");
      const plan = rvy.decideReply({
        serder: preparedBody,
        saider: new Diger({ qb64: preparedBody.said! }),
        route: args.route,
        aid: hab.pre,
        tsgs: [group(preparedBody, [0, 1])],
      });
      const accepted = expectKind(plan, "accept");
      assertEquals(accepted.accepted.kind, "transferable");
      assertEquals([plan.cues.length, plan.escrows.length], [0, 0]);
      assertEquals(hby.db.rpys.get([preparedBody.said!]), null, "evaluation does not persist proof");
      rvy.writeReply(plan);
      assertEquals(hby.db.rpys.get([preparedBody.said!])?.said, preparedBody.said);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.acceptReply verifies non-transferable ECDSA reply cigars via verifier dispatch", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-ecdsa-nontrans-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("nontrans-r1", undefined, {
        transferable: false,
        icode: "Q",
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/ecdsa/nontrans",
          a: { aid: hab.pre },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const cigars = hab.sign(serder.raw, false);
      const replyVerifier = new Revery(hby.db);

      const decision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/ecdsa/nontrans",
        aid: hab.pre,
        cigars: [cigars[0]],
      });

      assertEquals(decision.kind, "accept");
      assertExists(hby.db.rpys.get([saider.qb64]));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.acceptReply still rejects non-transferable replies whose authorizing AID does not match the verifier", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-ecdsa-mismatch-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("nontrans-r1", undefined, {
        transferable: false,
        icode: "Q",
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/ecdsa/mismatch",
          a: { aid: hab.pre },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const cigars = hab.sign(serder.raw, false);
      const replyVerifier = new Revery(hby.db);

      const decision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/ecdsa/mismatch",
        aid: "BAD-AID",
        cigars: [cigars[0]],
      });

      assertEquals(decision.kind, "unverified");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.acceptReply verifies transferable ECDSA reply signature groups via establishment verfers", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-ecdsa-trans-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("trans-k1", undefined, {
        transferable: true,
        icode: "J",
        icount: 1,
        isith: "1",
        ncode: "J",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/ecdsa/trans",
          a: { aid: hab.pre },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const sigers = hab.sign(serder.raw, true);
      const replyVerifier = new Revery(hby.db);

      const decision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/ecdsa/trans",
        aid: hab.pre,
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: hab.pre }),
            kever.sner,
            new Diger({ qb64: kever.said }),
            sigers,
          ),
        ],
      });

      assertEquals(decision.kind, "accept");
      assertExists(hby.db.rpys.get([saider.qb64]));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery retains valid partial proof and accepts later escrow signatures", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true });
    try {
      const hab = hby.makeHab("endpoint", undefined, { icount: 3, isith: "3", ncount: 3, nsith: "3", toad: 0 });
      const kever = hab.kever!;
      const rvy = new Revery(hby.db);
      new BasicReplyRouteHandler(rvy).registerReplyRoutes();
      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/loc/scheme",
          a: { eid: hab.pre, scheme: "http", url: "http://endpoint.test" },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said! });
      const sigers = hab.sign(serder.raw, true);
      const proof = {
        serder,
        saider,
        dater: new Dater({ qb64: encodeDateTimeToDater(serder.ked!.dt as string) }),
        route: "/loc/scheme",
        prefixer: new Prefixer({ qb64: hab.pre }),
        seqner: kever.sner,
        diger: new Diger({ qb64: kever.said }),
        sigers,
      };
      // The persisted proof has one valid and one invalid signature. Validation
      // retains only the verified signature, but the three-signature threshold
      // still blocks acceptance; later signatures must complete the same proof.
      rvy.escrowReply({ ...proof, sigers: [sigers[0], hab.sign(new TextEncoder().encode("other body"), true)[1]] });
      rvy.processEscrowReply();
      assertEquals(hby.db.rpes.get([proof.route]).map((diger) => diger.qb64), [saider.qb64]);

      const key = [saider.qb64, hab.pre, kever.sner.numh, kever.said];
      assertEquals(hby.db.ssgs.get(key).map((siger) => siger.qb64), [sigers[0].qb64]);
      hby.db.ssgs.put(key, sigers.slice(1));
      rvy.processEscrowReply();
      assertEquals(hby.db.locs.get([hab.pre, "http"])?.url, "http://endpoint.test");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.processEscrowReply keeps replies on recoverable unverified replay decisions", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-escrow-keep-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const { replyVerifier, saider } = createEscrowedReplyFixture(
        hby,
        "reply-keep",
        "/escrow/reply",
      );
      replyVerifier.rtr.addRoute("/escrow/reply", {
        processReply() {
          return unverifiedReplyDecision("retry later");
        },
      });
      withPatchedMethod(consoleLogger, "warn", () => {
        throw new Error("A recoverable reply must not report an escrow ejection.");
      }, () => replyVerifier.processEscrowReply());

      assertEquals(hby.db.rpes.get(["/escrow/reply"]).length, 1);
      assertExists(hby.db.rpys.get([saider.qb64]));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.processEscrowReply drops malformed escrow artifacts and removes stored reply state", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-escrow-drop-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const { replyVerifier, saider } = createEscrowedReplyFixture(
        hby,
        "reply-drop",
        "/escrow/reply",
      );

      hby.db.rpys.rem([saider.qb64]);
      let warnings = 0;
      withPatchedMethod(consoleLogger, "warn", (message) => {
        warnings++;
        assertStringIncludes(message, saider.qb64);
        assertStringIncludes(message, "/escrow/reply");
        assertStringIncludes(message, "missingEscrowArtifact");
        assertEquals(hby.db.rpes.get(["/escrow/reply"]), []);
        assertEquals(hby.db.sdts.get([saider.qb64]), null);
      }, () => replyVerifier.processEscrowReply());
      assertEquals(warnings, 1);

      assertEquals(hby.db.rpes.get(["/escrow/reply"]).length, 0);
      assertEquals(hby.db.rpys.get([saider.qb64]), null);
      assertEquals(hby.db.sdts.get([saider.qb64]), null);
      assertEquals(hby.db.ssgs.get([saider.qb64]).length, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery escrow replay reports expected validation ejections with the original cause", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-escrow-processing-detail-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const { replyVerifier, saider } = createEscrowedReplyFixture(
        hby,
        "reply-detail",
        "/escrow/reply/detail",
      );
      const fault = new ValidationError("invalid reply evidence");
      replyVerifier.rtr.addRoute("/escrow/reply/detail", {
        processReply() {
          throw fault;
        },
      });
      const decision = routingTestApi(replyVerifier).reprocessEscrowedReply(
        saider,
      );

      const drop = expectKind(decision, "drop");
      assertEquals(drop.reason, "processingError");
      assertEquals(drop.message, `invalid reply evidence (said=${saider.qb64}, route=/escrow/reply/detail)`);
      assertEquals(drop.cause, fault);
      let warnings = 0;
      withPatchedMethod(consoleLogger, "warn", (message, cause) => {
        warnings++;
        assertStringIncludes(message, saider.qb64);
        assertStringIncludes(message, fault.message);
        assertEquals(cause, fault);
        assertEquals(hby.db.rpes.get(["/escrow/reply/detail"]), []);
        assertEquals(hby.db.rpys.get([saider.qb64]), null);
      }, () => replyVerifier.processEscrowReply());
      assertEquals(warnings, 1);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery escrow replay preserves unexpected failures and evidence without reporting an ejection", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true });
    try {
      const { replyVerifier, saider } = createEscrowedReplyFixture(hby, "reply-failure", "/escrow/failure");
      let failure: Error = new Error("storage failed");
      replyVerifier.rtr.addRoute("/escrow/failure", {
        processReply() {
          throw failure;
        },
      });
      withPatchedMethod(consoleLogger, "warn", () => {
        throw new Error("An unsuccessful removal must not report an escrow ejection.");
      }, () => {
        for (const error of [failure, new TypeError("handler contract failed")]) {
          failure = error;
          assertEquals(assertThrows(() => replyVerifier.processEscrowReply()), failure);
          assertEquals(hby.db.rpes.get(["/escrow/failure"]).map((value) => value.qb64), [saider.qb64]);
          assertExists(hby.db.rpys.get([saider.qb64]));
          assertExists(hby.db.sdts.get([saider.qb64]));
        }
        // Expected validation can remove the row, but a failed storage write
        // still owns its original exception and must leave the pending evidence.
        failure = new ValidationError("invalid evidence");
        const storageFailure = new Error("escrow removal failed");
        withPatchedMethod(hby.db.rpes, "rem", () => {
          throw storageFailure;
        }, () => assertEquals(assertThrows(() => replyVerifier.processEscrowReply()), storageFailure));
        assertEquals(hby.db.rpes.get(["/escrow/failure"]).map((value) => value.qb64), [saider.qb64]);
        assertExists(hby.db.rpys.get([saider.qb64]));
      });
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery BADA retains microsecond ordering for signed replies", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true });
    try {
      const hab = hby.makeHab("nontrans", undefined, { transferable: false });
      const verifier = new Revery(hby.db);
      let prior: Diger | undefined;
      const attempt = (dt: string) => {
        const serder = new SerderKERI({ sad: { t: "rpy", dt, r: "/microseconds", a: { aid: hab.pre } }, makify: true });
        const saider = new Diger({ qb64: serder.said! });
        const result = verifier.acceptReply({
          serder,
          saider,
          route: "/microseconds",
          aid: hab.pre,
          osaider: prior,
          cigars: hab.sign(serder.raw, false),
        });
        if (result.kind === "accept") prior = saider;
        return result.kind;
      };
      assertEquals(attempt("2026-10-13T00:00:00.000001+00:00"), "accept");
      assertEquals(attempt("2026-10-13T00:00:00.000002+00:00"), "accept");
      assertEquals(attempt("2026-10-13T00:00:00.000001+00:00"), "unverified");
      assertEquals(attempt("2026-10-13T00:00:00.000002+00:00"), "unverified");
      assertEquals(attempt("2026-10-13T01:00:00.000003+01:00"), "accept");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("reply escrow retains stored signatures until the signer establishment event arrives", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: `reply-source-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const target = yield* createHabery({ name: `reply-target-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const signer = source.makeHab("signer", undefined, { transferable: true });
      const protocol = createProtocolProcessor(target);
      const input = new Reactor(protocol);
      yield* input.processBytes(signer.makeLocScheme("http://signer.test", signer.pre, "http"));
      assertEquals(target.db.rpes.cnt(), 1);
      protocol.rvy.processEscrowReply();
      assertEquals(target.db.rpes.cnt(), 1, "missing signer state must retain the stored signature group");
      assertEquals(target.db.locs.get([signer.pre, "http"]), null);
      yield* input.processBytes(acceptedEventReplayMessage(source, signer.pre, 0).message);
      protocol.rvy.processEscrowReply();
      assertEquals(target.db.rpes.cnt(), 0);
      assertEquals(target.db.locs.get([signer.pre, "http"])?.url, "http://signer.test");
    } finally {
      yield* target.close();
      yield* source.close();
    }
  });
});
