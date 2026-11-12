/** Shared chaining preserves source reductions while callers own state policy. */
import { type MapperMap, SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { ensure, run } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { type ChainVerdict, evaluateChain, walkAcdcGraph } from "../../../src/acdc/chaining.ts";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { createHabery } from "../../../src/app/identity/lmdb-habery.ts";
import { walkIpexGraph } from "../../../src/app/ipex/ipex-graph.ts";
import { authenticatedNodeVerdict, issuedNodeVerdict } from "../../../src/app/ipex/ipex-node-authentication.ts";
import { Schemer } from "../../../src/core/scheming.ts";

Deno.test("DI2I composes fixed-inception authority with pins, far-node truth and OR alternatives", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const authority = hby.makeHab("authority");
    const delegate = hby.makeHab("delegate", undefined, { delpre: authority.pre });
    const far = acdcmap(authority.pre, { attribute: { d: "", i: authority.pre } });
    const untargeted = acdcmap(authority.pre, { attribute: { d: "", role: "untargeted" } });
    const badPin = new Schemer({ sed: { $id: "", type: "object", properties: { i: { const: "wrong" } } } });
    /** Build real credential views; only node authentication is caller-owned input to this evaluator. */
    const evaluate = (
      issuer: string,
      target: SerderACDC,
      options: { pin?: MapperMap; alternative?: boolean; farValid?: boolean; operator?: string[] } = {},
    ) => {
      const root = acdcmap(issuer, {
        attribute: { d: "", role: "near" },
        edge: {
          d: "",
          o: options.alternative ? "OR" : "AND",
          link: { n: target.said, o: options.operator ?? "DI2I", ...(options.pin ? { s: options.pin } : {}) },
          ...(options.alternative ? { other: { n: target.said, o: "NI2I" } } : {}),
        },
      });
      const graph = {
        nodes: new Map([root, target].map(body => [body.said!, { body }])),
        order: [root.said!, target.said!],
      };
      return evaluateChain(
        graph,
        new Map<string, ChainVerdict>([
          [root.said!, { kind: "valid" }],
          [target.said!, { kind: options.farValid === false ? "invalid" : "valid" }],
        ]),
        hby.db,
      );
    };
    assertEquals(evaluate(authority.pre, far)?.kind, "valid", "identity is the I2I arm of DI2I");
    assertEquals(evaluate(delegate.pre, untargeted)?.kind, "invalid");
    const pending = evaluate(delegate.pre, far);
    assert(pending?.kind === "unknown" && pending.retryable);
    assertEquals(evaluate(delegate.pre, far, { pin: badPin.sed as MapperMap })?.kind, "invalid");
    assertEquals(evaluate(delegate.pre, far, { alternative: true })?.kind, "valid");
    assertEquals(evaluate(delegate.pre, far, { farValid: false })?.kind, "invalid");
    authority.interact({ data: [{ i: delegate.pre, s: "0", d: delegate.pre }] });
    assertEquals(evaluate(delegate.pre, far)?.kind, "valid");
    assertEquals(evaluate(delegate.pre, far, { operator: ["I2I", "DI2I"] })?.kind, "valid");
    assertEquals(evaluate(delegate.pre, far, { operator: ["DI2I", "I2I"] })?.kind, "invalid");
    assertEquals(evaluate(delegate.pre, far, { operator: ["DI2I", "NOT"] })?.kind, "unknown");
    assertEquals(
      evaluate(delegate.pre, far, { operator: ["I2I", "NOT"] })?.kind,
      "invalid",
      "NOT never short-circuits",
    );
  });
});

/** Walk then evaluate real views with authenticated nodes; null is malformed at either seam. */
function walked(db: Parameters<typeof evaluateChain>[2], root: SerderACDC, ...far: SerderACDC[]) {
  const nodes = new Map([root, ...far].map((body) => [body.said!, { body }]));
  const order = walkAcdcGraph(root.said!, nodes, true);
  if (!order) return null;
  return evaluateChain({ nodes, order }, new Map(order.map((said) => [said, { kind: "valid" } as ChainVerdict])), db);
}
/** Replace a carried commitment without makify recomputing it. */
function falseCommitment(body: SerderACDC, said: string, replacement: string): SerderACDC {
  const raw = new TextEncoder().encode(new TextDecoder().decode(body.raw).replace(said, replacement));
  return new SerderACDC({ raw, verify: false });
}

