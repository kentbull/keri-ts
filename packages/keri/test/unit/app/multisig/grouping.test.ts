import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Diger, Prefixer } from "../../../../../cesr/mod.ts";
import { Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { IPEX_GRANT_ROUTE, ipexGrantExn, loadIpexHandlers } from "../../../../src/app/ipex/ipexing.ts";
import {
  embeddedBusinessExnSAD,
  loadMultisigHandlers,
  Multiplexor,
  MULTISIG_EXN_ROUTE,
  MULTISIG_ICP_ROUTE,
  MULTISIG_ISS_ROUTE,
  MULTISIG_REV_ROUTE,
  MULTISIG_RPY_ROUTE,
  MULTISIG_VCP_ROUTE,
  multisigExn,
  multisigInceptExn,
  multisigIssueExn,
  multisigRegistryInceptExn,
  multisigRevokeExn,
  multisigRpyExn,
} from "../../../../src/app/multisig/grouping.ts";
import { Notifier, openNoterForHabery } from "../../../../src/app/notifications/notifying.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange as exchangeMessage } from "../../../../src/core/exchange/protocol-exchanging.ts";

Deno.test("multisig builders produce KERIpy route payload and embed shapes", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `multisig-builders-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const member = hby.makeHab("member", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const { hab: group, serder: icp } = hby.makeGroupHab("group", member, [member.pre], undefined, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
      });
      const vcp = exchangeMessage("/dummy/vcp", { usage: "registry" }, { sender: group.pre })[0];
      const anc = exchangeMessage("/dummy/anc", { a: true }, { sender: group.pre })[0];
      const acdc = exchangeMessage("/dummy/acdc", { d: "data" }, { sender: group.pre })[0];
      const iss = exchangeMessage("/dummy/iss", { i: true }, { sender: group.pre })[0];
      const rev = exchangeMessage("/dummy/rev", { r: true }, { sender: group.pre })[0];
      const rpy = exchangeMessage("/dummy/rpy", { r: true }, { sender: group.pre })[0];
      const [grant] = ipexGrantExn(group, member.pre, "grant", acdc);

      const [micp] = yield* multisigInceptExn(member, [member.pre], [member.pre], icp);
      assertEquals(micp.route, MULTISIG_ICP_ROUTE);
      assertEquals(micp.ked?.a, { gid: group.pre, smids: [member.pre], rmids: [member.pre] });
      assertExists((micp.ked?.e as Record<string, unknown>).icp);

      const [vcpExn] = multisigRegistryInceptExn(group, member, "issue credentials", vcp, anc);
      assertEquals(vcpExn.route, MULTISIG_VCP_ROUTE);
      assertEquals(vcpExn.ked?.a, { gid: group.pre, usage: "issue credentials" });
      assertExists((vcpExn.ked?.e as Record<string, unknown>).vcp);
      assertExists((vcpExn.ked?.e as Record<string, unknown>).anc);

      const [issExn] = multisigIssueExn(group, member, acdc, iss, anc);
      assertEquals(issExn.route, MULTISIG_ISS_ROUTE);
      assertEquals(issExn.ked?.a, { gid: group.pre });
      assertExists((issExn.ked?.e as Record<string, unknown>).acdc);
      assertExists((issExn.ked?.e as Record<string, unknown>).iss);
      assertExists((issExn.ked?.e as Record<string, unknown>).anc);

      const [revExn] = multisigRevokeExn(group, member, "credential-said", rev, anc);
      assertEquals(revExn.route, MULTISIG_REV_ROUTE);
      assertEquals(revExn.ked?.a, { gid: group.pre, said: "credential-said" });
      assertExists((revExn.ked?.e as Record<string, unknown>).rev);
      assertExists((revExn.ked?.e as Record<string, unknown>).anc);

      const [rpyExn] = yield* multisigRpyExn(group, member, rpy);
      assertEquals(rpyExn.route, MULTISIG_RPY_ROUTE);
      assertEquals(rpyExn.ked?.a, { gid: group.pre });
      assertExists((rpyExn.ked?.e as Record<string, unknown>).rpy);

      const [wrapped] = multisigExn(group, member, grant);
      assertEquals(wrapped.route, MULTISIG_EXN_ROUTE);
      assertEquals(wrapped.ked?.a, { gid: group.pre });
      assertEquals(embeddedBusinessExnSAD(wrapped)?.r, IPEX_GRANT_ROUTE);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Multiplexor indexes embedded proposal SAIDs and notifies for remote submitters", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `multisig-mux-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const noter = yield* openNoterForHabery(hby);
    try {
      const member = hby.makeHab("member", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const remote = hby.makeHab("remote", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const { hab: group } = hby.makeGroupHab("group", member, [member.pre], undefined, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
      });
      hby.habs.delete(remote.pre);

      const acdc = exchangeMessage("/dummy/acdc", { d: "data" }, { sender: group.pre })[0];
      const [grant] = ipexGrantExn(group, member.pre, "grant", acdc);
      const [wrapped] = multisigExn(group, remote, grant);
      hby.db.exns.pin([wrapped.said!], wrapped);

      const notifier = new Notifier(hby.signator!, { noter });
      const mux = new Multiplexor(hby, { notifier });
      for (const hint of [["2", 0], [2], [3, 0], [2, -1], [2, 4096]]) {
        const [invalid] = exchangeMessage(MULTISIG_EXN_ROUTE, { gid: group.pre, cgvrsn: hint }, {
          sender: remote.pre,
          embeds: { exn: grant.raw },
        });
        assertEquals((yield* mux.add(invalid)).kind, "reject");
      }
      assertEquals(notifier.list().length, 0);
      const decision = yield* mux.add(wrapped);
      const embeddedSaid = (wrapped.ked?.e as Record<string, unknown>).d as string;

      assertEquals(decision.kind, "accept");
      if (decision.kind !== "accept") {
        throw new Error(`Expected accept, got ${decision.kind}`);
      }
      assertEquals(decision.embeddedSaid, embeddedSaid);
      assertEquals(hby.db.meids.get([embeddedSaid]).map((saider) => saider.qb64), [wrapped.said]);
      assertEquals(hby.db.maids.get([embeddedSaid]).map((prefixer) => prefixer.qb64), [remote.pre]);
      assertEquals(notifier.list().map((notice) => notice.attrs), [{ r: MULTISIG_EXN_ROUTE, d: wrapped.said }]);

      assertEquals((yield* mux.add(wrapped)).kind, "duplicate");
      assertEquals(notifier.list().map((notice) => notice.attrs), [{ r: MULTISIG_EXN_ROUTE, d: wrapped.said }]);
    } finally {
      if (noter.opened) {
        yield* noter.close();
      }
      yield* hby.close(true);
    }
  });
});

