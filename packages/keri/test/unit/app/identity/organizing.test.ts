import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { Organizer, persistResolvedContact, signedContactJson } from "../../../../src/app/identity/organizing.ts";

Deno.test("Organizer borrows explicit store and signer while preserving unsigned reads", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const organizer = new Organizer(hby.db, hby.signator);
      organizer.update("remote", { alias: "Alice" });
      assertEquals(organizer.findExact("alias", "Alice"), [{ id: "remote", alias: "Alice" }]);
      const unsigned = new Organizer(hby.db, null);
      assertEquals(unsigned.get("remote"), organizer.get("remote"));
      const raw = signedContactJson(hby.db, "remote");
      assertThrows(() => unsigned.update("remote", { alias: "Bob" }), Error, "signator");
      assertEquals(signedContactJson(hby.db, "remote"), raw);
      hby.db.cons.pin(["remote"], JSON.stringify({ alias: "Tampered" }));
      assertThrows(() => organizer.get("remote"), Error, "failed signature");
      assertEquals(unsigned.get("remote"), { id: "remote", alias: "Tampered" });
    } finally {
      yield* hby.close(true);
    }
    const unsignedHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipSignator: true });
    try {
      persistResolvedContact(unsignedHby, "remote", { alias: "Alice" });
      assertEquals(unsignedHby.db.cons.get(["remote"]), null);
    } finally {
      yield* unsignedHby.close(true);
    }
  });
});
