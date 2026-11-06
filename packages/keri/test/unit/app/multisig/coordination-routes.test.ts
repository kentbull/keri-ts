/** Core `/multisig/qry` and `/multisig/ipex-proof` routes and shared child handlers (KERIpy #149). */
import { type CesrFrame, Diger, Kinds, parseBytes, Prefixer, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, ensure, run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { type ExchangeInput, Exchanger, type ExchangeRouteHandler } from "../../../../src/app/exchanges/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import {
  loadMultisigHandlers,
  MULTISIG_IPEX_PROOF_ROUTE,
  MULTISIG_QRY_ROUTE,
  MULTISIG_ROUTES,
  multisigIpexProofExn,
  MultisigNotificationHandler,
  multisigQueryExn,
} from "../../../../src/app/multisig/grouping.ts";
import { Notifier, openNoterForHabery } from "../../../../src/app/notifications/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { query } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";

/** Sign one wrapper body with its sender's accepted establishment keys. */
function proof(sender: Hab, serder: SerderKERI): TransIdxSigGroup[] {
  const establishment = sender.db.getEvtSerder(sender.pre, sender.kever!.lastEst.d)!;
  return [
    new TransIdxSigGroup(
      new Prefixer({ qb64: sender.pre }),
      establishment.sner!,
      new Diger({ qb64: establishment.said! }),
      sender.sign(serder.raw, true),
    ),
  ];
}

/** A v2 wrapper with explicit attributes and children, signed by `sender`. */
function wrapper(sender: Hab, route: string, attrs: Record<string, unknown>, children: CesrFrame[]): ExchangeInput {
  const serder = exchange(route, attrs, { sender: sender.pre, pvrsn: Vrsn_2_0, gvrsn: Vrsn_2_0 })[0];
  return { serder, nests: children, tsgs: proof(sender, serder) };
}

/** Admit every public KEL in `source` into `target`. */
function* learn(target: Habery, source: Habery, pre: string) {
  for (const wire of source.db.clonePreIter(pre, 0)) {
    yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0], true), target.rvy, target.kevery);
  }
}

interface Coordination {
  left: Habery;
  alice: Hab;
  bob: Hab;
  stranger: Hab;
  group: Hab;
  notifier: Notifier;
  /** Group-authored v2 query endorsed by Bob's group habitat. */
  qry: Uint8Array;
  /** Group-authored v2 Grant endorsed by Bob's group habitat. */
  grant: Uint8Array;
  /** Bob's own v2 query, not authored by the group. */
  memberQry: Uint8Array;
}

/** Two independent member stores holding one accepted two-member group. */
async function coordination(test: (ctx: Coordination) => Promise<void>) {
  await run(function*() {
    const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => left.close(true));
    const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => right.close(true));
    const noter = yield* openNoterForHabery(left);
    yield* ensure(() => noter.close(true));
    const alice = left.makeHab("alice"), bob = right.makeHab("bob"), stranger = left.makeHab("stranger");
    yield* learn(left, right, bob.pre);
    yield* learn(right, left, alice.pre);
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const inception = parseBytes(messagize(local.serder, {
      sigers: [...local.sigers, ...remote.sigers],
      gvrsn: Vrsn_2_0,
    }))[0];
    for (const hby of [left, right]) {
      yield* dispatchEnvelope(envelopeFromFrame(inception, true), hby.rvy, hby.kevery);
    }
    const group = remote.hab;
    const dhQuery = (pre: string) =>
      query("/ipex/dhke", { x: pre }, { pre, replyRoute: "/ipex/dhke", pvrsn: Vrsn_2_0, kind: Kinds.json });
    const grant = exchange("/ipex/grant", { m: "" }, { sender: group.pre, recipient: alice.pre, pvrsn: Vrsn_2_0 })[0];
    yield* call(() =>
      test({
        left,
        alice,
        bob,
        stranger,
        group,
        notifier: new Notifier(left.signator!, { noter }),
        qry: group.endorse(dhQuery(group.pre), { gvrsn: Vrsn_2_0 }),
        grant: group.endorse(grant, { gvrsn: Vrsn_2_0 }),
        memberQry: bob.endorse(dhQuery(bob.pre), { gvrsn: Vrsn_2_0 }),
      })
    );
  });
}

for (const route of [MULTISIG_QRY_ROUTE, MULTISIG_IPEX_PROOF_ROUTE] as const) {
  Deno.test(`core Multiplexor indexes and notifies ${route} without replay`, async () => {
    await coordination(async ({ left, bob, group, notifier, qry, grant }) => {
      const exchanger = new Exchanger(left);
      loadMultisigHandlers(left, exchanger, { notifier });
      assertEquals(MULTISIG_ROUTES.includes(route), true);
      assertEquals(exchanger.routes.get(route) instanceof MultisigNotificationHandler, true);
      const raw = route === MULTISIG_QRY_ROUTE ? qry : grant, field = route === MULTISIG_QRY_ROUTE ? "qry" : "grant";
      const [serder, payload] = await run(() =>
        route === MULTISIG_QRY_ROUTE ? multisigQueryExn(group, bob, raw) : multisigIpexProofExn(group, bob, raw)
      );
      const child = parseBytes(raw)[0];
      assertEquals(serder.route, route);
      assertEquals(serder.pre, bob.pre);
      assertEquals(serder.sad!.a, { gid: group.pre, [field]: child.body.said });
      assertEquals(payload.length > 0, true);
      const decision = await run(() =>
        exchanger.processEvent({ serder, nests: [child], tsgs: proof(bob, serder), gvrsn: Vrsn_2_0 })
      );
      assertEquals(decision.kind, "accept");
      // Indexed and noticed like every other proposal; never replayed by the mux.
      assertEquals(notifier.list().length, 1);
      assertEquals(left.db.meids.get([child.body.said!]).map(d => d.qb64), [serder.said]);
      assertEquals(left.db.maids.get([child.body.said!]).map(p => p.qb64), [bob.pre]);
      assertEquals(left.db.enst.get([serder.said!]).length, 1);
    });
  });
}

