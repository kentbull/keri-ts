import { type Operation, run } from "effection";
import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import {
  Diger,
  Prefixer,
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  Seqner,
  SerderKERI,
} from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import { locAddCommand } from "../../../src/app/cli/loc.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { isWellKnownOobiUrl, Oobiery, parseOobiUrl } from "../../../src/app/oobiery.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import { DeckFullError } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import { expectKind } from "../../private-access.ts";
import { FakeRuntimeHttpClient, fakeRuntimeServices } from "../../support/runtime-service-fakes.ts";
import { assertOperationThrows, testCLICommand } from "../../utils.ts";

const textDecoder = new TextDecoder();

/** Bind each reply to the signing habitat's establishment event. */
function replySigGroupFor(
  hab: {
    pre: string;
    kever: { sner: TransIdxSigGroup["seqner"]; said: string };
    sign: (ser: Uint8Array) => TransIdxSigGroup["sigers"];
  },
  serder: SerderKERI,
): TransIdxSigGroup {
  return new TransIdxSigGroup(
    new Prefixer({ qb64: hab.pre }),
    hab.kever.sner,
    new Diger({ qb64: hab.kever.said }),
    hab.sign(serder.raw),
  );
}

Deno.test("OOBI local state - base-path OOBI parsing preserves cid, role, eid, and alias metadata", () => {
  const aid = "EExampleAid123456789012345678901234567890123";
  const mailbox = "EMailboxAid1234567890123456789012345678901";

  const rolePath = parseOobiUrl(
    `http://127.0.0.1:7723/relay/oobi/${aid}/mailbox/${mailbox}`,
    "relay",
  );
  assertEquals(rolePath.cid, aid);
  assertEquals(rolePath.role, EndpointRoles.mailbox);
  assertEquals(rolePath.eid, mailbox);
  assertEquals(rolePath.alias, "relay");

  const wellKnown = parseOobiUrl(
    `http://127.0.0.1:7723/relay/.well-known/keri/oobi/${aid}?name=Root`,
  );
  assertEquals(wellKnown.cid, aid);
  assertEquals(wellKnown.role, EndpointRoles.controller);
  assertEquals(wellKnown.alias, "Root");
  assertEquals(
    isWellKnownOobiUrl(
      `http://127.0.0.1:7723/relay/.well-known/keri/oobi/${aid}?name=Root`,
    ),
    true,
  );
  assertEquals(
    isWellKnownOobiUrl(`http://127.0.0.1:7723/relay/oobi/${aid}/controller`),
    false,
  );
});

