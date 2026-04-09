// @file-test-lane app-fast

import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createAgentRuntime, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { type CueSink, processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";

Deno.test("Cue runtime - processCuesOnce emits structured wire, notify, and transport cues", async () => {
  const name = `cue-runtime-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-cue-runtime-${crypto.randomUUID()}`;
  const emissions: Array<{ kind: string; msgs: number; kin: string }> = [];

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
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
      const state = hby.db.getState(hab.pre)!;
      const said = state.d!;
      const event = hby.db.getEvtSerder(hab.pre, said)!;
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      runtime.cues.push({
        kin: "receipt",
        serder: event,
      });
      runtime.cues.push({
        kin: "reply",
        route: "/loc/scheme",
        data: { eid: hab.pre, scheme: "http", url: "http://127.0.0.1:7723" },
      });
      runtime.cues.push({
        kin: "query",
        pre: hab.pre,
        src: hab.pre,
        route: "ksn",
        query: {},
      });
      runtime.cues.push({
        kin: "stream",
        serder: event,
        pre: hab.pre,
        src: hab.pre,
        topics: { logs: 0 },
      });
      runtime.cues.push({
        kin: "keyStateSaved",
        ksn: state,
      });

      const sink: CueSink = {
        *send(emission) {
          emissions.push({
            kind: emission.kind,
            msgs: emission.msgs.length,
            kin: emission.cue.kin,
          });
        },
      };

      yield* processCuesOnce(runtime, { hab, sink });
    } finally {
      yield* hby.close();
    }
  });

  assertEquals(emissions, [
    { kind: "wire", msgs: 1, kin: "receipt" },
    { kind: "wire", msgs: 1, kin: "reply" },
    { kind: "wire", msgs: 1, kin: "query" },
    { kind: "transport", msgs: 0, kin: "stream" },
    { kind: "notify", msgs: 0, kin: "keyStateSaved" },
  ]);
});

Deno.test("Cue runtime - runtime turn preserves cues without a local habitat interpreter", async () => {
  const name = `cue-runtime-fallback-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-cue-runtime-fallback-${crypto.randomUUID()}`;
  const emissions: Array<{ kind: string; kin: string }> = [];

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
      skipSignator: true,
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
      const state = hby.db.getState(hab.pre)!;
      const said = state.d!;
      const event = hby.db.getEvtSerder(hab.pre, said)!;
      hby.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      runtime.cues.push({
        kin: "stream",
        serder: event,
        pre: hab.pre,
        src: hab.pre,
        topics: { logs: 0 },
      });
      runtime.cues.push({
        kin: "oobiFailed",
        url: "http://127.0.0.1:9999/oobi/abc/controller",
        reason: "HTTP 404",
      });

      const sink: CueSink = {
        *send(emission) {
          emissions.push({ kind: emission.kind, kin: emission.cue.kin });
        },
      };

      yield* processRuntimeTurn(runtime, { sink });
    } finally {
      yield* hby.close();
    }
  });

  assertEquals(emissions, [
    { kind: "transport", kin: "stream" },
    { kind: "notify", kin: "oobiFailed" },
  ]);
});
