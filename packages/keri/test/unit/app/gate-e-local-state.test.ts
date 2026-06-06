// @file-test-lane app-fast-parallel

import { type Operation, run } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { Diger, Prefixer, Seqner, SerderKERI } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import { locAddCommand } from "../../../src/app/cli/loc.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { isWellKnownOobiUrl, parseOobiUrl } from "../../../src/app/oobiery.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import { assertOperationThrows, testCLICommand } from "../../utils.ts";

const textDecoder = new TextDecoder();

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

Deno.test("Gate E - base-path OOBI parsing preserves cid, role, eid, and alias metadata", () => {
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

Deno.test("Gate E - ends add command persists mailbox role through runtime path", async () => {
  const name = `gate-e-ends-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-gate-e-${crypto.randomUUID()}`;
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

Deno.test("Gate E - transferable controller OOBI reply seal attachments use fixed-width Seqner encoding", async () => {
  const name = `gate-e-oobi-seal-${crypto.randomUUID()}`;
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

Deno.test("Gate E - non-transferable mailbox OOBI replies use reply cigars", async () => {
  const name = `gate-e-oobi-mailbox-cigar-${crypto.randomUUID()}`;
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

Deno.test("Gate E - loc add command persists location state through reply acceptance", async () => {
  const name = `gate-e-loc-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-gate-e-loc-${crypto.randomUUID()}`;
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

Deno.test("Gate E - loc add command rejects malformed URLs deterministically", async () => {
  await assertOperationThrows(
    locAddCommand({
      name: `gate-e-loc-invalid-${crypto.randomUUID()}`,
      headDirPath: `/tmp/tufa-gate-e-loc-invalid-${crypto.randomUUID()}`,
      alias: "alice",
      url: "not-a-url",
    }),
    "Invalid URL not-a-url",
  );
});

Deno.test("Gate E - `/introduce` replies enqueue discovered OOBIs through Oobiery route ownership", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `gate-e-introduce-${crypto.randomUUID()}`,
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