Deno.test("I1I and DI1I compose, suppress defaults, and preserve retryability", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const root = hby.makeHab("root"), unrelated = hby.makeHab("unrelated");
    const issuee = hby.makeHab("issuee"), otherIssuee = hby.makeHab("other-issuee");
    const delegate = hby.makeHab("delegate", undefined, { delpre: root.pre });
    const missingAnchor = hby.makeHab("missing-anchor", undefined, { delpre: root.pre });
    const rootFar = acdcmap(root.pre, { attribute: { d: "", role: "far" } });
    const unrelatedFar = acdcmap(unrelated.pre, { attribute: { d: "", role: "far" } });
    const targetedFar = acdcmap(root.pre, { attribute: { d: "", role: "targeted-far" }, issuee: issuee.pre });
    const evaluate = (
      issuer: string,
      far: SerderACDC,
      o: unknown,
      options: { issuee?: string; schema?: string } = {},
    ) => {
      const near = acdcmap(issuer, {
        attribute: { d: "", role: "near" },
        issuee: options.issuee,
        edge: {
          d: "",
          source: { d: "", n: far.said!, o, ...(options.schema ? { s: options.schema } : {}) } as MapperMap,
        },
      });
      return walked(hby.db, near, far);
    };
    const pending = (verdict: ChainVerdict | null, retryable: boolean) =>
      assert(verdict?.kind === "unknown" && verdict.retryable === retryable, JSON.stringify(verdict));

    assertEquals(evaluate(root.pre, rootFar, "I1I")?.kind, "valid");
    assertEquals(evaluate(unrelated.pre, rootFar, "I1I")?.kind, "invalid");
    assertEquals(evaluate(root.pre, rootFar, "DI1I")?.kind, "valid", "DI1I accepts equality");
    pending(evaluate(delegate.pre, rootFar, "DI1I"), true);
    pending(evaluate(delegate.pre, rootFar, ["FOO", "DI1I"]), false);
    root.interact({ data: [{ i: delegate.pre, s: "0", d: delegate.pre }] });
    assertEquals(evaluate(delegate.pre, rootFar, "DI1I")?.kind, "valid");
    assertEquals(evaluate(delegate.pre, unrelatedFar, "DI1I")?.kind, "invalid");
    // The issuer-identity group is latest-wins.
    assertEquals(evaluate(delegate.pre, rootFar, ["DI1I", "I1I"])?.kind, "invalid");
    assertEquals(evaluate(delegate.pre, rootFar, ["I1I", "DI1I"])?.kind, "valid");
    // Explicit I1I suppresses the targeted far node's I2I default and never reads issuees.
    assertEquals(evaluate(root.pre, targetedFar, "I1I")?.kind, "valid");
    assertEquals(evaluate(root.pre, targetedFar, ["NI2I", "I1I"])?.kind, "valid");
    assertEquals(evaluate(root.pre, targetedFar, ["I2I", "I1I"])?.kind, "invalid", "independent groups both apply");
    assertEquals(evaluate(issuee.pre, targetedFar, ["I2I", "DI1I"])?.kind, "invalid");
    assertEquals(evaluate(root.pre, targetedFar, ["E1E", "I1I"], { issuee: issuee.pre })?.kind, "valid");
    assertEquals(evaluate(root.pre, targetedFar, ["E1E", "I1I"], { issuee: otherIssuee.pre })?.kind, "invalid");
    assertEquals(evaluate(root.pre, targetedFar, ["E1E", "DI1I", "NI2I"], { issuee: issuee.pre })?.kind, "valid");
    // Unrecognized operators are ANDed and never weaken a proven failure.
    assertEquals(evaluate(unrelated.pre, rootFar, ["BOGUS", "I1I"])?.kind, "invalid");
    assertEquals(evaluate(root.pre, targetedFar, "BOGUS")?.kind, "invalid", "the default still applies");
    pending(evaluate(root.pre, rootFar, ["BOGUS", "I1I"]), false);
    pending(evaluate(root.pre, rootFar, ["NOT", "I1I"]), false);
    assertEquals(evaluate(unrelated.pre, rootFar, ["NOT", "I1I"])?.kind, "invalid");
    // Pins, decided failures over retryable evidence and malformed operator lists.
    const ownSchema = (rootFar.schema as MapperMap).$id as string;
    assertEquals(evaluate(root.pre, rootFar, "I1I", { schema: ownSchema })?.kind, "valid");
    assertEquals(
      evaluate(missingAnchor.pre, targetedFar, ["E1E", "DI1I"], { issuee: otherIssuee.pre })?.kind,
      "invalid",
    );
    assertEquals(evaluate(root.pre, rootFar, ["I1I", 1]), null);
  });
});

