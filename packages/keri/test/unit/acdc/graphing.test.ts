/** ACDC identity relations use independently verified KELs, including witness exemptions. */
import { ensure, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { type AcdcGraph, evaluateAcdcRelations } from "../../../src/acdc/graphing.ts";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { acceptedEventReplayMessage, createHabery, type Habery } from "../../../src/app/identity/habbing.ts";
import { delegationChain, graph, learn, witnessed } from "../../fixtures/acdc-delegation.ts";

/** These relation fixtures are unregistered; signed grants exercise authentication separately. */
const evaluateRelations = (graph: AcdcGraph, db: Habery["db"]) => evaluateAcdcRelations(graph, db, new Map());

for (const depth of [0, 1, 2, 3]) {
  Deno.test(`DI2I admits identity and every approved delegation hop: depth ${depth}`, async () => {
    await run(function*() {
      const { validator, chain, approvals } = yield* delegationChain(depth);
      for (const wire of approvals) yield* learn(validator, wire);
      const evidence = graph(chain.at(-1)!.pre, chain[0].pre);
      const before = chain.map((hab) => validator.db.aess.get([hab.pre, hab.pre]));
      assertEquals(evaluateRelations(evidence, validator.db), true);
      assertEquals(
        chain.map((hab) => validator.db.aess.get([hab.pre, hab.pre])),
        before,
        "relation lookup is read-only",
      );
    });
  });
}

Deno.test("DI2I admits an approved chain in a disinterested validator", async () => {
  await run(function*() {
    const { source, chain, approvals } = yield* delegationChain(3);
    const ordinary = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => ordinary.close(true));
    for (const [i, hab] of chain.entries()) {
      yield* learn(ordinary, acceptedEventReplayMessage(source, hab.pre, 0).message, false);
      ordinary.kevery.processEscrows();
      assertExists(ordinary.db.getKever(hab.pre));
      if (i < approvals.length) yield* learn(ordinary, approvals[i], false);
    }
    assertEquals(evaluateRelations(graph(chain[3].pre, chain[0].pre), ordinary.db), true);
  });
});

for (const missing of [0, 1, 2]) {
  Deno.test(`DI2I retains a dependency for an unapproved witness-held hop: ${missing}`, async () => {
    await run(function*() {
      const { validator, chain, approvals } = yield* delegationChain(3);
      for (const [i, wire] of approvals.entries()) if (i !== missing) yield* learn(validator, wire);
      assertExists(validator.db.getKever(chain[missing + 1].pre), "witness acceptance is not delegator approval");
      const evidence = graph(chain[3].pre, chain[0].pre);
      assertEquals(evaluateRelations(evidence, validator.db), { kind: "missingKel", pre: chain[missing].pre });
      assertEquals(
        evaluateRelations(graph(chain[3].pre, chain[0].pre, ["NOT", "DI2I"]), validator.db),
        { kind: "missingKel", pre: chain[missing].pre },
        "NOT must not invert a missing delegation approval",
      );
      yield* learn(validator, approvals[missing]);
      assertEquals(evaluateRelations(evidence, validator.db), true, "the approval event alone closes the gap");
    });
  });
}

for (const dndAt of [0, 1]) {
  Deno.test(`DI2I rechecks the delegator inception DND despite witness acceptance: ${dndAt}`, async () => {
    await run(function*() {
      const { validator, chain, approvals } = yield* delegationChain(2, { dndAt });
      for (const wire of approvals) yield* learn(validator, wire);
      assertExists(validator.db.getKever(chain[2].pre));
      assertEquals(evaluateRelations(graph(chain[2].pre, chain[0].pre), validator.db), false);
    });
  });
}

Deno.test("DI2I distinguishes missing issuer/delegator KELs from unrelated or untargeted relationships", async () => {
  await run(function*() {
    const { source, validator, chain, approvals } = yield* delegationChain(1, { knownRoot: false });
    assertEquals(evaluateRelations(graph(chain[1].pre, chain[0].pre), validator.db), {
      kind: "missingKel",
      pre: chain[0].pre,
    });
    yield* learn(validator, acceptedEventReplayMessage(source, chain[0].pre, 0).message);
    yield* learn(validator, approvals[0]);
    const unrelated = source.makeHab("unrelated");
    assertEquals(evaluateRelations(graph(chain[1].pre, unrelated.pre), validator.db), false);
    assertEquals(evaluateRelations(graph(chain[1].pre, undefined), validator.db), false);
    assertEquals(evaluateRelations(graph(unrelated.pre, chain[0].pre), validator.db), {
      kind: "missingKel",
      pre: unrelated.pre,
    });
  });
});

