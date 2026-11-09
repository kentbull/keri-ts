/** One invalid message is skipped like KERIpy's parser, without losing the rest of its stream. */
import { parseBytes } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { processWitnessIngress } from "../../../../src/app/witness/ingress.ts";
import { DatabaseOperationError } from "../../../../src/core/errors.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";

/** Concatenate complete signed messages into one input stream. */
function stream(...messages: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(messages.reduce((total, message) => total + message.length, 0));
  let offset = 0;
  for (const message of messages) {
    joined.set(message, offset);
    offset += message.length;
  }
  return joined;
}

/** A valid location, an unregistered reply route, then a second valid location. */
function sandwich(hab: Hab): Uint8Array {
  return stream(
    hab.makeLocScheme("http://127.0.0.1:5642/", hab.pre, "http"),
    hab.reply("/not/a/registered/route", { cid: hab.pre }),
    hab.makeLocScheme("tcp://127.0.0.1:5632/", hab.pre, "tcp"),
  );
}

/** Both valid locations prove the stream continued past the unknown route. */
function assertBothLocations(hby: Habery, hab: Hab): void {
  assertEquals(hby.db.locs.get([hab.pre, "http"])?.url, "http://127.0.0.1:5642/");
  assertEquals(hby.db.locs.get([hab.pre, "tcp"])?.url, "tcp://127.0.0.1:5632/");
}

Deno.test("generic ingress processes messages after an unknown reply route", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("sender");
      const reactor = new Reactor(protocolFixture(hby));
      yield* reactor.processBytes(sandwich(hab));
      assertBothLocations(hby, hab);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("witness ingress processes messages after an unknown reply route", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const hab = hby.makeHab("sender");
      yield* processWitnessIngress(runtime, hab, sandwich(hab));
      assertBothLocations(hby, hab);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("an invalid message is reported as a drop decision with its cause", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("sender");
      const reactor = new Reactor(protocolFixture(hby));
      const [frame] = yield* call(() => parseBytes(hab.reply("/not/a/registered/route", { cid: hab.pre })));
      const { decision, mailboxQueryAuthorized } = yield* reactor.protocol.dispatch(frame);
      assertEquals(decision, {
        kind: "drop",
        reason: "invalidMessage",
        detail: "No resource is registered to handle route /not/a/registered/route",
      });
      assertEquals(mailboxQueryAuthorized, false);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("infrastructure failures still propagate from ingress", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("sender");
      const reactor = new Reactor(protocolFixture(hby));
      reactor.protocol.rvy.processReply = () => {
        throw new DatabaseOperationError("storage unavailable");
      };
      const bytes = hab.makeLocScheme("http://127.0.0.1:5642/", hab.pre, "http");
      yield* call(() =>
        assertRejects(() => run(() => reactor.processBytes(bytes)), DatabaseOperationError, "storage unavailable")
      );
    } finally {
      yield* hby.close(true);
    }
  });
});
