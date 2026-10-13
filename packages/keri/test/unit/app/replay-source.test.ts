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
      // Rebuilding a finite event must obey the caller's policy even though the aggregate is streamed.
      assertThrows(() => [...hby.db.replay(hab.pre, 0, { maxMessageBytes: 8 })!], ResourceLimitError);
      // Corrupt stored events still skip independently; resource-limit failures above must not disappear.
      hby.db.setEvt(dgKey(hab.pre, hab.kever!.said), Uint8Array.of(1));
      assertEquals([...hby.db.replay(hab.pre)!].length, 1);
    } finally {
      yield* hby.close(true);
    }
  });
});
