// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Diger, Prefixer, Saider } from "../../../../cesr/mod.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import {
  IPEX_ADMIT_ROUTE,
  IPEX_AGREE_ROUTE,
  IPEX_APPLY_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_ROUTES,
  IPEX_SPURN_ROUTE,
  ipexAdmitExn,
  ipexAgreeExn,
  ipexApplyExn,
  ipexGrantExn,
  IpexHandler,
  ipexOfferExn,
  ipexSpurnExn,
  loadIpexHandlers,
} from "../../../src/app/ipexing.ts";
import { Notifier, openNoterForHabery } from "../../../src/app/notifying.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";

Deno.test("IPEX builders produce KERIpy v1 route payload shapes", async () => {
  await run(function* () {
    const hby = yield* createHabery({
      name: `ipex-builder-${crypto.randomUUID()}`,
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
      const acdc = exchangeMessage("/dummy/acdc", { d: "data" }, { sender: sender.pre })[0];

      const [apply] = ipexApplyExn(
        sender,
        recipient.pre,
        "apply",
        "schema-said",
        { legalEntity: true },
      );
      assertEquals(apply.route, IPEX_APPLY_ROUTE);
      assertEquals(apply.ked?.rp, "");
      assertEquals(apply.ked?.p, "");
      assertEquals(apply.ked?.a, {
        m: "apply",
        s: "schema-said",
        a: { legalEntity: true },
        i: recipient.pre,
      });

      const [offer] = ipexOfferExn(sender, "offer", acdc, apply);
      assertEquals(offer.route, IPEX_OFFER_ROUTE);
      assertEquals(offer.ked?.p, apply.said);
      assertEquals((offer.ked?.a as Record<string, unknown>)["m"], "offer");
      assertExists(offer.ked?.e);

      const [agree] = ipexAgreeExn(recipient, "agree", offer);
      assertEquals(agree.route, IPEX_AGREE_ROUTE);
      assertEquals(agree.ked?.p, offer.said);

      const [grant] = ipexGrantExn(sender, recipient.pre, "grant", acdc, {
        agree,
      });
      assertEquals(grant.route, IPEX_GRANT_ROUTE);
      assertEquals(grant.ked?.p, agree.said);
      assertEquals(grant.ked?.a, { m: "grant", i: recipient.pre });
      assertExists(grant.ked?.e);

      const [admit] = ipexAdmitExn(recipient, "admit", grant);
      assertEquals(admit.route, IPEX_ADMIT_ROUTE);
      assertEquals(admit.ked?.p, grant.said);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("IPEX handler enforces KERIpy route graph and one response per prior", async () => {
  await run(function* () {
    const hby = yield* createHabery({
      name: `ipex-verify-${crypto.randomUUID()}`,
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
      const acdc = exchangeMessage("/dummy/acdc", { d: "data" }, { sender: sender.pre })[0];
      const handlers = new Map(IPEX_ROUTES.map((route) => [route, new IpexHandler(route, hby)]));
      const [apply] = ipexApplyExn(sender, recipient.pre, "apply", "schema", {});
      const [bareOffer] = ipexOfferExn(sender, "bare offer", acdc);
      const [offer] = ipexOfferExn(sender, "offer", acdc, apply);
      const [agree] = ipexAgreeExn(recipient, "agree", offer);
      const [grant] = ipexGrantExn(sender, recipient.pre, "grant", acdc, {
        agree,
      });
      const [bareGrant] = ipexGrantExn(sender, recipient.pre, "bare grant", acdc);
      const [admit] = ipexAdmitExn(recipient, "admit", grant);
      const [spurn] = ipexSpurnExn(recipient, "spurn", apply);

      assertEquals(handlers.get(IPEX_APPLY_ROUTE)!.verify({ serder: apply }), true);
      assertEquals(handlers.get(IPEX_OFFER_ROUTE)!.verify({ serder: bareOffer }), true);
      assertEquals(handlers.get(IPEX_GRANT_ROUTE)!.verify({ serder: bareGrant }), true);
      assertEquals(handlers.get(IPEX_OFFER_ROUTE)!.verify({ serder: offer }), false);
      assertEquals(handlers.get(IPEX_AGREE_ROUTE)!.verify({ serder: agree }), false);
      assertEquals(handlers.get(IPEX_ADMIT_ROUTE)!.verify({ serder: admit }), false);
      assertEquals(handlers.get(IPEX_APPLY_ROUTE)!.verify({ serder: offer }), false);

      hby.db.exns.pin([apply.said!], apply);
      assertEquals(handlers.get(IPEX_OFFER_ROUTE)!.verify({ serder: offer }), true);
      assertEquals(handlers.get(IPEX_SPURN_ROUTE)!.verify({ serder: spurn }), true);

      hby.db.erpy.pin([apply.said!], new Saider({ qb64: offer.said! }));
      assertEquals(handlers.get(IPEX_OFFER_ROUTE)!.verify({ serder: offer }), false);
      assertEquals(handlers.get(IPEX_SPURN_ROUTE)!.verify({ serder: spurn }), false);

      hby.db.exns.pin([offer.said!], offer);
      assertEquals(handlers.get(IPEX_AGREE_ROUTE)!.verify({ serder: agree }), true);
      assertEquals(handlers.get(IPEX_ADMIT_ROUTE)!.verify({ serder: agree }), false);

      hby.db.exns.pin([agree.said!], agree);
      assertEquals(handlers.get(IPEX_GRANT_ROUTE)!.verify({ serder: grant }), true);

      hby.db.exns.pin([grant.said!], grant);
      assertEquals(handlers.get(IPEX_ADMIT_ROUTE)!.verify({ serder: admit }), true);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("accepted IPEX grants create KERIpy-shaped notifier entries", async () => {
  await run(function* () {
    const hby = yield* createHabery({
      name: `ipex-notifier-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const noter = yield* openNoterForHabery(hby);
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
      const notifier = new Notifier(hby, { noter });
      const exchanger = new Exchanger(hby);
      loadIpexHandlers(hby, exchanger, { notifier });

      const acdc = exchangeMessage("/dummy/acdc", { d: "data" }, { sender: sender.pre })[0];
      const [grant] = ipexGrantExn(sender, recipient.pre, "grant message", acdc);
      const sigers = sender.sign(grant.raw, true);
      const decision = exchanger.processEvent({
        serder: grant,
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: sender.pre }),
            sender.kever!.sner,
            new Diger({ qb64: sender.kever!.said }),
            sigers,
          ),
        ],
      });

      assertEquals(decision.kind, "accept");
      assertEquals(hby.db.exns.get([grant.said!])?.said, grant.said);
      const notices = notifier.list();
      assertEquals(notices.length, 1);
      assertEquals(notices[0]!.attrs, {
        r: "/exn/ipex/grant",
        d: grant.said,
        m: "grant message",
      });
    } finally {
      if (noter.opened) {
        yield* noter.close();
      }
      yield* hby.close(true);
    }
  });
});
