import { run, spawn } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { EndpointRoles } from "../../../src/core/roles.ts";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
} from "../../../src/app/agent-runtime.ts";
import { startServer } from "../../../src/app/server.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import { locAddCommand } from "../../../src/app/cli/loc.ts";
import {
  oobiGenerateCommand,
  oobiResolveCommand,
} from "../../../src/app/cli/oobi.ts";
import {
  fetchOp,
  textOp,
  waitForServer,
  waitForTaskHalt,
} from "../../effection-http.ts";
import { assertOperationThrows, testCLICommand } from "../../utils.ts";

Deno.test("Gate E - ends add command persists mailbox role through runtime path", async () => {
  const name = `gate-e-ends-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-gate-e-${crypto.randomUUID()}`;
  const alias = "alice";
  let pre = "";

  await run(function*() {
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

  await run(function*() {
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

Deno.test("Gate E - mailbox and agent OOBIs generate and resolve through shared runtime", async () => {
  const sourceName = `gate-e-source-${crypto.randomUUID()}`;
  const targetName = `gate-e-target-${crypto.randomUUID()}`;
  const sourceHeadDirPath = `/tmp/tufa-gate-e-src-${crypto.randomUUID()}`;
  const targetHeadDirPath = `/tmp/tufa-gate-e-dst-${crypto.randomUUID()}`;
  const alias = "source";
  const port = 8911;
  let pre = "";
  let mailboxUrl = "";
  let agentUrl = "";

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      const runtime = createAgentRuntime(hby, { mode: "local" });
      const url = `http://127.0.0.1:${port}`;
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(runtime, hab.makeEndRole(hab.pre, EndpointRoles.controller, true));
      ingestKeriBytes(runtime, hab.makeEndRole(hab.pre, EndpointRoles.agent, true));
      ingestKeriBytes(runtime, hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true));
      yield* processRuntimeTurn(runtime, { hab });
    } finally {
      yield* hby.close();
    }
  });

  const mailboxGenerated = await run(() =>
    testCLICommand(
      oobiGenerateCommand({
        name: sourceName,
        headDirPath: sourceHeadDirPath,
        alias,
        role: EndpointRoles.mailbox,
      }),
    )
  );
  mailboxUrl = mailboxGenerated.output.at(-1) ?? "";
  assertStringIncludes(mailboxUrl, `/oobi/${pre}/mailbox/${pre}`);

  const agentGenerated = await run(() =>
    testCLICommand(
      oobiGenerateCommand({
        name: sourceName,
        headDirPath: sourceHeadDirPath,
        alias,
        role: EndpointRoles.agent,
      }),
    )
  );
  agentUrl = agentGenerated.output.at(-1) ?? "";
  assertStringIncludes(agentUrl, `/oobi/${pre}/agent/${pre}`);

  await run(function*() {
    const hby = yield* createHabery({
      name: targetName,
      headDirPath: targetHeadDirPath,
      skipConfig: true,
    });
    try {
      // create target store only
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: sourceName,
      headDirPath: sourceHeadDirPath,
      skipConfig: true,
    });
    const hab = hby.habByName(alias);
    const runtime = createAgentRuntime(hby, { mode: "indirect" });
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      const mailboxResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          url: mailboxUrl,
        }),
      );
      assertEquals(mailboxResolved.output.at(-1), mailboxUrl);

      const agentResolved = yield* testCLICommand(
        oobiResolveCommand({
          name: targetName,
          headDirPath: targetHeadDirPath,
          url: agentUrl,
        }),
      );
      assertEquals(agentResolved.output.at(-1), agentUrl);
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: targetName,
      headDirPath: targetHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.db.getState(pre)?.i, pre);
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.mailbox, pre])?.allowed,
        true,
      );
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.agent, pre])?.allowed,
        true,
      );
      assertEquals(hby.db.locs.get([pre, "http"])?.url, `http://127.0.0.1:${port}`);
      assertEquals(hby.db.roobi.get(mailboxUrl)?.state, "resolved");
      assertEquals(hby.db.roobi.get(agentUrl)?.state, "resolved");
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

  await run(function*() {
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

  await run(function*() {
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