Deno.test("Edge Sections are one expanded group or an opaque compact commitment", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const issuer = hby.makeHab("issuer").pre;
    const far = acdcmap(issuer, { attribute: { d: "", role: "far" } });
    const other = acdcmap(issuer, { attribute: { d: "", role: "other" } });
    const near = (edge: unknown) => acdcmap(issuer, { attribute: { d: "", role: "near" }, edge: edge as MapperMap });
    const source = { d: "", n: far.said!, o: "I1I" };
    const expanded = near({ d: "", source });

    assertEquals(walked(hby.db, near({})), { kind: "valid" }, "an empty section carries no requirements");
    const hidden = acdcmap(issuer, { attribute: { d: "", role: "near" }, edge: { d: "", source }, compactify: true });
    const compact = near(hidden.sad!.e);
    const nodes = new Map([[compact.said!, { body: compact }]]);
    assertEquals(walkAcdcGraph(compact.said!, nodes, true), [compact.said!], "compact sections are terminals");
    const verdict = walked(hby.db, compact);
    assert(verdict?.kind === "unknown" && !verdict.retryable, "hidden logic cannot be evaluated or retried");
    for (const malformed of ["", "garbage", [], [{ source }], null, 0, false]) {
      const body = new SerderACDC({ sad: { ...expanded.sad!, e: malformed }, makify: true });
      assertEquals(walked(hby.db, body, far), null, JSON.stringify(malformed));
    }
    assertEquals(walked(hby.db, near(source), far), null, "the top-level section is a group, not a leaf");
    assertEquals(walked(hby.db, near({ d: "", w: 1, source }), far), null, "a top-level group has no weight");
    assertEquals(walked(hby.db, near({ d: "", o: "OR", source, compact: "garbage" }), far), null);
    // Carried section and nested-block SAIDs are re-verified by the walk.
    const e = expanded.sad!.e as { d: string; source: { d: string } };
    for (const carried of [e.d, e.source.d]) {
      assertEquals(walked(hby.db, falseCommitment(expanded, carried, other.said!), far), null);
    }
    assertEquals(walked(hby.db, expanded, far), { kind: "valid" });
  });
});

Deno.test("Every schema pin is evaluated unless the relation is already invalid", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const issuer = hby.makeHab("issuer").pre, other = hby.makeHab("other").pre;
    const far = acdcmap(issuer, { attribute: { d: "", name: "Ada" } });
    const missing = new Schemer({ sed: { $id: "", version: "1.0.0", type: "object" } });
    const wrong = new Schemer({
      sed: { $id: "", version: "1.0.0", type: "object", properties: { a: { properties: { name: { const: "Bob" } } } } },
    });
    const near = (nearIssuer: string) =>
      acdcmap(nearIssuer, {
        attribute: { d: "", role: "near" },
        edge: { d: "", group: { s: missing.said, link: { n: far.said!, o: "I1I", s: wrong.sed as MapperMap } } },
      });
    assertEquals(walked(hby.db, near(issuer), far), { kind: "invalid" }, "a later invalid pin outranks a missing one");
    assertEquals(walked(hby.db, near(other), far), { kind: "invalid" });
    const valid = acdcmap(issuer, {
      attribute: { d: "", role: "near" },
      edge: { d: "", group: { s: missing.said, link: { n: far.said!, o: "I1I" } } },
    });
    assertEquals(walked(hby.db, valid, far), {
      kind: "unknown",
      retryable: true,
      reason: `Missing edge schema ${missing.said}.`,
      schemas: [missing.said],
    });
  });
});

Deno.test("Shared chaining evaluates cross-links independently of BFS disclosure order", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const issuer = hby.makeHab("issuer");
    const tail = acdcmap(issuer.pre, { attribute: { d: "", name: "tail" } });
    const left = acdcmap(issuer.pre, {
      attribute: { d: "", name: "left" },
      edge: { d: "", link: { n: tail.said, o: "NI2I" } },
    });
    const right = acdcmap(issuer.pre, {
      attribute: { d: "", name: "right" },
      edge: { d: "", link: { n: left.said, o: "NI2I" } },
    });
    const root = acdcmap(issuer.pre, {
      attribute: { d: "", name: "root" },
      edge: { d: "", left: { n: left.said, o: "NI2I" }, right: { n: right.said, o: "NI2I" } },
    });
    const graph = walkIpexGraph(
      root.said!,
      [root, left, right, tail].map((body) => ({
        body,
        attachments: [],
        gvrsn: Vrsn_2_0,
      })),
      true,
    );
    assertExists(graph);
    assert(!("kind" in graph));
    assertEquals(graph.order, [root.said!, left.said!, right.said!, tail.said!]);
    const verdicts = new Map(graph.order.map((said) => [said, { kind: "valid" } as ChainVerdict]));
    assertEquals(evaluateChain(graph, verdicts, hby.db), { kind: "valid" });
    verdicts.set(tail.said!, { kind: "invalid" });
    assertEquals(evaluateChain(graph, verdicts, hby.db), { kind: "invalid" });
  });
});

