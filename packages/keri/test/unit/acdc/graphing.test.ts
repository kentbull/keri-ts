import { type MapperMap, SerderACDC } from "cesr-ts";
/** ACDC identity relations use independently verified KELs, including witness exemptions. */
import { ensure, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { type AcdcGraph, evaluateAcdcRelations } from "../../../src/acdc/graphing.ts";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { acceptedEventReplayMessage, createHabery, type Habery } from "../../../src/app/identity/habbing.ts";
import { Schemer } from "../../../src/core/scheming.ts";
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
        [["unsupported"], null],
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
    for (const aggregate of [false, true]) {
      const full = acdcmap(
        issuer,
        aggregate
          ? { aggregate: ["", { d: "", i: issuee, name: "far" }] }
          : { issuee, attribute: { d: "", name: "far" } },
      );
      const block = aggregate ? (full.sad!.A as MapperMap[])[1] : full.sad!.a as MapperMap;
      const hidden = new SerderACDC({
        sad: {
          ...full.sad!,
          ...(aggregate
            ? { A: [(full.sad!.A as unknown[])[0], block.d] }
            : { a: block.d }),
        },
        makify: true,
      });
      assertEquals(hidden.said, full.said, "visibility changes do not change the credential commitment");
      const malformed = acdcmap(
        issuer,
        aggregate
          ? { aggregate: ["", { d: "", i: 42, name: "far" }] }
          : { attribute: { d: "", i: 42, name: "far" } },
      );
      assertEquals(malformed.verify(), true, "malformed visible identity is representable");
      for (const view of [hidden, malformed]) {
        for (
          const [op, expected] of [[[], null], [["I2I"], null], [["DI2I"], null], [["NI2I"], true], [
            ["NOT", "NI2I"],
            false,
          ], [["E1E"], null]] as const
        ) {
          const near = acdcmap(issuer, {
            ...(view === malformed
              ? { attribute: { d: "", i: 42, name: "near" } }
              : { issuee, attribute: { d: "", name: "near" } }),
            edge: { d: "", link: { n: view.said, o: [...op] } },
          });
          const evidence: AcdcGraph = {
            nodes: new Map([[near.said!, { body: near }], [view.said!, { body: view }]]),
            order: [near.said!, view.said!],
            dependencyOrder: [view.said!, near.said!],
          };
          assertEquals(
            evaluateRelations(evidence, validator.db),
            expected,
            `${view === hidden ? "hidden" : "malformed"} Issuee ${aggregate ? "aggregate" : "attribute"}: ${op}`,
          );
          if (op.some((operator) => operator === "E1E")) {
            const hiddenNear = new SerderACDC({ sad: { ...near.sad!, a: (near.sad!.a as MapperMap).d }, makify: true });
            assertEquals(
              evaluateRelations({
                ...evidence,
                nodes: new Map([[near.said!, { body: hiddenNear }], [view.said!, {
                  body: view === hidden ? full : view,
                }]]),
              }, validator.db),
              null,
              "hidden near Issuee is unresolved too",
            );
          }
        }
      }
    }
  });
});

Deno.test("ACDC groups accumulate every schema pin and preserve unresolved Boolean members", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const issuer = hby.makeHab("issuer"), other = hby.makeHab("other");
    const far = acdcmap(issuer.pre, { issuee: other.pre, attribute: { d: "", name: "authority" } });
    const evaluate = (edge: MapperMap) => {
      const near = acdcmap(issuer.pre, { attribute: { d: "", name: "near" }, edge });
      return evaluateRelations({
        nodes: new Map([[near.said!, { body: near }], [far.said!, { body: far }]]),
        order: [near.said!, far.said!],
        dependencyOrder: [far.said!, near.said!],
      }, hby.db);
    };
    const pin = (name: string) =>
      new Schemer({
        sed: {
          $id: "",
          version: "1.0.0",
          type: "object",
          properties: { a: { properties: { name: { const: name } } } },
        },
      });
    const allow = pin("authority"), refuse = pin("another"), missing = pin("uncached");
    for (
      const [ancestor, expected] of [[allow.sed as MapperMap, true], [refuse.sed as MapperMap, false], [missing.said, {
        kind: "missing",
        said: missing.said,
      }], [false, null]] as const
    ) {
      assertEquals(
        evaluate({
          d: "",
          group: {
            s: ancestor,
            nested: { s: allow.sed as MapperMap, link: { n: far.said, s: allow.sed as MapperMap, o: "NI2I" } },
          },
        }),
        expected,
        "local pins cannot replace ancestor constraints",
      );
    }
    assertEquals(
      evaluate({ d: "", link: { n: far.said, s: (far.schema as MapperMap).$id, o: "NI2I" } }),
      true,
      "an inline own schema is available but still validates the payload",
    );
    for (const op of ["AND", "OR", "NAND", "NOR"]) {
      for (const allTrue of [false, true]) {
        const member = { n: far.said, o: allTrue ? "NI2I" : "I2I" };
        const expected = op === "AND" || op === "OR" ? allTrue : !allTrue;
        assertEquals(evaluate({ d: "", o: op, left: member, right: member }), expected, `${op} uniform operands`);
      }
      assertEquals(
        evaluate({ d: "", o: op, left: { n: far.said, o: "I2I" }, right: { n: far.said, o: "NI2I" } }),
        op === "OR" || op === "NAND",
      );
      for (const reverse of [false, true]) {
        const members = [{ n: far.said, o: "NI2I" }, { n: far.said, o: "UNKNOWN" }];
        if (reverse) members.reverse();
        assertEquals(
          evaluate({ d: "", o: op, first: members[0], second: members[1] }),
          null,
          `${op} cannot hide unknown in either order`,
        );
      }
    }
  });
});
