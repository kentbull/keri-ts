import { ResourceLimitError, SerderKERI } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

Deno.test("replay sources reopen their captured extent without including later first-seen events", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `replay-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("alice");
      const said = hab.kever!.said;
      const replay = hby.db.replay(hab.pre);
      assertExists(replay);
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
