import { b, Dater, SerderKERI } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { ReplyStreams } from "../../../../src/app/delivery/reply-streams.ts";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { witnessQueryGet } from "../../../../src/app/witness/witnessing.ts";
import type { AgentCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";
import { DatabaseOperationError } from "../../../../src/core/errors.ts";
import { interact } from "../../../../src/core/protocol-eventing.ts";
import { dgKey, onKey } from "../../../../src/db/core/keys.ts";
import { CapturedKelReplay } from "../../../../src/db/replay/kel-replay.ts";

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
      const replies = new ReplyStreams();
      const read = hby.db.getEvt;
      hby.db.getEvt = () => {
        throw new Error("event hydration before HTTP pull");
      };
      let ordered: Iterable<Uint8Array>, fel: Iterable<Uint8Array>, body: ReadableStream<Uint8Array>;
      try {
        const bySequence = witnessQueryGet(hab, { typ: "kel", pre: hab.pre, sn: 1 });
        const byFirstSeen = witnessQueryGet(hab, { typ: "kel", pre: hab.pre });
        if (bySequence.kind !== "accepted" || byFirstSeen.kind !== "accepted") throw new Error("Expected capture");
        ordered = bySequence.messages;
        fel = byFirstSeen.messages;
        body = replies.open(ordered);
      } finally {
        hby.db.getEvt = read;
      }
      storeFork("late");
      hab.interact();
      const table = hby.db.kels, nativeRows = table.sdb.getValues;
      let cursors = 0, visited = 0;
      table.sdb.getValues = function(...args) {
        const rows = nativeRows.apply(this, args);
        return {
          *[Symbol.iterator]() {
            cursors++;
            try {
              for (const value of rows) {
                visited++;
                yield value;
              }
            } finally {
              cursors--;
            }
          },
        } as unknown as ReturnType<typeof nativeRows>;
      };
      try {
        assertEquals([...ordered!].map((bytes) => new SerderKERI({ raw: bytes }).said), [first, fork, second]);
        assertEquals(visited, 4); // Each duplicate is fetched once, including the excluded late insertion.
        assertEquals([...fel!].map((bytes) => new SerderKERI({ raw: bytes }).said), [initial, first, second, fork]);
        const reader = body!.getReader();
        yield* call(() => reader.read());
        assertEquals(cursors, 0);
        yield* call(() => reader.cancel());
        reader.releaseLock();
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
        const changing = ordered![Symbol.iterator]();
        assertEquals(new SerderKERI({ raw: changing.next().value! }).said, first);
        hby.db.kels.remOn(hab.pre, 1, first);
        assertEquals(new SerderKERI({ raw: changing.next().value! }).said, fork);
        assertEquals(new SerderKERI({ raw: changing.next().value! }).said, second);
        assertEquals(changing.next().done, true);
        assertEquals(cursors, 0);
        const key = onKey(hab.pre, 1), malformed = b("!malformed-proem");
        hby.db.kels.sdb.putSync(key, malformed);
        try {
          assertThrows(() => [...ordered!], DatabaseOperationError, "insertion proem");
        } finally {
          hby.db.kels.sdb.removeSync(key, malformed);
        }
      } finally {
        table.sdb.getValues = nativeRows;
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
      // Capture and queue transfer must not open a body reader, iterator or retained Baser graph.
      const readBody = hby.db.getEvt;
      hby.db.getEvt = () => {
        throw new Error("capture/queue transfer opened event bytes");
      };
      let replay: CapturedKelReplay | null;
      const cues = new Deck<AgentCue>();
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
        const input = [[hab.pre, 0, 0] as const];
        const normalized = new CapturedKelReplay(hby.db, input);
        assertEquals([normalized.ranges === input, normalized.ranges[0] === input[0]], [false, false]);
        assertEquals([Object.getPrototypeOf(normalized.ranges), Object.getPrototypeOf(normalized.ranges[0])], [
          Array.prototype,
          Array.prototype,
        ]);
        assertThrows(() => new CapturedKelReplay(hby.db, [[hab.pre, 1, 0]]), RangeError);
        // Even a borrowed store with opaque additional state is never walked during queue transfer.
        Object.defineProperty(hby.db, "retainedProbe", {
          get() {
            throw new Error("Baser graph inspected");
          },
          configurable: true,
        });
        cues.push({ kin: "replay", msgs: replay });
      } finally {
        hby.db.getEvt = readBody;
        delete (hby.db as unknown as Record<string, unknown>).retainedProbe;
      }
      assertExists(replay!);
      assertEquals(cues.pull(), { kin: "replay", msgs: replay });
      hab.interact();
      // The source was captured before interaction; two independent readers see the same event identities.
      for (let attempt = 0; attempt < 2; attempt++) {
        const messages = [...replay];
        assertEquals(messages.length, 1);
        assertEquals(new SerderKERI({ raw: messages[0] }).sn, 0);
      }
      assertEquals([...hby.db.replay(hab.pre)!].length, 2);
      assertEquals(hby.db.replay(hab.pre, 2), null);
      const first = [...replay][0];
      assertEquals(hby.db.cloneEvtMsg(hab.pre, 0, said), first);
      const fault = new Error("replay storage read failed"), read = hby.db.getEvt;
      hby.db.getEvt = () => {
        throw fault;
      };
      try {
        assertEquals(assertThrows(() => [...replay]), fault, "storage failures cannot become empty replay success");
      } finally {
        hby.db.getEvt = read;
      }
      // Corrupt stored events still skip independently from storage I/O failures.
      hby.db.setEvt(dgKey(hab.pre, hab.kever!.said), Uint8Array.of(1));
      assertEquals([...hby.db.replay(hab.pre)!].length, 1);
    } finally {
      yield* hby.close(true);
    }
  });
});
