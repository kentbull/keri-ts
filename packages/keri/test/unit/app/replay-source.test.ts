import { Dater, ResourceAdmissionError, ResourceLimitError, ResourcePolicy, SerderKERI } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { ReplyStreams } from "../../../src/app/reply-streams.ts";
import { witnessQueryGet } from "../../../src/app/witnessing.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import { interact } from "../../../src/core/protocol-eventing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { CapturedKelReplay } from "../../../src/db/kel-replay.ts";

Deno.test("witness GET captures target FEL or KEL duplicate order without retaining cursors", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("alice"), initial = hab.kever!.said;
      hab.interact();
      const first = hab.kever!.said;
      hab.interact();
      const second = hab.kever!.said;
      // Signed conflicting-sequence storage fixtures exercise duplicate selection, not acceptance.
      const storeFork = (label: string): string => {
        const event = interact(hab.pre, initial, 1, [{ label }]);
        const said = event.said!;
        hby.db.putEvtSerder(hab.pre, said, event.raw);
        hby.db.putSigs(hab.pre, said, hab.sign(event.raw, true));
        hby.db.putDts(hab.pre, said, new Dater({ dts: "2026-10-13T12:00:00.000000+00:00" }).qb64);
        hby.db.kels.add(hab.pre, 1, said);
        hby.db.appendFel(hab.pre, said);
        return said;
      };
      const fork = storeFork("captured");
      const resources = new ResourcePolicy(), replies = new ReplyStreams({}, resources);
      const read = hby.db.getValBounded;
      hby.db.getValBounded = () => {
        throw new Error("event hydration before response admission");
      };
      let ordered: Iterable<Uint8Array>, fel: Iterable<Uint8Array>, body: ReadableStream<Uint8Array>;
      try {
        const bySequence = witnessQueryGet(hab, { typ: "kel", pre: hab.pre, sn: 1 }, replies.messageByteLimit);
        const byFirstSeen = witnessQueryGet(hab, { typ: "kel", pre: hab.pre }, replies.messageByteLimit);
        if (bySequence.kind !== "accepted" || byFirstSeen.kind !== "accepted") throw new Error("Expected capture");
        ordered = bySequence.messages;
        fel = byFirstSeen.messages;
        body = replies.open(ordered);
        assertEquals(resources.used.streams, 1);
      } finally {
        hby.db.getValBounded = read;
      }
      storeFork("late");
      hab.interact();
      const table = hby.db.kels, rows = table.getAllItemIter.bind(table);
      let cursors = 0;
      table.getAllItemIter = function*(...args) {
        cursors++;
        try {
          yield* rows(...args);
        } finally {
          cursors--;
        }
      };
      try {
        assertEquals([...ordered!].map((bytes) => new SerderKERI({ raw: bytes }).said), [first, fork, second]);
        assertEquals([...fel!].map((bytes) => new SerderKERI({ raw: bytes }).said), [initial, first, second, fork]);
        const reader = body!.getReader();
        yield* call(() => reader.read());
        assertEquals(cursors, 0);
        yield* call(() => reader.cancel());
        reader.releaseLock();
        assertEquals(resources.used.bytes, 0);
        const native = hby.db.evts.sdb as unknown as { getBinary(key: Uint8Array): Uint8Array | undefined };
        const binary = native.getBinary;
        native.getBinary = () => {
          throw new Error("oversized event was allocated");
        };
        try {
          assertThrows(() => [...hby.db.witnessReplay(hab.pre, 1, 8)!], ResourceLimitError);
        } finally {
          native.getBinary = binary;
        }
        const fault = new Error("native proof read failed"), sigs = hby.db.sigs.getIter;
        hby.db.sigs.getIter = function*() {
          throw fault;
        };
        try {
          assertEquals(assertThrows(() => [...ordered!]), fault);
        } finally {
          hby.db.sigs.getIter = sigs;
        }
        yield* hby.db.close();
        yield* hby.db.reopen();
        assertEquals([...ordered!].map((bytes) => new SerderKERI({ raw: bytes }).said), [first, fork, second]);
      } finally {
        table.getAllItemIter = rows;
        replies.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("replay sources reopen their captured extent without including later first-seen events", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `replay-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("alice");
      const said = hab.kever!.said;
      // Capture and cue admission must not open a body reader, iterator or retained Baser graph.
      const readBody = hby.db.getValBounded;
      hby.db.getValBounded = () => {
        throw new Error("capture/admission opened event bytes");
      };
      let replay: CapturedKelReplay | null;
      const resources = new ResourcePolicy();
      const cues = new CueDeck(resources, 2);
      try {
        replay = hby.db.replay(hab.pre);
        assertExists(replay);
        assertEquals(replay.ranges, [[hab.pre, 0, 0]]);
        assertEquals([Object.isFrozen(replay), Object.isFrozen(replay.ranges), Object.isFrozen(replay.ranges[0])], [
          true,
          true,
          true,
        ]);
        assertThrows(() => (replay!.ranges[0] as unknown as number[])[1] = 1, TypeError);
        assertThrows(() => (replay!.ranges as unknown as string[]).push("late"), TypeError);
        assertEquals(CapturedKelReplay.is(Object.create(CapturedKelReplay.prototype)), false);
        // Even a borrowed store with opaque additional state is never walked by the cue inspector.
        Object.defineProperty(hby.db, "retainedProbe", {
          get() {
            throw new Error("Baser graph inspected");
          },
          configurable: true,
        });
        cues.push({ kin: "replay", messages: replay });
        const held = resources.used.bytes;
        assertEquals(held > 0 && held < 4096, true);
        const occupied = resources.reserve({ bytes: resources.limits.bytes - held });
        if (occupied.kind !== "reserve") throw new Error("Expected remaining credit");
        assertThrows(
          () => new CueDeck(resources).prepare([{ kin: "replay", messages: replay! }]),
          ResourceAdmissionError,
        );
        assertEquals(resources.used.bytes, resources.limits.bytes);
        occupied.reservation.release();
      } finally {
        hby.db.getValBounded = readBody;
        delete (hby.db as unknown as Record<string, unknown>).retainedProbe;
      }
      assertExists(replay!);
      const owner = cues.takeOwned()!;
      const held = resources.used.bytes;
      const fanout = owner.retain();
      assertEquals(resources.used.bytes, held + 128);
      cues.clear();
      assertEquals(resources.used.bytes, held + 128, "Active replay owners keep captured metadata credit");
      hab.interact();
      // The source was captured before interaction; two independent readers see the same event identities.
      for (let attempt = 0; attempt < 2; attempt++) {
        const messages = [...replay];
        assertEquals(messages.length, 1);
        assertEquals(new SerderKERI({ raw: messages[0] }).sn, 0);
      }
      assertEquals([...hby.db.replay(hab.pre)!].length, 2);
      assertEquals(hby.db.replay(hab.pre, 2), null);
      owner.release();
      assertEquals(resources.used.bytes, held + 128);
      fanout.release();
      assertEquals(resources.used.bytes, 0);
      const first = [...replay][0];
      // The counter and every proof byte count toward the exact final allocation budget.
      assertEquals(hby.db.cloneEvtMsg(hab.pre, 0, said, first.length), first);
      assertThrows(() => hby.db.cloneEvtMsg(hab.pre, 0, said, first.length - 1), ResourceLimitError);
      // Refusal occurs at native preflight, before either ordinary or admitted row materialization.
      const native = hby.db.evts.sdb as unknown as {
        get(key: Uint8Array): Uint8Array | undefined;
        getBinary(key: Uint8Array, options?: object): Uint8Array | undefined;
      };
      const original = { get: native.get, getBinary: native.getBinary };
      native.get = native.getBinary = () => {
        throw new Error("oversized replay body was materialized");
      };
      try {
        assertThrows(() => [...hby.db.replay(hab.pre, 0, { maxMessageBytes: 8 })!], ResourceLimitError);
      } finally {
        Object.assign(native, original);
      }
      const fault = new Error("native replay read failed");
      native.getBinary = () => {
        throw fault;
      };
      try {
        assertEquals(assertThrows(() => [...replay]), fault, "native failures cannot become empty replay success");
      } finally {
        native.getBinary = original.getBinary;
      }
      // Corrupt stored events still skip independently; resource-limit failures above must not disappear.
      hby.db.setEvt(dgKey(hab.pre, hab.kever!.said), Uint8Array.of(1));
      assertEquals([...hby.db.replay(hab.pre)!].length, 1);
    } finally {
      yield* hby.close(true);
    }
  });
});