for (const op of ["AND", "OR"] as const) {
  for (const other of ["invalid", "retryable", "permanent"] as const) {
    Deno.test(`Shared ${op} reduces a valid branch with ${other} evidence`, async () => {
      await run(function*() {
        const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
        yield* ensure(() => hby.close(true));
        const issuer = hby.makeHab("issuer");
        const good = acdcmap(issuer.pre, { attribute: { d: "", name: "good" } });
        const optional = acdcmap(issuer.pre, { attribute: { d: "", name: "optional" } });
        const root = acdcmap(issuer.pre, {
          attribute: { d: "", name: "root" },
          edge: { d: "", o: op, good: { n: good.said }, optional: { n: optional.said } },
        });
        const frames = [root, good, optional].map(body => ({ body, attachments: [], gvrsn: Vrsn_2_0 }));
        const graph = walkIpexGraph(root.said!, frames, true);
        assertExists(graph);
        const verdicts = new Map(graph.order.map(said => [said, { kind: "valid" } as ChainVerdict]));
        const unresolved: ChainVerdict = other === "invalid"
          ? { kind: "invalid" }
          : { kind: "unknown", retryable: other === "retryable", reason: "Unavailable issuer evidence.", schemas: [] };
        verdicts.set(optional.said!, unresolved);
        assertEquals(evaluateChain(graph, verdicts, hby.db), op === "OR" ? { kind: "valid" } : unresolved);
        verdicts.set(root.said!, { kind: "invalid" });
        assertEquals(evaluateChain(graph, verdicts, hby.db), { kind: "invalid" }, "origin verdict is always required");
      });
    });
  }
}

Deno.test("Shared OR cannot hide malformed shape or missing/invalid own schemas", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const issuer = hby.makeHab("issuer");
    const good = acdcmap(issuer.pre, { attribute: { d: "", name: "good" } });
    const schema = new Schemer({
      sed: {
        $id: "",
        version: "1.0.0",
        type: "object",
        properties: { a: { properties: { name: { const: "required" } } } },
      },
    });
    const invalid = acdcmap(issuer.pre, { schema: schema.sed as MapperMap, attribute: { d: "", name: "wrong" } });
    const missing = acdcmap(issuer.pre, { schema: schema.said, attribute: { d: "", name: "required" } });
    for (
      const bad of [
        invalid,
        acdcmap(issuer.pre, { attribute: { d: "", name: "malformed" }, edge: { d: "", o: "OR" } }),
        missing,
      ]
    ) {
      const root = acdcmap(issuer.pre, {
        attribute: { d: "", name: "root" },
        edge: { d: "", o: "OR", good: { n: good.said }, bad: { n: bad.said } },
      });
      const graph = walkIpexGraph(
        root.said!,
        [root, good, bad].map(body => ({ body, attachments: [], gvrsn: Vrsn_2_0 })),
        true,
      );
      assertExists(graph);
      assertEquals(
        evaluateChain(graph, new Map(graph.order.map(said => [said, { kind: "valid" } as ChainVerdict])), hby.db),
        bad === missing
          ? { kind: "unknown", retryable: true, reason: `Missing node schema ${schema.said}.`, schemas: [schema.said] }
          : null,
      );
    }
  });
});

Deno.test("Issued-state policy differs from protocol authentication without changing reductions", () => {
  const registration = {
    regid: "registry",
    issuer: "issuer",
    said: "head",
    sn: 1n,
    ilk: "bup" as const,
    acdc: "credential",
    state: "issued",
    stamp: "2026-11-03T00:00:00.000000+00:00",
    binding: "mutual" as const,
    anchors: [],
  };
  for (const state of ["issued", "revoked", "custom", null]) {
    const auth = { kind: "authenticated" as const, registration: { ...registration, state } };
    assertEquals(authenticatedNodeVerdict(auth), { kind: "valid" });
    assertEquals(
      issuedNodeVerdict(auth).kind,
      state === "issued" ? "valid" : state === "revoked" ? "invalid" : "unknown",
    );
  }
  assertEquals(issuedNodeVerdict({ kind: "authenticated", registration: null }), { kind: "valid" });
  assertEquals(issuedNodeVerdict({ kind: "reject" }), { kind: "invalid" });
  assertEquals(issuedNodeVerdict({ kind: "missing", reason: "issuer" }), {
    kind: "unknown",
    retryable: true,
    reason: "issuer",
    schemas: [],
  });
});
