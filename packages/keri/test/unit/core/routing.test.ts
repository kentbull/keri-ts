import { run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import {
  Dater,
  Diger,
  NumberPrimitive,
  Prefixer,
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  SerderKERI,
} from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import { DeckFullError } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { ValidationError } from "../../../src/core/errors.ts";
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
import type { RegistryReplyDecision } from "../../../src/vdr/registry-tsn.ts";
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
  // @ts-expect-error A registry receiver cannot return a credential escrow family.
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
        const resources = new ResourcePolicy();
        const cues = new CueDeck(resources, 4);
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
            assertEquals([cues.length, resources.used.bytes], [0, 0]);
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
          assertEquals(resources.used.bytes, 0);
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
    assertThrows(() => dispatch(invalid), ValidationError, "valid reply decision");
  }
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

Deno.test("Revery holds the exact query batch before ordered proof effects and preserves external ownership", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `revery-cue-admission-${crypto.randomUUID()}`, temp: true });
    try {
      const hab = hby.makeHab("weighted", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2", toad: 0 });
      const kever = hab.kever!;
      const resources = new ResourcePolicy();
      const cues = new CueDeck(resources, 1);
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
      const occupied = expectKind(resources.reserve({ bytes: resources.limits.bytes }), "reserve");
      assertEquals(assertThrows(() => rvy.acceptReply(args), ResourceAdmissionError).reason, "busy");
      occupied.reservation.release();
      unchanged();
      assertEquals(
        assertThrows(
          () => new Revery(hby.db, { cues: new CueDeck(new ResourcePolicy({ bytes: 1 })) }).acceptReply(args),
          ResourceAdmissionError,
        ).reason,
        "limit",
      );
      unchanged();
      const slot = cues.prepare([{ kin: "proof", said: "active" }]);
      assertThrows(() => rvy.acceptReply(args), DeckFullError);
      slot.release();
      unchanged();
      assertThrows(
        () => new Revery(hby.db, { cues, maxReplyGroups: 2 }).acceptReply(args),
        ResourceLimitError,
        "work limit",
      );
      unchanged();
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
      assertEquals(resources.used.bytes, 0);
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
      const owner = cues.takeOwned()!;
      const retained = resources.used.bytes;
      cues.clear();
      assertEquals(resources.used.bytes, retained);
      owner.release();
      assertEquals(resources.used.bytes, 0);
      const latest = body("2026-10-13T00:00:00.000003+00:00");
      cues.capacity = 0;
      const allBytes = expectKind(resources.reserve({ bytes: resources.limits.bytes }), "reserve");
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
      allBytes.reservation.release();
      assertEquals(hby.db.rpys.get([saider.qb64]), null, "default BADA supersession removes previous proof");
      assertEquals([cues.length, resources.used.bytes], [0, 0], "cue-free acceptance needs no cue credit");
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
      replyVerifier.processEscrowReply();

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
      replyVerifier.processEscrowReply();

      assertEquals(hby.db.rpes.get(["/escrow/reply"]).length, 0);
      assertEquals(hby.db.rpys.get([saider.qb64]), null);
      assertEquals(hby.db.sdts.get([saider.qb64]), null);
      assertEquals(hby.db.ssgs.get([saider.qb64]).length, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery escrow replay preserves processing error detail on drop decisions", async () => {
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
      let fault: Error = new Error("boom");
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
      assertEquals(drop.message, `boom (said=${saider.qb64}, route=/escrow/reply/detail)`);
      fault = new ResourceAdmissionError("query bytes occupied", "busy");
      assertThrows(() => replyVerifier.processEscrowReply(), ResourceAdmissionError);
      assertEquals(hby.db.rpes.get(["/escrow/reply/detail"]).length, 1);
      assertExists(hby.db.rpys.get([saider.qb64]));
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