Deno.test("OOBI local state - ends add command persists mailbox role through runtime path", async () => {
  const name = `oobi-local-ends-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-oobi-local-${crypto.randomUUID()}`;
  const alias = "alice";
  let pre = "";

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      pre = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
    } finally {
      yield* hby.close();
    }
  });

  const result = await run(() =>
    testCLICommand(
      endsAddCommand({
        name,
        headDirPath,
        alias,
        role: EndpointRoles.mailbox,
        eid: pre,
      }),
    )
  );
  assertEquals(result.output.at(-1), `${EndpointRoles.mailbox} ${pre}`);

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.mailbox, pre])?.allowed,
        true,
      );
      assertEquals(
        hby.db.eans.get([pre, EndpointRoles.mailbox, pre])?.qb64.length! > 0,
        true,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("OOBI local state - transferable controller OOBI reply seal attachments use fixed-width Seqner encoding", async () => {
  const name = `oobi-local-oobi-seal-${crypto.randomUUID()}`;
  const passcode = "MyPasscodeARealSecret";
  const hostUrl = "http://127.0.0.1:46321";
  const fixedSeqner = new Seqner({ code: "0A", raw: new Uint8Array(16) }).qb64;

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      temp: true,
      bran: passcode,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("relay", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const pre = hab.pre;

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(hostUrl, pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });

      const stream = textDecoder.decode(
        hab.replyToOobi(pre, EndpointRoles.controller, [pre]),
      );

      assertStringIncludes(
        stream,
        `-FAB${pre}${fixedSeqner}${pre}`,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("OOBI local state - non-transferable mailbox OOBI replies use reply cigars", async () => {
  const name = `oobi-local-oobi-mailbox-cigar-${crypto.randomUUID()}`;
  const passcode = "MyPasscodeARealSecret";
  const hostUrl = "http://127.0.0.1:46322";

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      temp: true,
      bran: passcode,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("relay", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const pre = hab.pre;

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(hostUrl, pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(pre, EndpointRoles.mailbox, true),
      );
      yield* processRuntimeTurn(runtime, { hab });

      const stream = textDecoder.decode(
        hab.replyToOobi(pre, EndpointRoles.mailbox, [pre]),
      );

      assertStringIncludes(stream, "\"r\":\"/loc/scheme\"");
      assertStringIncludes(stream, "-CAB");
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("OOBI local state - loc add command persists location state through reply acceptance", async () => {
  const name = `oobi-local-loc-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-oobi-local-loc-${crypto.randomUUID()}`;
  const alias = "alice";
  let pre = "";
  const url = "http://127.0.0.1:5642";

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      pre = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
    } finally {
      yield* hby.close();
    }
  });

  const result = await run(() =>
    testCLICommand(
      locAddCommand({
        name,
        headDirPath,
        alias,
        url,
      }),
    )
  );
  assertEquals(
    result.output.at(-1),
    `Location ${url} added for aid ${pre} with scheme http`,
  );

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.habByName(alias);
      assertEquals(hby.db.locs.get([pre, "http"])?.url, url);
      assertEquals(hby.db.lans.get([pre, "http"])?.qb64.length! > 0, true);
      assertEquals((hab?.loadLocScheme(pre, "http").length ?? 0) > 0, true);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("OOBI local state - loc add command rejects malformed URLs deterministically", async () => {
  await assertOperationThrows(
    locAddCommand({
      name: `oobi-local-loc-invalid-${crypto.randomUUID()}`,
      headDirPath: `/tmp/tufa-oobi-local-loc-invalid-${crypto.randomUUID()}`,
      alias: "alice",
      url: "not-a-url",
    }),
    "Invalid URL not-a-url",
  );
});

Deno.test("OOBI local state - `/introduce` replies enqueue discovered OOBIs through Oobiery route ownership", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `oobi-local-introduce-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      const introducedUrl = `http://127.0.0.1:1234/oobi/${hab.pre}/controller`;
      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/introduce",
          a: { cid: hab.pre, oobi: introducedUrl },
        },
        makify: true,
      });

      for (const shared of [true, false]) {
        const resources = new ResourcePolicy(), proofCues = new CueDeck(resources, 1);
        const cues = shared ? proofCues : new CueDeck(resources, 1);
        const reactor = new Reactor(hby, { resources, cues: proofCues });
        const owner = new Oobiery(hby, reactor, { cues });
        const url = `${introducedUrl}?deck=${shared}`;
        const notice = new SerderKERI({
          sad: { t: "rpy", dt: makeNowIso8601(), r: "/introduce", a: { cid: hab.pre, oobi: url } },
          makify: true,
        });
        const args = {
          serder: notice,
          diger: new Diger({ qb64: notice.said! }),
          route: "/introduce",
          tsgs: [replySigGroupFor({ pre: hab.pre, kever: hab.kever!, sign: (ser) => hab.sign(ser, true) }, notice)],
        };
        const unchanged = () => {
          assertEquals(hby.db.oobis.get(url), null);
          assertEquals(hby.db.rpys.get([notice.said!]), null);
          assertEquals(hby.db.sdts.get([notice.said!]), null);
          assertEquals([...hby.db.ssgs.getTopItemIter([notice.said!], { topive: true })], []);
          assertEquals(hby.db.rpes.cnt(), 0);
          assertEquals(cues.length, 0);
          assertEquals(proofCues.length, 0);
        };
        const busy = expectKind(resources.reserve({ bytes: resources.limits.bytes }), "reserve");
        assertEquals(assertThrows(() => owner.processReply(args), ResourceAdmissionError).reason, "busy");
        busy.reservation.release();
        unchanged();
        const tiny = new ResourcePolicy({ bytes: 1 }), tinyCues = new CueDeck(tiny, 1);
        const limited = new Oobiery(hby, new Reactor(hby, { resources: tiny, cues: tinyCues }), { cues: tinyCues });
        assertEquals(assertThrows(() => limited.processReply(args), ResourceAdmissionError).reason, "limit");
        unchanged();
        const slot = cues.prepare([{ kin: "proof", said: "occupied" }]);
        const held = resources.used.bytes;
        assertThrows(() => owner.processReply(args), DeckFullError);
        assertEquals(resources.used.bytes, held);
        slot.release();
        unchanged();
        assertEquals(owner.processReply(args).kind, "accept");
        assertEquals(hby.db.oobis.get(url)?.cid, hab.pre);
        assertExists(hby.db.rpys.get([notice.said!]));
        const queued = cues.takeOwned()!;
        assertEquals(queued.cue, { kin: "oobiQueued", url });
        cues.clear();
        assertEquals(resources.used.bytes > 0, true);
        queued.release();
        assertEquals(resources.used.bytes, 0);
        assertEquals(proofCues.length, 0);
      }
      const cold = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const resources = new ResourcePolicy(), queries = new CueDeck(resources, 1), queues = new CueDeck(resources, 0);
        const reactor = new Reactor(cold, { resources, cues: queries }),
          owner = new Oobiery(cold, reactor, { cues: queues });
        const args = {
          serder,
          diger: new Diger({ qb64: serder.said! }),
          route: "/introduce",
          tsgs: [replySigGroupFor({ pre: hab.pre, kever: hab.kever!, sign: (ser) => hab.sign(ser, true) }, serder)],
        };
        assertEquals(owner.processReply(args).kind, "unverified");
        assertEquals(cold.db.oobis.get(introducedUrl), null);
        assertEquals(cold.db.rpes.cnt(), 1, "Unverified introduction retains existing reply escrow ownership");
        assertExists(cold.db.rpys.get([serder.said!]));
        const query = queries.takeOwned()!;
        assertEquals(query.cue.kin, "query");
        assertEquals(queues.length, 0);
        query.release();
        assertEquals(resources.used.bytes, 0);
      } finally {
        yield* cold.close(true);
      }
      runtime.reactor.revery.processReply({
        serder,
        tsgs: [replySigGroupFor({
          pre: hab.pre,
          kever: hab.kever!,
          sign: (ser) => hab.sign(ser, true),
        }, serder)],
      });

      assertEquals(hby.db.oobis.get(introducedUrl)?.cid, hab.pre);
      assertEquals(hby.db.oobis.get(introducedUrl)?.state, "queued");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("OOBI queue and multi-parent publication admit complete cue ownership before durable effects", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const resources = new ResourcePolicy(), cues = new CueDeck(resources, 2), reactor = new Reactor(hby, { resources });
    const http = new FakeRuntimeHttpClient();
    const oobi = new Oobiery(hby, reactor, { cues, services: fakeRuntimeServices({ http }) });
    try {
      const cid = hby.makeHab("source").pre;
      const parent = `http://oobi.test/oobi/${cid}/controller?multi=1`;
      const children = [
        `http://oobi.test/oobi/${cid}/controller?child=1`,
        `http://oobi.test/.well-known/keri/oobi/${cid}?child=2`,
      ];
      const busy = expectKind(resources.reserve({ bytes: resources.limits.bytes }), "reserve");
      assertEquals(assertThrows(() => oobi.resolve(parent, "source"), ResourceAdmissionError).reason, "busy");
      busy.reservation.release();
      assertEquals(hby.db.oobis.get(parent), null);
      const limited = new Oobiery(hby, reactor, { cues: new CueDeck(new ResourcePolicy({ bytes: 1 })) });
      assertEquals(assertThrows(() => limited.resolve(parent), ResourceAdmissionError).reason, "limit");
      assertEquals(hby.db.oobis.get(parent), null);
      oobi.resolve(parent, "source");
      const queued = cues.takeOwned()!;
      assertEquals(queued.cue.kin, "oobiQueued");
      assertExists(hby.db.oobis.get(parent));
      cues.clear();
      assertEquals(resources.used.bytes > 0, true);
      queued.release();
      assertEquals(resources.used.bytes, 0);

      let urls = [...children], pressure = false;
      let held: ReturnType<ResourcePolicy["reserve"]> | undefined;
      http.registerOrigin("http://oobi.test", () => {
        const reply = new SerderKERI({
          sad: { t: "rpy", dt: makeNowIso8601(), r: "/oobi/controller", a: { aid: cid, urls } },
          makify: true,
        });
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              // The finite document lease is already held; saturate remaining bytes at the fanout boundary.
              if (pressure) held = resources.reserve({ bytes: resources.limits.bytes - resources.used.bytes });
              controller.enqueue(reply.raw);
              controller.close();
            },
          }, { highWaterMark: 0 }),
          { headers: { "Content-Type": "application/json" } },
        );
      });
      const untouched = () => {
        assertExists(hby.db.oobis.get(parent));
        assertEquals(hby.db.moobi.get(parent), null);
        assertEquals(hby.db.roobi.get(parent), null);
        assertEquals(hby.db.cons.get([cid]), null);
        assertEquals(hby.db.coobi.get(parent), null);
        for (const child of children) {
          assertEquals(hby.db.oobis.get(child), null);
          assertEquals(hby.db.woobi.get(child), null);
        }
        assertEquals(cues.length, 0);
      };
      urls = [children[0], "invalid later URL"];
      let invalid: unknown;
      try {
        yield* oobi.processOnce();
      } catch (error) {
        invalid = error;
      }
      assertEquals(invalid instanceof TypeError, true);
      untouched();
      urls = [...children, children[0]];
      cues.capacity = 1;
      let limit: unknown;
      try {
        yield* oobi.processOnce();
      } catch (error) {
        limit = error;
      }
      assertEquals(limit instanceof ResourceLimitError, true);
      untouched();
      cues.capacity = 2;
      const item = cues.prepare([{ kin: "proof", said: "occupied" }]);
      yield* oobi.processOnce(); // The existing worker keeps queued work on temporary item saturation.
      untouched();
      item.release();
      pressure = true;
      yield* oobi.processOnce();
      untouched();
      expectKind(held!, "reserve").reservation.release();
      assertEquals(resources.used.bytes, 0);
      pressure = false;
      yield* oobi.processOnce();
      assertEquals(hby.db.oobis.get(parent), null);
      assertEquals(hby.db.moobi.get(parent)?.urls, children);
      assertEquals(hby.db.oobis.get(children[0])?.oobialias, "source");
      assertEquals(hby.db.woobi.get(children[1])?.oobialias, "source");
      assertEquals(cues.toArray(), children.map((url) => ({ kin: "oobiQueued", url, alias: "source" })));
      cues.clear();
      for (const child of children) {
        hby.db.oobis.rem(child);
        hby.db.woobi.rem(child);
        hby.db.roobi.pin(child, { state: "resolved" });
      }
      const pending = hby.db.moobi.get(parent)!;
      const terminalBusy = expectKind(resources.reserve({ bytes: resources.limits.bytes }), "reserve");
      yield* oobi.processOnce();
      terminalBusy.reservation.release();
      assertEquals(hby.db.moobi.get(parent), pending);
      assertEquals(hby.db.roobi.get(parent), null);
      assertEquals(hby.db.cons.get([cid]), null);
      yield* oobi.processOnce();
      assertEquals(hby.db.moobi.get(parent), null);
      assertEquals(hby.db.roobi.get(parent)?.state, "resolved");
      assertExists(hby.db.cons.get([cid]));
      const result = cues.takeOwned()!;
      assertEquals(result.cue.kin, "oobiResolved");
      assertEquals(resources.used.bytes > 0, true);
      result.release();
      const failedParent = `${parent}&failed=1`;
      hby.db.moobi.pin(failedParent, pending);
      hby.db.eoobi.pin(children[0], { state: "http-404" });
      const occupied = cues.prepare([{ kin: "proof", said: "held" }, { kin: "proof", said: "held2" }]);
      yield* oobi.processOnce();
      assertExists(hby.db.moobi.get(failedParent));
      assertEquals(hby.db.eoobi.get(failedParent), null);
      occupied.release();
      yield* oobi.processOnce();
      assertEquals(hby.db.moobi.get(failedParent), null);
      assertEquals(hby.db.eoobi.get(failedParent)?.state, "child-failed");
      const failed = cues.takeOwned()!;
      assertEquals(failed.cue, { kin: "oobiFailed", url: failedParent, reason: "child failed" });
      failed.release();
      assertEquals(resources.used.bytes, 0);
    } finally {
      cues.clear();
      yield* hby.close(true);
    }
  });
});