Deno.test("DI2I reads the far aggregate issuee and survives an unapproved later delegated rotation", async () => {
  await run(function*() {
    const { source, validator, witness, chain, approvals } = yield* delegationChain(1);
    yield* learn(validator, approvals[0]);
    chain[1].rotate();
    yield* learn(validator, witnessed(source, witness, chain[1].kever!.serder));
    assertEquals(validator.db.getKever(chain[1].pre)?.sn, 1);
    assertEquals(
      validator.db.aess.get([chain[1].pre, chain[1].kever!.said]),
      null,
      "the rotation has no delegator approval",
    );
    assertEquals(evaluateRelations(graph(chain[1].pre, chain[0].pre, "DI2I", true), validator.db), true);
  });
});

Deno.test("DI2I requires the inception seal, not merely a signed delegator event", async () => {
  await run(function*() {
    const { source, validator, witness, chain } = yield* delegationChain(0);
    const root = chain[0];
    const delegate = source.makeHab("delegate", undefined, { delpre: root.pre, wits: [witness.pre], toad: 1 });
    yield* learn(validator, witnessed(source, witness, delegate.kever!.serder));
    root.interact({ data: [{ i: delegate.pre, s: "1", d: delegate.pre }] });
    yield* learn(validator, witnessed(source, witness, root.kever!.serder));
    const evidence = graph(delegate.pre, root.pre);
    assertEquals(evaluateRelations(evidence, validator.db), { kind: "missingKel", pre: root.pre });
    root.interact({ data: [{ i: delegate.pre, s: "0", d: delegate.pre }] });
    yield* learn(validator, witnessed(source, witness, root.kever!.serder));
    assertEquals(evaluateRelations(evidence, validator.db), true);
  });
});

Deno.test("DI2I inception approval survives the delegator's later witness change", async () => {
  await run(function*() {
    const { source, validator, witness, chain, approvals } = yield* delegationChain(1);
    yield* learn(validator, approvals[0]);
    chain[0].rotate({ adds: [witness.pre], toad: 1 });
    yield* learn(validator, witnessed(source, witness, chain[0].kever!.serder));
    assertEquals(validator.db.getKever(chain[0].pre)?.toader.num, 1n);
    assertEquals(evaluateRelations(graph(chain[1].pre, chain[0].pre), validator.db), true);
  });
});

Deno.test("IPEX identity operators use wire order and targeted defaults", async () => {
  await run(function*() {
    const { validator, chain, approvals } = yield* delegationChain(1);
    yield* learn(validator, approvals[0]);
    const issuer = chain[1].pre, issuee = chain[0].pre;
    for (
      const [ops, result] of [
        [["I2I", "DI2I"], true],
        [["DI2I", "I2I"], false],
        [["I2I", "NI2I"], true],
        [["NI2I", "I2I"], false],
        [[], false],
        [["unsupported"], false],
      ] as const
    ) assertEquals(evaluateRelations(graph(issuer, issuee, [...ops]), validator.db), result, ops.join(","));
    assertEquals(evaluateRelations(graph(issuer, undefined, []), validator.db), true);
    assertEquals(evaluateRelations(graph(issuer, issuee, null), validator.db), false);
    assertEquals(evaluateRelations(graph(issuer, undefined, null), validator.db), true);
    assertEquals(evaluateRelations(graph(issuer, undefined, ""), validator.db), true);
  });
});

Deno.test("E1E keeps entity matching independent from explicit issuer identity constraints", async () => {
  await run(function*() {
    const { validator, chain, approvals } = yield* delegationChain(1);
    yield* learn(validator, approvals[0]);
    const issuer = chain[1].pre, issuee = chain[0].pre;
    const far = acdcmap(issuer, { issuee, attribute: { d: "", name: "far" } });
    for (
      const [operators, expected] of [
        [["E1E"], true],
        [["E1E", "I2I"], false],
        [["E1E", "DI2I"], true],
      ] as const
    ) {
      const near = acdcmap(issuer, {
        issuee,
        attribute: { d: "", name: "near" },
        edge: { d: "", link: { n: far.said, o: [...operators] } },
      });
      const evidence: AcdcGraph = {
        nodes: new Map([[near.said!, { body: near }], [far.said!, { body: far }]]),
        order: [near.said!, far.said!],
        dependencyOrder: [far.said!, near.said!],
      };
      assertEquals(evaluateRelations(evidence, validator.db), expected);
    }
  });
});
