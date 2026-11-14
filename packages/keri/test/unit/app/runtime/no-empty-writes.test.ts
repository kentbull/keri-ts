/**
 * An idle agent runtime opens no LMDB write transaction. Every loop looks for work with reads, and a writer opens
 * only for a pass that has something to write. The stores' own counters (`writeActivity`) are the seam: LMDB
 * counts each write transaction it opens, the writer lock the idle agent must not keep taking for nothing.
 */
import { call, run, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { acceptedEventReplayMessage } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { PROTOCOL_IDLE_TOCKS, PROTOCOL_TOCK_MS } from "../../../../src/app/runtime/doing.ts";
import { chunkBytes } from "../../../../src/app/transport/byte-source.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";
import { FakeRuntimeHttpClient, ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

/** Let every pending macrotask run, so a loop that is not waiting on the clock shows itself. */
const settle = () => call(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

/** Write transactions opened so far through every store the runtime composes. */
function writeTransactions(runtime: AgentRuntime): number {
  const stores = [
    runtime.hby.db,
    runtime.hby.ks,
    runtime.mailboxer,
    runtime.vdr?.publication.reger,
    runtime.acdc?.baser,
    runtime.noter,
  ];
  return stores.reduce((sum, store) => sum + (store?.writeActivity ?? 0), 0);
}

/** Run the runtime through `tocks` tocks of its own clock. */
function* elapse(clock: ManualRuntimeClock, tocks: number) {
  for (let tock = 0; tock < tocks; tock++) {
    clock.advance(PROTOCOL_TOCK_MS);
    yield* settle();
  }
}

/** A runtime with every optional owner and a KEL escrow that stays pending until its dependency arrives. */
function* compose() {
  const clock = new ManualRuntimeClock(0);
  const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  hby.makeHab("wallet", undefined, { transferable: true, toad: 0, wits: [] });
  const sender = source.makeHab("sender");
  const inception = acceptedEventReplayMessage(source, sender.pre, 0).message;
  const later = sender.interact();
  const reactor = new Reactor(protocolFixture(hby));
  yield* reactor.process((signal) => chunkBytes(later, { signal }));
  assertEquals([...hby.db.ooes.getTopItemIter()].length, 1, "the later event waits on its inception");
  const runtime = yield* createAgentRuntime(hby, new FakeRuntimeHttpClient(), clock, {
    enableMailboxStore: true,
    kram: { enabled: true },
  });
  return { clock, hby, source, sender, inception, reactor, runtime };
}

Deno.test("an idle runtime opens no write transaction across its idle sweeps, with an escrow waiting", async () => {
  await run(function*() {
    const { clock, hby, source, runtime } = yield* compose();
    try {
      yield* spawn(() => runAgentRuntime(runtime, { pollMailbox: true }));
      yield* settle();
      yield* elapse(clock, 2); // tock 0's opening passes have finished
      const before = writeTransactions(runtime);
      yield* elapse(clock, PROTOCOL_IDLE_TOCKS * 2 + 3); // two idle sweeps of every store-driven loop
      assertEquals(writeTransactions(runtime), before, "idle tocks and idle sweeps open no write transaction");
      hby.db.transaction(() => {});
      assertEquals(writeTransactions(runtime), before + 1, "the counter sees an empty write transaction");
    } finally {
      yield* source.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("a busy runtime still writes: the awaited event is accepted and the escrow drains", async () => {
  await run(function*() {
    const { clock, hby, source, sender, inception, reactor, runtime } = yield* compose();
    try {
      yield* spawn(() => runAgentRuntime(runtime, { pollMailbox: true }));
      yield* settle();
      yield* elapse(clock, 2);
      const before = writeTransactions(runtime);
      yield* reactor.process((signal) => chunkBytes(inception, { signal }));
      yield* elapse(clock, 4); // the write moves the store's counter, so the next tocks run the escrow pass
      assert(writeTransactions(runtime) > before, "accepting the inception wrote");
      assertEquals(hby.db.getKever(sender.pre)?.sn, 1, "the escrow pass replayed the waiting event");
      assertEquals([...hby.db.ooes.getTopItemIter()].length, 0, "and its escrow is gone");
    } finally {
      yield* source.close(true);
      yield* hby.close(true);
    }
  });
});
