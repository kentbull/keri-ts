/**
 * Every agent runtime that polls its mailbox retains `/registry/root` copies.
 *
 * `createAgentRuntime` registers `RegistryRoot`, so a recipient that only runs
 * `runAgentRuntime(runtime, { pollMailbox: true })` (no `receive` command)
 * retains a copy drained from its `credential` mailbox, and the runtime's own
 * escrow loop retains a newcomer copy once the group rotation that adds it is
 * accepted. A composition with `registryRoots: "refuse"` drains and refuses the
 * copy, persisting nothing. Delivery uses the real poller over an in-process
 * SSE mailbox provider.
 */
import { type Operation, run, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import type { Habery } from "../../../src/app/identity/habbing.ts";
import { createAgentRuntime, runAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { runtimeTurn } from "../../../src/app/runtime/runtime-turn.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../../src/core/mailbox/mailbox-topics.ts";
import { Roles } from "../../../src/core/roles.ts";
import {
  copy,
  held,
  notes,
  receive,
  rotate,
  said,
  seed,
  type Side,
  stored,
  type World,
  world,
} from "../../support/registry-root-world.ts";
import { FakeRuntimeHttpClient } from "../../support/runtime-fakes.ts";

/** Serve `wire` once from `side`'s credential mailbox; return the provider identity. */
function mailbox(http: FakeRuntimeHttpClient, hby: Habery, side: Side, wire: Uint8Array): string {
  const eid = `mailbox-${side.name}-${crypto.randomUUID()}`, url = `http://${side.name}.mailbox.test/`;
  hby.db.locs.pin([eid, "http"], { url });
  hby.db.ends.pin([side.hab.pre!, Roles.mailbox, eid], { allowed: true });
  let available = true;
  http.registerOrigin(url, () => {
    if (!available) return new Response(null, { status: 204 });
    available = false;
    const data = new TextDecoder().decode(wire);
    return new Response(`id: 0\nevent: ${CREDENTIAL_MAILBOX_TOPIC}\ndata: ${data}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  return eid;
}

/** Wait up to ten seconds of runtime turns for `condition`. */
function* until(condition: () => boolean, message: string): Operation<void> {
  const deadline = performance.now() + 10_000;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(message);
    yield* runtimeTurn();
  }
}

/** True once the mailbox cursor has passed the served copy. */
function drained(hby: Habery, side: Side, eid: string): boolean {
  return hby.db.tops.get([side.hab.pre!, eid])?.topics[CREDENTIAL_MAILBOX_TOPIC] === 0;
}

function prepared(w: World, sender: Side, recipient: Side): Uint8Array {
  return sender.root.prepare(sender.hab, recipient.hab.pre!, w.gid, w.registry, { td: w.acdc });
}

Deno.test("registry root runtime: a mailbox-polling runtime retains a copy without receive", async () => {
  await run(function*() {
    const http = new FakeRuntimeHttpClient();
    const w = yield* world({ http });
    yield* seed(w);
    const wire = prepared(w, w.alice, w.bob);
    const eid = mailbox(http, w.bob.hby, w.bob, wire);
    const host = yield* spawn(() => runAgentRuntime(w.bob.runtime, { hab: w.bob.hab, pollMailbox: true }));
    try {
      yield* until(() => held(w, w.bob) !== null, "the polling runtime did not retain the copy");
    } finally {
      yield* host.halt();
    }
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(drained(w.bob.hby, w.bob, eid), true);
    assertEquals(stored(w.bob), []);
    assertEquals(notes(w.bob).map(note => note.attrs.d), [said(wire)]);
  });
});

Deno.test("registry root runtime: a polling newcomer retains its copy once the rotation adding it arrives", async () => {
  await run(function*() {
    const http = new FakeRuntimeHttpClient();
    const w = yield* world({ newcomer: true, http });
    yield* seed(w);
    yield* copy(w, w.alice, w.bob);
    const current = [w.alice, w.bob, w.outsider];
    // The newcomer is offline: the rotation that adds it is not yet local.
    yield* rotate(w, current, current, "2", [w.outsider]);
    const wire = prepared(w, w.alice, w.outsider);
    const eid = mailbox(http, w.outsider.hby, w.outsider, wire);
    const host = yield* spawn(() => runAgentRuntime(w.outsider.runtime, { hab: w.outsider.hab, pollMailbox: true }));
    try {
      yield* until(() => drained(w.outsider.hby, w.outsider, eid), "the newcomer did not drain its mailbox");
      assertEquals(stored(w.outsider), [said(wire)]);
      assertEquals(held(w, w.outsider), null);
      // The group rotation arrives; the running escrow loop retains the copy with no command.
      for (const rotation of w.held) yield* receive(w.outsider, rotation, true);
      yield* until(() => held(w, w.outsider) !== null, "the escrowed copy was not retained");
    } finally {
      yield* host.halt();
    }
    assertEquals(held(w, w.outsider)?.qb64, w.root.qb64);
    assertEquals(stored(w.outsider), []);
  });
});

Deno.test("registry root runtime: a refusing runtime drains a copy and persists nothing", async () => {
  await run(function*() {
    const http = new FakeRuntimeHttpClient();
    const w = yield* world();
    yield* seed(w);
    const hby = w.bob.hby;
    const runtime = yield* createAgentRuntime(hby, http, systemClock, { acdc: w.bob.rgy, registryRoots: "refuse" });
    try {
      assertEquals(runtime.registryRoot, null);
      const wire = prepared(w, w.alice, w.bob);
      const eid = mailbox(http, hby, w.bob, wire);
      const host = yield* spawn(() => runAgentRuntime(runtime, { hab: w.bob.hab, pollMailbox: true }));
      try {
        yield* until(() => drained(hby, w.bob, eid), "the refusing runtime did not drain its mailbox");
      } finally {
        yield* host.halt();
      }
      const copied = said(wire);
      assertEquals(hby.db.exns.get([copied]), null);
      assertEquals(hby.db.essrs.get([copied]), []);
      assertEquals(hby.db.rrpe.get([copied]), null);
      assertEquals(held(w, w.bob), null);
    } finally {
      yield* runtime.close();
    }
    assertExists(w.bob.runtime.registryRoot);
  });
});
