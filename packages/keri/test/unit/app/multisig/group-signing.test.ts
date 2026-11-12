import { call, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { parseBytes } from "../../../../../cesr/mod.ts";
import { signLocalGroupEvent } from "../../../../src/app/identity/endpoint-roleing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { envelopesFromFrames } from "../../../../src/app/protocol/parsering.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { interact } from "../../../../src/core/protocol-eventing.ts";

Deno.test("group query signs only its local member at current index3", async () => {
  await run(function*() {
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipSignator: true, skipConfig: true });
    const local = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipSignator: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(local, new FetchHttpClient(), systemClock);
    try {
      const peers = [0, 1, 2].map((i) => remote.makeHab(`peer${i}`));
      for (const peer of peers) {
        for (const bytes of remote.db.clonePreIter(peer.pre, 0)) {
          yield* runtime.reactor.processBytes(bytes, { local: true });
        }
      }
      const member = local.makeHab("user");
      const mids = [...peers.map((peer) => peer.pre), member.pre];
      const group = local.makeGroupHab("group", member, mids, mids, undefined, {
        isith: ["0", "0", "0", "1"],
        nsith: "1",
        toad: 0,
      }).hab;
      const bytes = group.query(group.pre, peers[0].pre, { route: "mbx", q: { topics: { "/receipt": 0 } } });
      const frames = yield* call(() => parseBytes(bytes));
      const envelopes = envelopesFromFrames(frames);
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

Deno.test("remote group events count other members' signatures and strip only local members'", async () => {
  await run(function*() {
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipSignator: true, skipConfig: true });
    const local = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipSignator: true, skipConfig: true });
    try {
      const peer = remote.makeHab("peer");
      const member = local.makeHab("member");
      const share = (from: typeof local, to: typeof local, pre: string) => {
        for (const [, said] of from.db.getKelItemIter(pre)) {
          to.kevery.processEvent({
            serder: from.db.getEvtSerder(pre, said)!,
            sigers: from.db.sigs.get([pre, said]),
            wigers: [],
            frcs: [],
            sscs: [],
            ssts: [],
            local: false,
          });
        }
      };
      share(remote, local, peer.pre);
      share(local, remote, member.pre);
      const mids = [peer.pre, member.pre];
      // Either member alone satisfies the threshold, so each side accepts its own inception.
      const options = { isith: ["1", "1"], nsith: ["1", "1"], toad: 0 };
      const group = local.makeGroupHab("group", member, mids, mids, undefined, options).hab;
      assertEquals(remote.makeGroupHab("group", peer, mids, mids, undefined, options).hab.pre, group.pre);

      const fromPeer = remote.interactGroupHab("group");
      assertEquals(fromPeer.sigers.map((siger) => siger.index), [0]);
      const remoteInput = { wigers: [], frcs: [], sscs: [], ssts: [], local: false };
      assertEquals(
        local.kevery.processEvent({ serder: fromPeer.serder, sigers: fromPeer.sigers, ...remoteInput }).kind,
        "accept",
      );
      assertEquals(group.kever!.sn, 1);

      // The local member's own signature arriving from outside must not satisfy the threshold.
      const forged = interact(group.pre, group.kever!.said, 2, [], { version: group.kever!.serder.pvrsn });
      const sigers = signLocalGroupEvent(local, forged, mids, group.kever!.verfers.map((verfer) => verfer.qb64));
      assertEquals(sigers.map((siger) => siger.index), [1]);
      const decision = local.kevery.processEvent({ serder: forged, sigers, ...remoteInput });
      assertEquals(decision.kind === "accept", false);
      assertEquals(group.kever!.sn, 1);
    } finally {
      yield* local.close(true);
      yield* remote.close(true);
    }
  });
});
