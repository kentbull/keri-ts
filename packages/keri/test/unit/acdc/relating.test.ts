/** Real KEL evidence exercises the fixed-inception relation from KERIpy 84301a9f. */
import { Diger, SealSource } from "cesr-ts";
import { ensure, run } from "effection";
import { assertEquals, assertExists, assertNotEquals, assertThrows } from "jsr:@std/assert";
import { delegationRelation } from "../../../src/acdc/relating.ts";
import { createHabery } from "../../../src/app/identity/habbing.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

Deno.test("DI2I climbs approved inceptions, waits for missing evidence, and never repairs aess", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root", undefined, { code: "F" });
    assertNotEquals(root.pre, root.kever!.said, "ordinary inception need not have i == d");
    const middle = hby.makeHab("middle", undefined, { delpre: root.pre });
    const child = hby.makeHab("child", undefined, { delpre: middle.pre });
    const dip = child.kever!.serder, key = dgKey(child.pre, child.pre);
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "pending");
    middle.interact({ data: [{ i: child.pre, s: "0", d: child.pre }] });
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "pending");
    root.interact({ data: [{ i: middle.pre, s: "0", d: middle.pre }] });
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "valid");
    assertEquals(delegationRelation(hby.db, child.pre, hby.makeHab("other").pre).kind, "refused");

    hby.db.aess.rem(key);
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "valid");
    assertEquals(hby.db.aess.get(key), null, "verification must not repair the cache");
    hby.db.evts.rem(key);
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "pending");
    hby.db.evts.pin(key, dip);
    child.rotate(); // Protected local acceptance advances lastEst without a new approval.
    hby.db.kevers.clear(); // Exercise durable read-through, not a preloaded cache.
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "valid");
    const rootState = hby.db.getState(root.pre)!;
    hby.db.states.rem(root.pre);
    hby.db.kevers.delete(root.pre);
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "pending");
    hby.db.states.pin(root.pre, rootState);
  });
});

Deno.test("DI2I reads every delegator's inception DND after rotation", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root");
    const middle = hby.makeHab("middle", undefined, { delpre: root.pre, DnD: true });
    const child = hby.makeHab("child", undefined, { delpre: middle.pre });
    root.interact({ data: [{ i: middle.pre, s: "0", d: middle.pre }] });
    middle.interact({ data: [{ i: child.pre, s: "0", d: child.pre }] });
    assertEquals(delegationRelation(hby.db, middle.pre, root.pre).kind, "valid", "a delegate's DND bars its children");
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "refused");
    middle.rotate();
    hby.db.kevers.clear();
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "refused");
  });
});

Deno.test("DI2I retains cached first-seen approval but uncached lookup needs the current KEL", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root"), child = hby.makeHab("child", undefined, { delpre: root.pre });
    root.interact({ data: [{ i: child.pre, s: "0", d: child.pre }] });
    const approval = root.kever!.serder, key = dgKey(child.pre, child.pre);
    const source = hby.db.aess.get(key);
    assertExists(source);
    // Remove only current KEL membership; accepted first-seen history and the cached approval remain.
    hby.db.kels.remOn(root.pre, approval.sn!, approval.said!);
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "valid");
    hby.db.aess.rem(key);
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "pending");
    hby.db.aess.pin(key, source);
    const accepted = hby.db.fons.get(dgKey(root.pre, approval.said!))!;
    hby.db.fons.rem(dgKey(root.pre, approval.said!));
    assertEquals(delegationRelation(hby.db, child.pre, root.pre).kind, "pending");
    hby.db.fons.pin(dgKey(root.pre, approval.said!), accepted);
    hby.db.evts.rem(dgKey(root.pre, approval.said!));
    assertThrows(() => delegationRelation(hby.db, child.pre, root.pre), ValidationError, "Missing first-seen");
  });
});

Deno.test("Protected KEL intake cannot grant DI2I authority through an unrelated source hint", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => source.close(true));
    const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => receiver.close(true));
    const root = source.makeHab("root"), child = source.makeHab("child", undefined, { delpre: root.pre });
    const inception = root.kever!.serder;
    // Model protected controller ownership before accepting its delegated inception.
    receiver.db.prefixes.add(child.pre);
    receiver.db.pinHab(child.pre, source.db.getHab(child.pre)!);
    for (const hab of [root, child]) {
      const serder = hab.kever!.serder;
      const result = receiver.kevery.processEvent({
        serder,
        sigers: source.db.sigs.get(dgKey(hab.pre, serder.said!)),
        wigers: [],
        frcs: [],
        ssts: [],
        sscs: hab === child ? [SealSource.fromTuple([inception.sner!, new Diger({ qb64: inception.said! })])] : [],
        local: hab === child,
      });
      assertEquals(result.kind, "accept");
    }
    const key = dgKey(child.pre, child.pre), before = receiver.db.aess.get(key);
    assertExists(before, "protected intake actually persisted the unverified hint");
    assertEquals(delegationRelation(receiver.db, child.pre, root.pre).kind, "pending");
    assertEquals(receiver.db.aess.get(key), before, "verification does not delete hostile hints");
    root.interact({ data: [{ i: child.pre, s: "0", d: child.pre }] });
    const approval = root.kever!.serder;
    assertEquals(
      receiver.kevery.processEvent({
        serder: approval,
        sigers: source.db.sigs.get(dgKey(root.pre, approval.said!)),
        wigers: [],
        frcs: [],
        ssts: [],
        sscs: [],
        local: false,
      }).kind,
      "accept",
    );
    assertEquals(receiver.db.aess.get(key), before, "parent intake leaves an existing hint intact");
    assertEquals(delegationRelation(receiver.db, child.pre, root.pre).kind, "valid");
    assertEquals(receiver.db.aess.get(key), before, "fallback approval lookup remains read-only");
  });
});
