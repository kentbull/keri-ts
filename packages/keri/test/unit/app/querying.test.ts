import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { SerderKERI, type Siger } from "../../../../cesr/mod.ts";
import {
  createAgentRuntime,
  processRuntimeTurn,
  runtimeHasPendingWork,
  runtimeOobiConverged,
  runtimePendingState,
} from "../../../src/app/agent-runtime.ts";
import { type CueSink } from "../../../src/app/cue-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { type KeverEventEnvelope } from "../../../src/core/eventing.ts";
import { Roles } from "../../../src/core/roles.ts";

function eventEnvelope(
  serder: SerderKERI,
  sigers: Siger[],
): KeverEventEnvelope {
  return {
    serder,
    sigers,
    wigers: [],
    frcs: [],
    sscs: [],
    ssts: [],
    local: false,
  };
}

function makeInteraction(
  pre: string,
  sn: number,
  prior: string,
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: "ixn",
      i: pre,
      s: sn.toString(16),
      p: prior,
      a: [],
    },
    makify: true,
  });
}

function parseSerder(msg: Uint8Array): SerderKERI {
  return new SerderKERI({ raw: msg });
}

function captureSink(
  emissions: CueRecord[],
): CueSink {
  return {
    *send(emission) {
      emissions.push({
        kind: emission.kind,
        kin: emission.cue.kin,
        serder: emission.msgs[0] ? parseSerder(emission.msgs[0]) : null,
      });
    },
  };
}

function seedControllerEndpoint(
  hby: {
    db: {
      locs: { pin(keys: [string, string], value: { url: string }): void };
      ends: {
        pin(keys: [string, string, string], value: { allowed: boolean }): void;
      };
    };
  },
  pre: string,
  url = "http://127.0.0.1:7723",
): void {
  hby.db.locs.pin([pre, "http"], { url });
  hby.db.ends.pin([pre, Roles.controller, pre], { allowed: true });
}

interface CueRecord {
  kind: string;
  kin: string;
  serder: SerderKERI | null;
}

