/** Real KEL evidence exercises KERIpy PR 1757's isDelegated ancestry contract. */
import { Diger, SealSource, type SerderKERI } from "cesr-ts";
import { ensure, run } from "effection";
import { assertEquals, assertExists, assertNotEquals, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { delegationAncestry } from "../../../../src/core/kel/delegation-ancestry.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";

const seal = (pre: string) => ({ i: pre, s: "0", d: pre });

Deno.test("isDelegated climbs approved inceptions, waits for missing evidence, and never repairs aess", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root", undefined, { code: "F" });
    assertNotEquals(root.pre, root.kever!.said, "ordinary inception need not have i == d");
    const middle = hby.makeHab("middle", undefined, { delpre: root.pre });
    const child = hby.makeHab("child", undefined, { delpre: middle.pre });
    const dip = child.kever!.serder, key = dgKey(child.pre, child.pre);
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "pending");
    middle.interact({ data: [seal(child.pre)] });
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "pending");
    root.interact({ data: [seal(middle.pre)] });
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "valid");
    assertEquals(delegationAncestry(hby.db, child.pre, hby.makeHab("other").pre).kind, "refused");
    assertEquals(delegationAncestry(hby.db, root.pre, root.pre).kind, "refused", "identity is not delegation");

    hby.db.aess.rem(key);
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "valid");
    assertEquals(hby.db.aess.get(key), null, "verification must not repair the cache");
    hby.db.evts.rem(key);
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "pending");
    hby.db.evts.pin(key, dip);
    child.rotate(); // Protected local acceptance advances lastEst without a new approval.
    hby.db.kevers.clear(); // Exercise durable read-through, not a preloaded cache.
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "valid");
    const rootState = hby.db.getState(root.pre)!;
    hby.db.states.rem(root.pre);
    hby.db.kevers.delete(root.pre);
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "pending");
    hby.db.states.pin(root.pre, rootState);
  });
});

Deno.test("isDelegated requires the delegator's anchor at every hop and survives rotations", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    for (const missing of [0, 1, 2]) {
      const chain = [hby.makeHab(`root-${missing}`)];
      for (const name of ["child", "grandchild", "issuer"]) {
        chain.push(hby.makeHab(`${name}-${missing}`, undefined, { delpre: chain.at(-1)!.pre }));
      }
      const [root, , , issuer] = chain;
      for (let hop = 0; hop < 3; hop++) if (hop !== missing) chain[hop].interact({ data: [seal(chain[hop + 1].pre)] });
      assertEquals(delegationAncestry(hby.db, issuer.pre, root.pre).kind, "pending", `missing hop ${missing}`);
      chain[missing].interact({ data: [seal(chain[missing + 1].pre)] });
      assertEquals(delegationAncestry(hby.db, issuer.pre, root.pre).kind, "valid");
      root.rotate();
      chain[1].rotate();
      assertEquals(delegationAncestry(hby.db, issuer.pre, root.pre).kind, "valid", "rotations do not renew delegation");
    }
  });
});

Deno.test("isDelegated reads every delegator's inception DND after rotation", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root");
    const middle = hby.makeHab("middle", undefined, { delpre: root.pre, DnD: true });
    const child = hby.makeHab("child", undefined, { delpre: middle.pre });
    const grandchild = hby.makeHab("grandchild", undefined, { delpre: child.pre });
    root.interact({ data: [seal(middle.pre)] });
    middle.interact({ data: [seal(child.pre)] });
    child.interact({ data: [seal(grandchild.pre)] });
    assertEquals(delegationAncestry(hby.db, middle.pre, root.pre).kind, "valid", "a delegate's DND bars its children");
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "refused");
    assertEquals(delegationAncestry(hby.db, grandchild.pre, root.pre).kind, "refused");
    middle.rotate();
    hby.db.kevers.clear();
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "refused");

    const blocked = hby.makeHab("blocked", undefined, { DnD: true });
    const blockedChild = hby.makeHab("blocked-child", undefined, { delpre: blocked.pre });
    assertEquals(delegationAncestry(hby.db, blockedChild.pre, blocked.pre).kind, "refused", "DND precedes the anchor");
    blocked.interact({ data: [seal(blockedChild.pre)] });
    assertEquals(delegationAncestry(hby.db, blockedChild.pre, blocked.pre).kind, "refused");
  });
});

Deno.test("isDelegated ignores an unaccepted anchor candidate", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root"), child = hby.makeHab("child", undefined, { delpre: root.pre });
    root.interact({ data: [seal(child.pre)] });
    const approval = root.kever!.serder, key = dgKey(root.pre, approval.said!);
    hby.db.aess.rem(dgKey(child.pre, child.pre));
    const accepted = hby.db.fons.get(key)!;
    hby.db.fons.rem(key); // Stored and first-seen-indexed bytes without acceptance are only a candidate.
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "pending");
    hby.db.fons.pin(key, accepted);
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "valid");
  });
});