Deno.test("core coordination routes refuse malformed children and non-member senders", async () => {
  await coordination(async ({ left, bob, stranger, group, notifier, qry, grant, memberQry }) => {
    const exchanger = new Exchanger(left);
    const mux = loadMultisigHandlers(left, exchanger, { notifier });
    const [q, g, m] = [qry, grant, memberQry].map(raw => parseBytes(raw)[0]);
    const check = (input: ExchangeInput) => mux.verify(input.serder, input.nests);
    assertEquals(check(wrapper(bob, MULTISIG_QRY_ROUTE, { gid: group.pre, qry: q.body.said }, [q])), true);
    assertEquals(
      check(wrapper(bob, MULTISIG_IPEX_PROOF_ROUTE, { gid: group.pre, grant: g.body.said }, [g])),
      true,
    );
    const refused: Array<[string, Record<string, unknown>, CesrFrame[]]> = [
      [MULTISIG_QRY_ROUTE, { gid: group.pre, qry: g.body.said }, [g]], // wrong child ilk
      [MULTISIG_QRY_ROUTE, { gid: group.pre, qry: m.body.said }, [m]], // not authored by the group
      [MULTISIG_QRY_ROUTE, { gid: group.pre, qry: g.body.said }, [q]], // SAID mismatch
      [MULTISIG_QRY_ROUTE, { gid: group.pre }, [q]], // missing commitment
      [MULTISIG_QRY_ROUTE, { gid: group.pre, qry: q.body.said }, [q, q]], // one child only
      [MULTISIG_IPEX_PROOF_ROUTE, { gid: group.pre, grant: q.body.said }, [q]], // not a Grant
      [MULTISIG_IPEX_PROOF_ROUTE, { gid: group.pre, "ipex-proof": g.body.said }, [g]], // wrong field
    ];
    for (const [route, attrs, children] of refused) {
      assertEquals(check(wrapper(bob, route, attrs, children)), false, `${route} ${JSON.stringify(attrs)}`);
    }
    // The wrapper must come from a current signing member of the selected group.
    assertEquals(check(wrapper(stranger, MULTISIG_QRY_ROUTE, { gid: group.pre, qry: q.body.said }, [q])), false);
    await assertRejects(() => run(() => multisigQueryExn(group, bob, memberQry)));
    await assertRejects(() => run(() => multisigIpexProofExn(group, bob, qry)));
  });
});

Deno.test("child handlers share one core coordination route by nested child route", async () => {
  await coordination(async ({ left, bob, group, notifier, qry }) => {
    const exchanger = new Exchanger(left);
    const mux = loadMultisigHandlers(left, exchanger, { notifier });
    const owner = (accept: boolean) => {
      const seen = { verified: [] as string[], handled: [] as string[] };
      const handler: ExchangeRouteHandler = {
        resource: MULTISIG_QRY_ROUTE,
        verify: args => (seen.verified.push(args.serder.said!), accept),
        handle: args => void seen.handled.push(args.serder.said!),
      };
      return { handler, seen };
    };
    const dh = owner(true), other = owner(false);
    mux.addChildHandler(MULTISIG_QRY_ROUTE, "/ipex/dhke", dh.handler);
    mux.addChildHandler(MULTISIG_QRY_ROUTE, "/ipex/unblind", other.handler);
    assertThrows(() => mux.addChildHandler(MULTISIG_QRY_ROUTE, "/ipex/dhke", other.handler));
    const [serder] = await run(() => multisigQueryExn(group, bob, qry));
    const child = parseBytes(qry)[0];
    const decision = await run(() =>
      exchanger.processEvent({ serder, nests: [child], tsgs: proof(bob, serder), gvrsn: Vrsn_2_0 })
    );
    assertEquals(decision.kind, "accept");
    // The delegate owns the child; the shared route's default mux path did nothing.
    assertEquals(dh.seen, { verified: [serder.said!], handled: [serder.said!] });
    assertEquals(other.seen, { verified: [], handled: [] });
    assertEquals(notifier.list().length, 0);
    assertEquals(left.db.meids.get([child.body.said!]), []);
    // A finite owner releases its delegation; the default core path resumes.
    mux.removeChildHandler(MULTISIG_QRY_ROUTE, "/ipex/dhke", dh.handler);
    assertEquals(mux.childHandlerFor(serder, [child]), null);
  });
});