Deno.test("Query coordinator turns incomplete query cues into outbound `logs` queries when a local hab and controller endpoint exist", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `querying-incomplete-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const requester = hby.makeHab("requester", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = hby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      seedControllerEndpoint(hby, subject.pre);

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      runtime.cues.push({
        kin: "query",
        pre: subject.pre,
        q: { pre: subject.pre },
      });

      const emissions: CueRecord[] = [];
      yield* processRuntimeTurn(runtime, {
        hab: requester,
        sink: captureSink(emissions),
      });

      assertEquals(emissions.length, 1);
      assertEquals(emissions[0]?.kind, "wire");
      assertEquals(emissions[0]?.kin, "query");
      assertExists(emissions[0]?.serder);
      assertEquals(emissions[0]?.serder?.route, "logs");
      assertEquals(
        (emissions[0]?.serder?.ked?.q as Record<string, unknown>).i,
        subject.pre,
      );
      assertEquals(
        (emissions[0]?.serder?.ked?.q as Record<string, unknown>).src,
        subject.pre,
      );
      assertEquals(
        (emissions[0]?.serder?.ked?.q as Record<string, unknown>).pre,
        undefined,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Query coordinator keeps incomplete queries notify-only when no honest local habitat can be resolved", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `querying-ambiguous-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      hby.makeHab("requester-a", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      hby.makeHab("requester-b", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = hby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      seedControllerEndpoint(hby, subject.pre);

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      runtime.cues.push({
        kin: "query",
        pre: subject.pre,
        q: { pre: subject.pre },
      });

      const emissions: CueRecord[] = [];
      yield* processRuntimeTurn(runtime, {
        sink: captureSink(emissions),
      });

      assertEquals(emissions.length, 1);
      assertEquals(emissions[0], {
        kind: "notify",
        kin: "query",
        serder: null,
      });
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Query coordinator keeps incomplete queries notify-only when the target has no controller, agent, or witness endpoint", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `querying-no-endpoint-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const requester = hby.makeHab("requester", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = hby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      runtime.cues.push({
        kin: "query",
        pre: subject.pre,
        q: { pre: subject.pre },
      });

      const emissions: CueRecord[] = [];
      yield* processRuntimeTurn(runtime, {
        hab: requester,
        sink: captureSink(emissions),
      });

      assertEquals(emissions.length, 1);
      assertEquals(emissions[0], {
        kind: "notify",
        kin: "query",
        serder: null,
      });
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("KeyStateNoticer finishes immediately once a saved key state matches local accepted state", async () => {
  await run(function*() {
    const requesterHby = yield* createHabery({
      name: `querying-ksn-current-requester-${crypto.randomUUID()}`,
      temp: true,
    });
    const subjectHby = yield* createHabery({
      name: `querying-ksn-current-subject-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const requester = requesterHby.makeHab("requester", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = subjectHby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(requesterHby, { mode: "local" });
      const subjectIcp = subjectHby.db.getEvtSerder(
        subject.pre,
        subject.kever?.said ?? "",
      );
      assertExists(subjectIcp);
      runtime.reactor.kevery.processEvent(
        eventEnvelope(subjectIcp, subject.sign(subjectIcp.raw, true)),
      );
      seedControllerEndpoint(requesterHby, subject.pre);
      runtime.cues.clear();
      const resolvedUrl = `http://127.0.0.1:7723/oobi/${subject.pre}/controller`;
      requesterHby.db.roobi.pin(resolvedUrl, {
        date: new Date().toISOString(),
        state: "resolved",
        cid: subject.pre,
        role: Roles.controller,
      });

      runtime.querying.watchKeyState(subject.pre, { hab: requester });

      const emissions: CueRecord[] = [];
      yield* processRuntimeTurn(runtime, {
        hab: requester,
        sink: captureSink(emissions),
      });
      const initialQuery = emissions.find((entry) => entry.kind === "wire");
      assertEquals(initialQuery?.serder?.route, "ksn");

      runtime.querying.configure({
        hab: requester,
        sink: captureSink(emissions),
      });
      yield* runtime.querying.send({
        cue: { kin: "keyStateSaved", ksn: subject.kever!.state() },
        msgs: [],
        kind: "notify",
      });

      assertEquals(runtime.querying.hasPendingWork(), false);
      assertEquals(
        emissions.filter((entry) => entry.kind === "wire").length,
        1,
      );
    } finally {
      yield* subjectHby.close(true);
      yield* requesterHby.close(true);
    }
  });
});

Deno.test("KeyStateNoticer upgrades to a `logs` query when a saved key state is ahead and clears once local KEL catches up", async () => {
  await run(function*() {
    const requesterHby = yield* createHabery({
      name: `querying-ksn-ahead-requester-${crypto.randomUUID()}`,
      temp: true,
    });
    const subjectHby = yield* createHabery({
      name: `querying-ksn-ahead-subject-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const requester = requesterHby.makeHab("requester", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = subjectHby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(requesterHby, { mode: "local" });
      const subjectIcp = subjectHby.db.getEvtSerder(
        subject.pre,
        subject.kever?.said ?? "",
      );
      assertExists(subjectIcp);
      runtime.reactor.kevery.processEvent(
        eventEnvelope(subjectIcp, subject.sign(subjectIcp.raw, true)),
      );
      seedControllerEndpoint(requesterHby, subject.pre);
      runtime.cues.clear();
      const resolvedUrl = `http://127.0.0.1:7723/oobi/${subject.pre}/controller`;
      requesterHby.db.roobi.pin(resolvedUrl, {
        date: new Date().toISOString(),
        state: "resolved",
        cid: subject.pre,
        role: Roles.controller,
      });

      runtime.querying.watchKeyState(subject.pre, { hab: requester });

      const emissions: CueRecord[] = [];
      const sink = captureSink(emissions);
      yield* processRuntimeTurn(runtime, { hab: requester, sink });
      const initialQuery = emissions.find((entry) => entry.kind === "wire");
      assertEquals(initialQuery?.serder?.route, "ksn");

      const ixn = makeInteraction(subject.pre, 1, subject.kever!.said);
      subjectHby.kevery.processEvent({
        ...eventEnvelope(ixn, subject.sign(ixn.raw, true)),
        local: true,
      });

      runtime.querying.configure({ hab: requester, sink });
      yield* runtime.querying.send({
        cue: {
          kin: "keyStateSaved",
          ksn: subjectHby.db.getKever(subject.pre)!.state(),
        },
        msgs: [],
        kind: "notify",
      });

      assertEquals(runtime.querying.hasPendingWork(), true);
      assertEquals(runtimePendingState(runtime).queriesPending, true);
      assertEquals(runtimeHasPendingWork(runtime), true);
      assertEquals(runtimeOobiConverged(runtime, resolvedUrl), false);
      assertEquals(emissions[1]?.kind, "notify");
      assertEquals(emissions[2]?.kind, "wire");
      assertEquals(emissions[2]?.serder?.route, "logs");

      runtime.reactor.kevery.processEvent(
        eventEnvelope(ixn, subject.sign(ixn.raw, true)),
      );
      yield* processRuntimeTurn(runtime, { hab: requester, sink });

      assertEquals(runtime.querying.hasPendingWork(), false);
      assertEquals(runtimePendingState(runtime).queriesPending, false);
      assertEquals(runtimeHasPendingWork(runtime), false);
      assertEquals(runtimeOobiConverged(runtime, resolvedUrl), true);
    } finally {
      yield* subjectHby.close(true);
      yield* requesterHby.close(true);
    }
  });
});

Deno.test("SeqNoQuerier and AnchorQuerier stay pending until their local completion conditions are satisfied", async () => {
  await run(function*() {
    const requesterHby = yield* createHabery({
      name: `querying-continuations-requester-${crypto.randomUUID()}`,
      temp: true,
    });
    const subjectHby = yield* createHabery({
      name: `querying-continuations-subject-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const requester = requesterHby.makeHab("requester", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = subjectHby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(requesterHby, { mode: "local" });
      const subjectIcp = subjectHby.db.getEvtSerder(
        subject.pre,
        subject.kever?.said ?? "",
      );
      assertExists(subjectIcp);
      runtime.reactor.kevery.processEvent(
        eventEnvelope(subjectIcp, subject.sign(subjectIcp.raw, true)),
      );
      seedControllerEndpoint(requesterHby, subject.pre);
      runtime.cues.clear();

      const seq = runtime.querying.watchSeqNo(subject.pre, 1, {
        hab: requester,
      });
      const anchor = runtime.querying.watchAnchor(subject.pre, {
        i: subject.pre,
        s: "1",
        d: subject.kever!.said,
      }, { hab: requester });

      const emissions: CueRecord[] = [];
      yield* processRuntimeTurn(runtime, {
        hab: requester,
        sink: captureSink(emissions),
      });
      yield* processRuntimeTurn(runtime, {
        hab: requester,
        sink: captureSink(emissions),
      });

      assertEquals(
        emissions.filter((entry) => entry.kind === "wire").length >= 2,
        true,
      );
      assertEquals(seq.done, false);
      assertEquals(anchor.done, false);
      assertEquals(runtime.querying.hasPendingWork(), true);
    } finally {
      yield* subjectHby.close(true);
      yield* requesterHby.close(true);
    }
  });
});
