import { type Operation, run } from "effection";
import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { Diger, Prefixer, ResourceLimitError, Seqner, SerderKERI, Vrsn_2_0 } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import { locAddCommand } from "../../../src/app/cli/loc.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { isWellKnownOobiUrl, parseOobiUrl } from "../../../src/app/oobiery.ts";
import { loadStoredReply } from "../../../src/app/stored-replies.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { reply } from "../../../src/core/protocol-eventing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
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
      const endRole = hab.makeEndRole(pre, EndpointRoles.controller, true);
      ingestKeriBytes(runtime, endRole);
      yield* processRuntimeTurn(runtime, { hab });

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
      assertEquals(loadStoredReply(hby.db, said, { maxMessageBytes: expected.length }), expected);
      assertThrows(() => loadStoredReply(hby.db, said, { maxMessageBytes: expected.length - 1 }), ResourceLimitError);
      assertThrows(() => loadStoredReply(hby.db, said, { maxProofRows: 0 }), ResourceLimitError);
      const native = hby.db.rpys.sdb as unknown as { getBinary(key: Uint8Array): Uint8Array | undefined };
      const binary = native.getBinary;
      native.getBinary = () => {
        throw new Error("oversized stored reply was copied");
      };
      try {
        assertThrows(() => loadStoredReply(hby.db, said, { maxMessageBytes: 1 }), ResourceLimitError);
      } finally {
        native.getBinary = binary;
      }
      const read = hby.db.getValBounded, fault = new Error("establishment storage failed");
      hby.db.getValBounded = function(...args) {
        if (args[0] === this.evts.sdb) throw fault;
        return read.apply(this, args);
      };
      try {
        assertEquals(assertThrows(() => loadStoredReply(hby.db, said)), fault);
      } finally {
        hby.db.getValBounded = read;
      }
      const bare = new SerderKERI({ raw: hab.makeLocScheme("http://127.0.0.1:1", pre, "http") });
      hby.db.rpys.pin([bare.said!], bare);
      assertEquals(loadStoredReply(hby.db, bare.said!), bare.raw);
      assertEquals(loadStoredReply(hby.db, "missing").length, 0);
      assertThrows(() => loadStoredReply(hby.db, said, { maxProofRows: -1 }), RangeError);
      const newer = reply("/loc/scheme", { eid: pre, scheme: "http", url: hostUrl }, { pre, pvrsn: Vrsn_2_0 });
      const v2Wire = hab.endorse(newer);
      hby.db.rpys.pin([newer.said!], newer);
      hby.db.ssgs.pin([newer.said!, pre, "0".repeat(32), pre], hab.sign(newer.raw, true));
      assertEquals(loadStoredReply(hby.db, newer.said!, { maxMessageBytes: v2Wire.length }), v2Wire);
      assertThrows(
        () => loadStoredReply(hby.db, newer.said!, { maxMessageBytes: v2Wire.length - 1 }),
        ResourceLimitError,
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
      const endRole = hab.makeEndRole(pre, EndpointRoles.mailbox, true);
      ingestKeriBytes(runtime, endRole);
      yield* processRuntimeTurn(runtime, { hab });

      const stream = textDecoder.decode(
        hab.replyToOobi(pre, EndpointRoles.mailbox, [pre]),
      );

      assertStringIncludes(stream, "\"r\":\"/loc/scheme\"");
      assertStringIncludes(stream, "-CAB");
      const said = hby.db.eans.get([pre, EndpointRoles.mailbox, pre])!.qb64;
      const expected = endRole;
      assertEquals(hab.loadEndRole(pre, pre, EndpointRoles.mailbox), expected);
      assertEquals(loadStoredReply(hby.db, said, { maxMessageBytes: expected.length, maxProofRows: 1 }), expected);
      assertThrows(() => loadStoredReply(hby.db, said, { maxMessageBytes: expected.length - 1 }), ResourceLimitError);
      assertThrows(() => loadStoredReply(hby.db, said, { maxProofRows: 0 }), ResourceLimitError);
      // Additional stored couple exercises the preexisting all-cigar TS reconstruction.
      const other = hby.makeHab("other", undefined, { transferable: false });
      const serder = hby.db.rpys.get([said])!;
      const cigar = other.sign(serder.raw, false)[0];
      hby.db.scgs.add([said], [other.kever!.verfers[0], cigar]);
      const both = loadStoredReply(hby.db, said, { maxProofRows: 2 });
      assertEquals(both, hab.loadEndRole(pre, pre, EndpointRoles.mailbox));
      assertThrows(() => loadStoredReply(hby.db, said, { maxProofRows: 1 }), ResourceLimitError);
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
