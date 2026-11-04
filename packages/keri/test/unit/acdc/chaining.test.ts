/** Shared chaining preserves source reductions while callers own state policy. */
import { type MapperMap, type SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { ensure, run } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { type ChainVerdict, evaluateChain } from "../../../src/acdc/chaining.ts";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { createHabery } from "../../../src/app/identity/habbing.ts";
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
