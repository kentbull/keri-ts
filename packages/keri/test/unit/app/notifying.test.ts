// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { DELEGATE_REQUEST_ROUTE, DelegateRequestHandler } from "../../../src/app/delegating.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { notice, Notifier, openNoterForHabery } from "../../../src/app/notifying.ts";
import { OOBI_REQUEST_ROUTE, oobiRequestExn, OobiRequestHandler } from "../../../src/app/oobiery.ts";
import { Signal, Signaler } from "../../../src/app/signaling.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";

function makeExchangeSerder(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  return exchangeMessage(route, payload, args)[0];
}

function makeEmbeddedExchangeMessage(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  const [serder, attachments] = exchangeMessage(route, payload, args);
  return { serder, attachments };
}

function inceptionMessage(hby: Habery, pre: string, said: string): Uint8Array {
  const fn = hby.db.getFelFn(pre, said);
  if (fn === null) {
    throw new Error(`Missing first-seen ordinal for ${pre}:${said}`);
  }
  return hby.db.cloneEvtMsg(pre, fn, said);
}

Deno.test("Notifier signs, lists, marks, removes, and signals notices with collapse-key replacement", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `notifier-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const noter = yield* openNoterForHabery(hby);
    const signaler = new Signaler();
    const notifier = new Notifier(hby, { noter, signaler });

    try {
      assertEquals(notifier.add({ r: "/delegate/request", src: "EA", delpre: "EB" }), true);
      assertEquals(notifier.count(), 1);
      assertEquals(signaler.count(), 1);

      const listed = notifier.list();
      assertEquals(listed.length, 1);
      assertEquals(listed[0]!.attrs["r"], "/delegate/request");
      assertEquals(listed[0]!.read, false);

      const rid = listed[0]!.rid;
      assertEquals(notifier.markRead(rid), true);
      assertEquals(notifier.list()[0]!.read, true);
      assertEquals(signaler.count(), 1);

      assertEquals(notifier.remove(rid), true);
      assertEquals(notifier.count(), 0);
      assertEquals(signaler.count(), 1);

      signaler.processOnce(Date.now() + Signaler.SignalTimeoutMs + 1_000);
      assertEquals(signaler.count(), 0);
    } finally {
      if (noter.opened) {
        yield* noter.close();
      }
      yield* hby.close(true);
    }
  });
});

Deno.test("Notifier rejects tampered stored notices", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `notifier-tamper-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const noter = yield* openNoterForHabery(hby);
    const notifier = new Notifier(hby, { noter });

    try {
      assertEquals(notifier.add({ r: "/delegate/request", src: "EA" }), true);
      const stored = notifier.list()[0]!;
      noter.notes.pin(
        [stored.datetime, stored.rid],
        notice({ r: "/delegate/request", src: "tampered" }, {
          dt: stored.datetime,
          read: stored.read,
        }),
      );

      assertThrows(
        () => notifier.list(),
        Error,
        "failed signator verification",
      );
    } finally {
      if (noter.opened) {
        yield* noter.close();
      }
      yield* hby.close(true);
    }
  });
});

Deno.test("Signaler preserves raw/pad round trips and explicit collapse keys", () => {
  const created = new Signal({
    pad: {
      i: "",
      dt: "2026-04-09T00:00:00.000Z",
      r: "/notification",
      a: { action: "add" },
    },
    ckey: "/notification",
  });
  const roundTrip = new Signal({ raw: created.raw, ckey: created.ckey });
  assertEquals(roundTrip.topic, "/notification");
  assertEquals(roundTrip.attrs["action"], "add");
  assertEquals(roundTrip.ckey, "/notification");
});

Deno.test("DelegateRequestHandler writes notices only for local delegators", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `delegate-request-handler-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const noter = yield* openNoterForHabery(hby);
    const notifier = new Notifier(hby, { noter });

    try {
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const proxy = hby.makeHab("proxy", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const evt = inceptionMessage(hby, proxy.pre, proxy.kever!.said);
      const { serder } = makeEmbeddedExchangeMessage(
        DELEGATE_REQUEST_ROUTE,
        { delpre: delegator.pre },
        {
          sender: proxy.pre,
          embeds: { evt },
        },
      );
      const handler = new DelegateRequestHandler(hby, notifier);
      handler.handle({ serder, attachments: [] });

      const notices = notifier.list();
      assertEquals(notices.length, 1);
      assertEquals(notices[0]!.attrs["r"], DELEGATE_REQUEST_ROUTE);
      assertEquals(notices[0]!.attrs["src"], proxy.pre);
      assertEquals(notices[0]!.attrs["delpre"], delegator.pre);
      assertEquals(
        (notices[0]!.attrs["ked"] as Record<string, unknown>)["i"],
        proxy.pre,
      );
      assertEquals(serder.ked?.rp, "");

      const remoteSerder = makeExchangeSerder(
        DELEGATE_REQUEST_ROUTE,
        { delpre: "Eremote" },
        {
          sender: proxy.pre,
          recipient: "Eremote",
        },
      );
      handler.handle({ serder: remoteSerder, attachments: [] });
      assertEquals(notifier.count(), 1);
    } finally {
      if (noter.opened) {
        yield* noter.close();
      }
      yield* hby.close(true);
    }
  });
});

Deno.test("OobiRequestHandler queues oobis and writes controller notices", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `oobi-request-handler-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const noter = yield* openNoterForHabery(hby);
    const notifier = new Notifier(hby, { noter });

    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const oobi = "https://example.test/oobi/EA/controller?name=Remote";
      const serder = oobiRequestExn(sender, "EB", oobi);

      const handler = new OobiRequestHandler(hby, notifier);
      assertEquals(handler.verify({ serder }), true);
      handler.handle({ serder });

      assertEquals(hby.db.oobis.get(oobi)?.oobialias, "Remote");
      const notices = notifier.list();
      assertEquals(notices.length, 1);
      assertEquals(notices[0]!.attrs["r"], "/oobi");
      assertEquals(notices[0]!.attrs["src"], sender.pre);
      assertEquals(serder.ked?.rp, "");
      assertEquals(notices[0]!.attrs["oobi"], oobi);
      assertEquals(notices[0]!.attrs["oobialias"], "Remote");
    } finally {
      if (noter.opened) {
        yield* noter.close();
      }
      yield* hby.close(true);
    }
  });
});

Deno.test("AgentRuntime owns and closes the noter it opened", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `runtime-noter-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      assertEquals(runtime.noter?.opened, true);
      assertEquals(runtime.notifier !== null, true);
      yield* runtime.close();
      assertEquals(runtime.noter?.opened, false);
    } finally {
      yield* hby.close(true);
    }
  });
});