Deno.test("isDelegated recovers a first-seen superseded anchor without the source cache", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root"), child = hby.makeHab("child", undefined, { delpre: root.pre });
    root.interact({ data: [seal(child.pre)] });
    const approval = root.kever!.serder, key = dgKey(child.pre, child.pre);
    const source = hby.db.aess.get(key);
    assertExists(source);
    // Model supersession: the approval leaves the last-accepted KEL but stays first-seen history.
    hby.db.kels.remOn(root.pre, approval.sn!, approval.said!);
    assertEquals(hby.db.fetchLastSealingEventByEventSeal(root.pre, seal(child.pre)), null);
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "valid");
    hby.db.aess.rem(key);
    assertEquals(
      delegationAncestry(hby.db, child.pre, root.pre).kind,
      "valid",
      "uncached lookup reads first-seen history",
    );
    hby.db.aess.pin(key, source);
    const accepted = hby.db.fons.get(dgKey(root.pre, approval.said!))!;
    hby.db.fons.rem(dgKey(root.pre, approval.said!));
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "pending");
    hby.db.fons.pin(dgKey(root.pre, approval.said!), accepted);
    hby.db.evts.rem(dgKey(root.pre, approval.said!));
    assertThrows(() => delegationAncestry(hby.db, child.pre, root.pre), ValidationError, "Missing first-seen");
  });
});

Deno.test("isDelegated keeps accepted approval after the delegator's witness threshold changes", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const witness = hby.makeHab("witness", undefined, { transferable: false });
    const root = hby.makeHab("root"), child = hby.makeHab("child", undefined, { delpre: root.pre });
    root.interact({ data: [seal(child.pre)] });
    root.rotate({ adds: [witness.pre], toad: 1 });
    assertEquals(hby.db.getKever(root.pre)!.toader.num, 1n);
    hby.db.aess.rem(dgKey(child.pre, child.pre));
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "valid");
  });
});

Deno.test("Protected KEL intake cannot grant delegated authority through an unrelated source hint", async () => {
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
    assertEquals(delegationAncestry(receiver.db, child.pre, root.pre).kind, "pending");
    assertEquals(receiver.db.aess.get(key), before, "verification does not delete hostile hints");
    root.interact({ data: [seal(child.pre)] });
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
    assertEquals(delegationAncestry(receiver.db, child.pre, root.pre).kind, "valid");
    assertEquals(receiver.db.aess.get(key), before, "fallback approval lookup remains read-only");
  });
});

/** Seals any identifier can anchor in its own accepted KEL: an unknown shape and an event seal with junk values. */
const junkSeals = [{ nope: true }, { i: "junk", s: "zz", d: "junk" }];

Deno.test("isDelegated skips a delegator's unknown or malformed seals instead of throwing", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root"), child = hby.makeHab("child", undefined, { delpre: root.pre });
    root.interact({ data: junkSeals });
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "pending");
    root.interact({ data: [...junkSeals, seal(child.pre)] });
    hby.db.aess.rem(dgKey(child.pre, child.pre)); // Force the walk over every first-seen delegator event.
    assertEquals(delegationAncestry(hby.db, child.pre, root.pre).kind, "valid");
  });
});

Deno.test("A delegated inception is decided when its delegator anchored unknown or malformed seals", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => source.close(true));
    const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => receiver.close(true));
    // The remote delegator anchors junk in its own KEL, then names itself as the delegator of a new dip.
    const root = source.makeHab("root"), child = source.makeHab("child", undefined, { delpre: root.pre });
    root.interact({ data: junkSeals });
    const junk = root.kever!.serder;
    root.interact({ data: [...junkSeals, seal(child.pre)] });
    const approval = root.kever!.serder;
    const process = (serder: SerderKERI, sscs: SealSource[]) =>
      receiver.kevery.processEvent({
        serder,
        sigers: source.db.sigs.get(dgKey(serder.pre!, serder.said!)),
        wigers: [],
        frcs: [],
        ssts: [],
        sscs,
        local: false,
      });
    for (let sn = 0; sn <= 2; sn++) {
      assertEquals(
        process(source.db.getEvtSerder(root.pre, source.db.kels.getLast(root.pre, sn)!)!, []).kind,
        "accept",
      );
    }
    const hint = (event: SerderKERI) => SealSource.fromTuple([event.sner!, new Diger({ qb64: event.said! })]);
    // A source seal naming the junk event makes validation read its seals: no approval there, so it waits.
    assertEquals(process(child.kever!.serder, [hint(junk)]).kind, "escrow");
    // The approval carries the same junk ahead of the real seal; the junk is skipped and the seal still matches.
    assertEquals(process(child.kever!.serder, [hint(approval)]).kind, "accept");
    assertEquals(receiver.db.getKever(child.pre)?.delpre, root.pre);
  });
});
