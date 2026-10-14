import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy, SerderKERI } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { CapturedKelReplay } from "../../../src/db/kel-replay.ts";

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
        // Copying primitive tuples prevents an Array subclass from hiding an uncharged retained owner.
        class RetainedRanges extends Array<readonly [string, number, number]> {
          #body = new Uint8Array(1024 * 1024);
          /** Demonstrate actual additional caller retention, excluded from the canonical source. */
          bytes(): number {
            return this.#body.byteLength;
          }
        }
        const input = new RetainedRanges();
        input.push([hab.pre, 0, 0]);
        const normalized = new CapturedKelReplay(hby.db, input, replay.maxMessageBytes);
        assertEquals(input.bytes(), 1024 * 1024);
        assertEquals([normalized.ranges === input, normalized.ranges[0] === input[0]], [false, false]);
        assertEquals([Object.getPrototypeOf(normalized.ranges), Object.getPrototypeOf(normalized.ranges[0])], [
          Array.prototype,
          Array.prototype,
        ]);
        const captureCharge = (source: CapturedKelReplay): number => {
          const batch = cues.prepare([{ kin: "replay", messages: source }]);
          const bytes = resources.used.bytes;
          batch.release();
          return bytes;
        };
        assertEquals(captureCharge(normalized), captureCharge(replay));
        assertThrows(() => new CapturedKelReplay(hby.db, [[hab.pre, 1, 0]], replay!.maxMessageBytes), RangeError);
        assertThrows(() => new CapturedKelReplay(hby.db, [[hab.pre, 0, 0]], 0), RangeError);
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
