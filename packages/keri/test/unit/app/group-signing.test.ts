// @file-test-lane app-stateful-a
import { run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { createParser } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { envelopesFromFrames } from "../../../src/app/parsering.ts";

Deno.test("group query signs only its local member at current index3", async () => {
  await run(function*() {
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipSignator: true, skipConfig: true });
    const local = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipSignator: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(local, { mode: "local" });
    try {
      const peers = [0, 1, 2].map((i) => remote.makeHab(`peer${i}`));
      for (const peer of peers) {
        for (const bytes of remote.db.clonePreIter(peer.pre, 0)) {
          runtime.reactor.processCompleteChunk(bytes, { local: true });
        }
      }
      const member = local.makeHab("user");
      const mids = [...peers.map((peer) => peer.pre), member.pre];
      const group = local.makeGroupHab("group", member, mids, mids, undefined, {
        isith: ["0", "0", "0", "1"],
        nsith: "1",
        toad: 0,
      }).hab;
      const bytes = group.query(group.pre, peers[0].pre, { topics: { "/receipt": 0 } }, "mbx");
      const parser = createParser({ framed: false, attachmentDispatchMode: "compat" });
      const envelopes = envelopesFromFrames([...parser.feed(bytes), ...parser.flush()]);
      assertEquals(envelopes.length, 1);
      const envelope = envelopes[0];
      const signature = envelope.ssgs[0]?.sigers[0];
      assertExists(signature);
      assertEquals(signature.index, 3);
      assertEquals(signature.ondex, undefined);
      assertEquals(member.kever!.verfers[0].verify(signature.raw, envelope.serder.raw), true);
      assertEquals(group.kever!.tholder!.satisfy([signature.index]), true);
      const contributed = member.kever!.verfers[0];
      member.rotate();
      member.interact();
      const body = new TextEncoder().encode("historical contribution, current group authority");
      const historical = group.sign(body, true);
      assertEquals(historical.length, 1);
      assertEquals(historical[0].index, 3);
      assertEquals(historical[0].ondex, undefined);
      assertEquals(contributed.verify(historical[0].raw, body), true);
      assertEquals(member.kever!.verfers[0].verify(historical[0].raw, body), false);
      assertEquals(contributed.verify(group.sign(body, false)[0].raw, body), true);
      // Rebuilding the Hab view must use durable member KEL evidence, not an in-memory signer cache.
      local.habs.delete(group.pre);
      const restored = local.habByName("group")!;
      assertExists(restored);
      assertEquals(restored.sign(body, true)[0].qb64, historical[0].qb64);
      // A group needing another member still receives only its local partial signature.
      const other = local.makeHab("other-local");
      const partial = local.makeGroupHab("partial", member, [other.pre, member.pre], undefined, undefined, {
        isith: "2",
        nsith: "2",
        toad: 0,
      }).hab;
      assertEquals(partial.sign(body, true).map((sig) => [sig.index, sig.ondex]), [[1, undefined]]);
      assertEquals(partial.kever!.tholder!.satisfy([1]), false);
      // A joined metadata claim alone cannot confer a contribution to an unrelated accepted AID.
      const foreign = local.joinGroupHab(peers[1].pre, "foreign", member, [member.pre]);
      assertThrows(() => foreign.sign(body, true), Error, "no contribution");
      member.rotate({ ncount: 2 });
      member.rotate();
      assertThrows(() => restored.sign(body, true), Error, "single-key member events");
    } finally {
      yield* runtime.close();
      yield* local.close(true);
      yield* remote.close(true);
    }
  });
});
