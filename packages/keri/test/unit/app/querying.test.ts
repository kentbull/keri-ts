import { call, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertExists, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import {
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  SerderKERI,
  type Siger,
} from "../../../../cesr/mod.ts";
import {
  createAgentRuntime,
  processRuntimeTurn,
  runtimeHasPendingWork,
  runtimeOobiConverged,
  runtimePendingState,
} from "../../../src/app/agent-runtime.ts";
import { type CueSink } from "../../../src/app/cue-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { QueryCoordinator } from "../../../src/app/querying.ts";
import { reserveCueBytes } from "../../../src/core/cue-admission.ts";
import type { QueryCue, TelQueryCue } from "../../../src/core/cues.ts";
import { type KeverEventEnvelope } from "../../../src/core/eventing.ts";
import { Roles } from "../../../src/core/roles.ts";

// @ts-expect-error There is one query body; the legacy alias cannot coexist with q.
void ({ kin: "query", q: {}, query: {} } satisfies QueryCue);
// @ts-expect-error TEL recovery must identify its registry and credential.
void ({ kin: "telquery", q: { i: "credential" } } satisfies TelQueryCue);

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
      const message = [...emission.messages][0];
      emissions.push({
        kind: emission.kind,
        kin: emission.cue.kin,
        serder: message ? parseSerder(message) : null,
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

function seedMailboxEndpoint(
  hby: {
    db: {
      locs: { pin(keys: [string, string], value: { url: string }): void };
      ends: {
        pin(keys: [string, string, string], value: { allowed: boolean }): void;
      };
    };
  },
  recipientPre: string,
  mailboxPre: string,
  url = "http://127.0.0.1:7723",
): void {
  hby.db.locs.pin([mailboxPre, "http"], { url });
  hby.db.ends.pin([recipientPre, Roles.mailbox, mailboxPre], { allowed: true });
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
      const query = requester.query;
      let signatures = 0;
      requester.query = (...args) => {
        signatures++;
        assertEquals(runtime.resources.used.bytes >= 32 * 1024 ** 2, true, "replacement signing owns preparation");
        return query.apply(requester, args);
      };
      yield* processRuntimeTurn(runtime, {
        hab: requester,
        sink: captureSink(emissions),
      });

      assertEquals(signatures, 1, "prepared send must not sign or observe the query twice");
      assertEquals(runtime.resources.used.bytes, 0);
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

Deno.test("Query coordinator emits mailbox-delivered queries when only a mailbox endpoint is known for the target", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `querying-mailbox-only-${crypto.randomUUID()}`,
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
      const mailbox = hby.makeHab("mailbox", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      seedMailboxEndpoint(hby, subject.pre, mailbox.pre);

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
      assertEquals(emissions[0]?.serder?.route, "logs");
      assertEquals(
        (emissions[0]?.serder?.ked?.q as Record<string, unknown>).src,
        subject.pre,
      );
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

      const runtime = yield* createAgentRuntime(requesterHby, {
        mode: "local",
      });
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
      runtime.cues.push({ kin: "keyStateSaved", ksn: subject.kever!.state() });
      yield* processRuntimeTurn(runtime, { hab: requester, sink: captureSink(emissions) });

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

      const runtime = yield* createAgentRuntime(requesterHby, {
        mode: "local",
      });
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
        messages: [],
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

      const runtime = yield* createAgentRuntime(requesterHby, {
        mode: "local",
      });
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

Deno.test("query queues keep failed deliveries and defer newly appended work to the next pass", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `query-bounds-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("alice");
      seedControllerEndpoint(hby, hab.pre);
      const coordinator = new QueryCoordinator(hby, { hab, maxPending: 3, maxContinuations: 1 });
      const request = { pre: hab.pre, src: hab.pre, route: "logs", q: {} };
      coordinator.enqueue(request);
      coordinator.enqueue(request);
      coordinator.enqueue(request);
      assertThrows(() => coordinator.enqueue(request), ResourceLimitError);
      assertEquals(
        coordinator.enqueueCue({ kin: "query", q: {} }),
        false,
        "Ineligible metadata never claims pending admission",
      );
      coordinator.watchSeqNo(hab.pre, 100);
      assertThrows(() => coordinator.watchKeyState(hab.pre), ResourceLimitError);
      const failure = new ResourceAdmissionError("foreign transport busy", "busy");
      coordinator.configure({
        hab,
        sink: {
          *send() {
            throw failure;
          },
        },
      });
      // The in-flight head retains its queue credit; a failed transport must not erase retry work.
      let failed = false;
      try {
        yield* coordinator.processPending();
      } catch (error) {
        failed = true;
        assertStrictEquals(error, failure);
      }
      assertEquals(failed, true);
      assertEquals(coordinator.pending.length, 3);
      assertEquals(hby.db.resources.used.bytes > 0, true);
      coordinator.pending.clear();
      assertEquals(hby.db.resources.used.bytes, 0);
      let sent = 0;
      coordinator.configure({
        hab,
        sink: {
          *send() {
            sent++;
            coordinator.enqueue(request);
          },
        },
      });
      coordinator.enqueue(request);
      yield* coordinator.processPending();
      // One continuation may enqueue a second initial request; each send's new work remains pending.
      assertEquals(sent, 2);
      assertEquals(coordinator.pending.length, 2);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("query cancellation preserves its in-flight queue credit and permits the next drain", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `query-cancel-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("alice");
      seedControllerEndpoint(hby, hab.pre);
      const entered = Promise.withResolvers<void>();
      const coordinator = new QueryCoordinator(hby, { hab, maxPending: 1 });
      const request = { pre: hab.pre, src: hab.pre, route: "logs", q: {} };
      coordinator.configure({
        hab,
        sink: {
          *send() {
            entered.resolve();
            yield* suspend();
          },
        },
      });
      coordinator.enqueue(request);
      const sending = yield* spawn(() => coordinator.processPending());
      yield* call(() => entered.promise);
      // The suspended sender still owns the head, so admission cannot steal its slot.
      assertThrows(() => coordinator.enqueue(request), ResourceLimitError);
      yield* sending.halt();
      assertEquals(coordinator.pending.length, 1);
      let sent = 0;
      coordinator.configure({
        hab,
        sink: {
          *send() {
            sent++;
          },
        },
      });
      yield* coordinator.processPending();
      // Halt releases only the drain guard; the retained request is delivered by the next turn.
      assertEquals(sent, 1);
      assertEquals(coordinator.pending.length, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("pending query metadata refuses before copies and runtime close joins active consumption", async () => {
  for (const fault of [undefined, new ResourceAdmissionError("foreign cleanup busy", "busy")]) {
    let entered!: () => void, cleaning!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => entered = resolve),
      cleanup = new Promise<void>((resolve) => cleaning = resolve),
      gate = new Promise<void>((resolve) => release = resolve);
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const hab = hby.makeHab("alice");
      seedControllerEndpoint(hby, hab.pre);
      const runtime = yield* createAgentRuntime(hby), coordinator = runtime.querying;
      const cue = { kin: "query" as const, pre: hab.pre, src: hab.pre, route: "logs", q: {} };
      assertThrows(() => reserveCueBytes(hby.db.resources, [cue], 64, undefined, { copies: 0 }), RangeError);
      const finite = new ResourcePolicy({ bytes: 25000 });
      let floor: unknown;
      const impossible = assertThrows(
        () => reserveCueBytes(finite, [cue], 64, (error) => floor = error, { copies: 3 }),
        ResourceAdmissionError,
      );
      assertStrictEquals(impossible, floor);
      assertEquals([impossible.reason, finite.used.bytes], ["limit", 0]);
      const occupied = hby.db.resources.reserve({ bytes: hby.db.resources.limits.bytes });
      if (occupied.kind !== "reserve") throw new Error("Expected byte occupancy");
      let copied = false, observed: unknown;
      const guarded = {
        ...cue,
        q: {
          get s() {
            copied = true;
            return "0";
          },
        },
      };
      const refusal = assertThrows(
        () => coordinator.enqueueCue(guarded, (error) => observed = error),
        ResourceAdmissionError,
      );
      assertStrictEquals(refusal, observed);
      assertEquals([refusal.reason, copied, coordinator.pending.length], ["busy", false, 0]);
      occupied.reservation.release();
      coordinator.enqueue({ pre: hab.pre, src: hab.pre, route: "logs", q: {}, hab });
      coordinator.enqueueCue({ ...cue, pre: "unresolved", src: undefined });
      const retained = hby.db.resources.used.bytes;
      yield* coordinator.processPending(runtime); // The default sink retires resolved input; unresolved metadata rotates.
      assertEquals(coordinator.pending.length, 1);
      assertEquals(hby.db.resources.used.bytes > 0 && hby.db.resources.used.bytes < retained, true);
      const deferred = coordinator.pending.peekHead(), deferredBytes = hby.db.resources.used.bytes;
      yield* coordinator.processPending(runtime);
      assertStrictEquals(coordinator.pending.peekHead(), deferred);
      assertEquals(hby.db.resources.used.bytes, deferredBytes);
      coordinator.pending.clear();
      assertEquals(hby.db.resources.used.bytes, 0);
      coordinator.configure({
        hab,
        sink: {
          *send() {
            yield* resource<void>(function*(provide) {
              try {
                yield* provide();
              } finally {
                cleaning();
                yield* call(() => gate);
                // deno-lint-ignore no-unsafe-finally -- Qualify propagation of an injected cleanup failure.
                if (fault) throw fault;
              }
            });
            entered();
            yield* suspend();
          },
        },
      });
      coordinator.enqueueCue(cue);
      let consumeError: unknown, closeError: unknown;
      const sending = yield* spawn(function*() {
        try {
          yield* coordinator.processPending(runtime);
        } catch (error) {
          consumeError = error;
        }
      });
      yield* call(() => ready);
      // Clearing queued work never releases the currently borrowed source record.
      coordinator.pending.clear();
      assertEquals([coordinator.pending.length, hby.db.resources.used.bytes > 0], [1, true]);
      let closed = false;
      const closing = yield* spawn(function*() {
        try {
          yield* runtime.close();
          closed = true;
        } catch (error) {
          closeError = error;
        }
      });
      try {
        yield* call(() => cleanup);
        assertEquals([closed, coordinator.pending.length, hby.db.resources.used.bytes > 0], [false, 1, true]);
      } finally {
        release();
      }
      yield* closing;
      yield* sending;
      assertStrictEquals(consumeError, fault);
      assertStrictEquals(closeError, fault);
      assertEquals([closed, coordinator.pending.length, hby.db.resources.used.bytes], [!fault, 0, 0]);
      assertThrows(() => coordinator.enqueueCue(cue), Error, "closed");
      yield* runtime.close();
      yield* hby.close(true);
    });
  }
});
