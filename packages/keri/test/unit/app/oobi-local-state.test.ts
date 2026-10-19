import { call, type Operation, run } from "effection";
import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { b, concatBytes, Diger, parseBytes, Prefixer, Seqner, SerderKERI, Vrsn_2_0 } from "../../../../cesr/mod.ts";
import { createAgentRuntime, settleRuntimeIngress } from "../../../src/app/agent-runtime.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import { locAddCommand } from "../../../src/app/cli/loc.ts";
import { httpMailboxPollTransport } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { isWellKnownOobiUrl, Oobiery, parseOobiUrl } from "../../../src/app/oobiery.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";

import { loadStoredReply } from "../../../src/app/stored-replies.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { DatabaseOperationError, ValidationError } from "../../../src/core/errors.ts";
import { reply } from "../../../src/core/protocol-eventing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import { protocolFixture } from "../../protocol-fixture.ts";
import { FakeRuntimeHttpClient } from "../../support/runtime-fakes.ts";
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

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, httpMailboxPollTransport);
      const endRole = hab.makeEndRole(pre, EndpointRoles.controller, true);
      yield* settleRuntimeIngress(runtime, [hab.makeLocScheme(hostUrl, pre, "http"), endRole]);

      const stream = textDecoder.decode(
        hab.replyToOobi(pre, EndpointRoles.controller, [pre]),
      );

      assertStringIncludes(
        stream,
        `-FAB${pre}${fixedSeqner}${pre}`,
      );
      const said = hby.db.eans.get([pre, EndpointRoles.controller, pre])!.qb64;
      const expected = endRole;
      assertEquals(hab.loadEndRole(pre, pre, EndpointRoles.controller), expected);
      assertEquals(loadStoredReply(hby.db, said), expected);
      const read = hby.db.rpys.get, fault = new Error("reply storage failed");
      hby.db.rpys.get = () => {
        throw fault;
      };
      try {
        assertEquals(assertThrows(() => loadStoredReply(hby.db, said)), fault);
      } finally {
        hby.db.rpys.get = read;
      }
      const bare = new SerderKERI({ raw: hab.makeLocScheme("http://127.0.0.1:1", pre, "http") });
      hby.db.rpys.pin([bare.said!], bare);
      assertThrows(() => loadStoredReply(hby.db, bare.said!), ValidationError, "Missing attached signatures");
      assertEquals(loadStoredReply(hby.db, "missing").length, 0);
      const newer = reply("/loc/scheme", { eid: pre, scheme: "http", url: hostUrl }, { pre, pvrsn: Vrsn_2_0 });
      const v2Wire = hab.endorse(newer);
      hby.db.rpys.pin([newer.said!], newer);
      hby.db.ssgs.pin([newer.said!, pre, "0".repeat(32), pre], hab.sign(newer.raw, true));
      assertEquals(loadStoredReply(hby.db, newer.said!), v2Wire);
      hab.rotate();
      const oldReply = hby.db.rpys.get([said])!;
      hby.db.ssgs.pin([said, pre, hab.kever!.sn.toString(16), hab.kever!.said], hab.sign(oldReply.raw, true));
      const secondWire = hab.endorse(oldReply);
      // Actual 714 tail observation: two key-ordered one-signature groups have these v1 counters.
      const both = concatBytes(
        oldReply.raw,
        b("-VBn-FAC"),
        expected.slice(oldReply.raw.length + 8),
        secondWire.slice(oldReply.raw.length + 8),
      );
      assertEquals(loadStoredReply(hby.db, said), both);
      const extra = hby.makeHab("supplemental", undefined, { transferable: false });
      const cigar = extra.sign(oldReply.raw, false)[0];
      hby.db.scgs.add([said], [extra.kever!.verfers[0], cigar]);
      const withCigar = loadStoredReply(hby.db, said);
      assertEquals(textDecoder.decode(withCigar.slice(oldReply.raw.length, oldReply.raw.length + 8)), "-VCJ-FAC");
      assertStringIncludes(textDecoder.decode(withCigar), `-CAB${extra.pre}${cigar.qb64}`);
      // Compact durable SN keys are storage fixtures for ordering, not accepted establishment evidence.
      for (const snh of ["10", "2", "02"]) {
        hby.db.ssgs.pin([said, pre, snh, hab.kever!.said], hab.sign(oldReply.raw, true));
      }
      const [frame] = yield* call(() => parseBytes(loadStoredReply(hby.db, said)));
      const seals = frame.attachments[0].items as readonly (readonly { qb64: string }[])[];
      assertEquals(seals.map((seal) => seal[1].qb64), [
        "0AAAAAAAAAAAAAAAAAAAAAAA",
        "0AAAAAAAAAAAAAAAAAAAAAAB",
        "0AAAAAAAAAAAAAAAAAAAAAAC",
        "0AAAAAAAAAAAAAAAAAAAAAAC",
        "0AAAAAAAAAAAAAAAAAAAAAAQ",
      ]);
      hby.db.ssgs.pin([said, pre, "g", hab.kever!.said], hab.sign(oldReply.raw, true));
      assertThrows(() => loadStoredReply(hby.db, said), DatabaseOperationError, "group key");
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

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, httpMailboxPollTransport);
      const endRole = hab.makeEndRole(pre, EndpointRoles.mailbox, true);
      yield* settleRuntimeIngress(runtime, [hab.makeLocScheme(hostUrl, pre, "http"), endRole]);

      const stream = textDecoder.decode(
        hab.replyToOobi(pre, EndpointRoles.mailbox, [pre]),
      );

      assertStringIncludes(stream, "\"r\":\"/loc/scheme\"");
      assertStringIncludes(stream, "-CAB");
      const said = hby.db.eans.get([pre, EndpointRoles.mailbox, pre])!.qb64;
      const expected = endRole;
      assertEquals(hab.loadEndRole(pre, pre, EndpointRoles.mailbox), expected);
      assertEquals(loadStoredReply(hby.db, said), expected);
      // Additional stored couple exercises the actual 714 exactly-one-cigar rule.
      const other = hby.makeHab("other", undefined, { transferable: false });
      const serder = hby.db.rpys.get([said])!;
      const cigar = other.sign(serder.raw, false)[0];
      hby.db.scgs.add([said], [other.kever!.verfers[0], cigar]);
      // Actual 714 omits ambiguous cigar multiplicity; no remaining authenticator is an output failure.
      assertThrows(
        () => loadStoredReply(hby.db, said),
        ValidationError,
        "Missing attached signatures",
      );
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
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, httpMailboxPollTransport);
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
        const proofCues = new Deck<AgentCue>();
        const cues = shared ? proofCues : new Deck<AgentCue>();
        const reactor = new Reactor(protocolFixture(hby, { cues: proofCues }));
        const owner = new Oobiery(hby, reactor, reactor.protocol.rvy, new FetchHttpClient(), cues);
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
        unchanged();
        assertEquals(owner.processReply(args).kind, "accept");
        assertEquals(hby.db.oobis.get(url)?.cid, hab.pre);
        assertExists(hby.db.rpys.get([notice.said!]));
        assertEquals(cues.pull(), { kin: "oobiQueued", url });
        assertEquals(proofCues.length, 0);
      }
      const cold = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const queries = new Deck<AgentCue>(), queues = new Deck<AgentCue>();
        const reactor = new Reactor(protocolFixture(cold, { cues: queries })),
          owner = new Oobiery(cold, reactor, reactor.protocol.rvy, new FetchHttpClient(), queues);
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
        assertEquals(queries.empty, true, "direct Revery work has not passed Reactor publication");
        assertEquals(reactor.protocol.rvy.cues.pull()?.kin, "query");
        assertEquals(queues.length, 0);
      } finally {
        yield* cold.close(true);
      }
      runtime.protocol.rvy.processReply({
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

Deno.test("OOBI multi-parent publication validates all URLs and publishes ordinary child and terminal cues", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const cues = new Deck<AgentCue>(), reactor = new Reactor(protocolFixture(hby));
    const http = new FakeRuntimeHttpClient();
    const oobi = new Oobiery(hby, reactor, reactor.protocol.rvy, http, cues);
    try {
      const cid = hby.makeHab("source").pre;
      const parent = `http://oobi.test/oobi/${cid}/controller?multi=1`;
      const children = [
        `http://oobi.test/oobi/${cid}/controller?child=1`,
        `http://oobi.test/.well-known/keri/oobi/${cid}?child=2`,
      ];
      oobi.resolve(parent, "source");
      assertEquals(cues.pull()?.kin, "oobiQueued");
      assertExists(hby.db.oobis.get(parent));
      let urls = [...children];
      http.registerOrigin("http://oobi.test", () => {
        const reply = new SerderKERI({
          sad: { t: "rpy", dt: makeNowIso8601(), r: "/oobi/controller", a: { aid: cid, urls } },
          makify: true,
        });
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
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
      yield* oobi.processOnce();
      assertEquals(hby.db.moobi.get(parent), null);
      assertEquals(hby.db.roobi.get(parent)?.state, "resolved");
      assertExists(hby.db.cons.get([cid]));
      assertEquals(cues.pull()?.kin, "oobiResolved");
      const failedParent = `${parent}&failed=1`;
      hby.db.moobi.pin(failedParent, pending);
      hby.db.eoobi.pin(children[0], { state: "http-404" });
      yield* oobi.processOnce();
      assertEquals(hby.db.moobi.get(failedParent), null);
      assertEquals(hby.db.eoobi.get(failedParent)?.state, "child-failed");
      assertEquals(cues.pull(), { kin: "oobiFailed", url: failedParent, reason: "child failed" });
    } finally {
      cues.clear();
      yield* hby.close(true);
    }
  });
});