Deno.test("Multiplexor rejects nonlocal group participation proposals", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `multisig-reject-${crypto.randomUUID()}`,
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
      const acdc = exchangeMessage("/dummy/acdc", { d: "data" }, { sender: sender.pre })[0];
      const iss = exchangeMessage("/dummy/iss", { i: true }, { sender: sender.pre })[0];
      const anc = exchangeMessage("/dummy/anc", { a: true }, { sender: sender.pre })[0];
      const [proposal] = multisigIssueExn("not-local-group", sender, acdc, iss, anc);
      hby.habs.delete(sender.pre);

      const mux = new Multiplexor(hby);
      const decision = yield* mux.add(proposal);

      assertEquals(decision.kind, "reject");
      if (decision.kind !== "reject") {
        throw new Error(`Expected reject, got ${decision.kind}`);
      }
      assertEquals(decision.reason.includes("not a local member"), true);

      const exchanger = new Exchanger(hby);
      loadMultisigHandlers(hby, exchanger);
      const routeDecision = yield* call(() =>
        exchanger.processEvent({
          serder: proposal,
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: sender.pre }),
              sender.kever!.sner,
              new Diger({ qb64: sender.kever!.said }),
              sender.sign(proposal.raw, true),
            ),
          ],
        })
      );
      assertEquals(routeDecision.kind, "reject");
      assertEquals(hby.db.exns.get([proposal.said!]), null);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Multiplexor preserves join, rotation and family membership rules at the wire boundary", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const member = hby.makeHab("member");
      const child = hby.db.getEvtSerder(member.pre, member.kever!.said)!;
      const mux = new Multiplexor(hby);
      // Malformed list entries are filtered as before; they do not change local membership.
      for (
        const [route, attrs, accepted] of [
          ["/multisig/icp", { smids: [7, member.pre] }, true],
          ["/multisig/icp", { smids: "not-a-list", rmids: [member.pre] }, true],
          ["/multisig/icp", { smids: [7], rmids: {} }, false],
          ["/multisig/rot", { gid: member.pre }, true],
          ["/multisig/rot", { gid: "unhosted-group", rmids: [member.pre] }, true],
          ["/multisig/rot", { gid: "", smids: [member.pre] }, false],
          ["/multisig/rot", { gid: "unhosted-group", smids: [7] }, false],
          ["/multisig/iss", { gid: member.pre }, true],
          ["/multisig/iss", { gid: 7, smids: [member.pre] }, false],
          ["/multisig/iss", { gid: "unhosted-group", smids: [member.pre] }, false],
          // Membership is intentionally family-wide; handler registration selects actual routes.
          ["/multisig/future", { gid: member.pre }, true],
          ["/unrelated/route", { gid: member.pre }, false],
        ] as const
      ) {
        const [proposal] = exchangeMessage(route, attrs, { sender: member.pre, embeds: { icp: child.raw } });
        assertEquals(mux.verify(proposal), accepted, `${route}: ${JSON.stringify(attrs)}`);
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Exchanger lead elects the signer with the lowest group signature index", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `multisig-lead-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const member = hby.makeHab("member", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const { hab: group } = hby.makeGroupHab("group", member, [member.pre], undefined, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
      });
      const acdc = exchangeMessage("/dummy/acdc", { d: "data" }, { sender: group.pre })[0];
      const [grant] = ipexGrantExn(group, member.pre, "grant", acdc);
      const groupKever = group.kever!;
      const memberKey = member.kever!.verfers[0]!.qb64;
      const sigers = member.mgr.sign(grant.raw, {
        pubs: [memberKey],
        indexed: true,
        indices: [0],
      });
      const exchanger = new Exchanger(hby);
      loadIpexHandlers(hby, exchanger);
      loadMultisigHandlers(hby, exchanger);
      const decision = yield* call(() =>
        exchanger.processEvent({
          serder: grant,
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: group.pre }),
              groupKever.sner,
              new Diger({ qb64: groupKever.said }),
              sigers,
            ),
          ],
        })
      );

      assertEquals(decision.kind, "accept");
      assertEquals(exchanger.lead(group, grant.said!), true);
      // A foreign endorsement at index zero cannot elect a group leader.
      hby.db.esigs.trim([grant.said!, group.pre], { topive: false });
      hby.db.esigs.add([grant.said!, member.pre, member.kever!.sner.numh, member.kever!.said], sigers[0]);
      assertEquals(exchanger.lead(group, grant.said!), false);
    } finally {
      yield* hby.close(true);
    }
  });
});
