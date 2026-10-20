import { run } from "effection";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertObjectMatch,
  assertStrictEquals,
  assertThrows,
} from "jsr:@std/assert";
import {
  Dater,
  Diger,
  Ilks,
  NumberPrimitive,
  NumDex,
  Prefixer,
  SerderACDC,
  Signer,
} from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Verifier, type VerifierCue, type VerifierDecision } from "../../../src/app/verifying.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { consoleLogger } from "../../../src/core/logger.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { createReger, type Reger } from "../../../src/db/reger.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";

const textEncoder = new TextEncoder();

class FakeTever {
  readonly states = new Map<string, { et: string; dt: string }>();

  vcState(vcid: string): { et: string; dt: string } | null {
    return this.states.get(vcid) ?? null;
  }
}

function schemaSed(
  { requiredRole = false, requiredIssuee = true }: {
    requiredRole?: boolean;
    requiredIssuee?: boolean;
  } = {},
): Record<string, unknown> {
  const attribRequired = [
    ...(requiredIssuee ? ["i"] : []),
    ...(requiredRole ? ["role"] : []),
  ];
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["v", "d", "i", "ri", "s", "a"],
    properties: {
      v: { type: "string" },
      d: { type: "string" },
      i: { type: "string" },
      ri: { type: "string" },
      s: { type: "string" },
      a: {
        type: "object",
        ...(attribRequired.length > 0 ? { required: attribRequired } : {}),
        properties: {
          i: { type: "string" },
          role: { type: "string" },
        },
      },
      e: { type: "object" },
    },
  };
}

function makePrefixer(): Prefixer {
  const signer = Signer.random({ transferable: true });
  return new Prefixer({ code: "D", raw: signer.verfer.raw });
}

function ordinal(num: number): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

function digestFor(label: string): Diger {
  const raw = textEncoder.encode(label);
  return new Diger({ code: "E", raw: Diger.digest(raw, "E") });
}

function makeCredential(args: {
  issuer: string;
  registry: string;
  schema: string;
  attrib?: Record<string, unknown>;
  edge?: Record<string, unknown>;
}): SerderACDC {
  return new SerderACDC({
    sad: {
      v: "ACDC10JSON000000_",
      d: "",
      i: args.issuer,
      ri: args.registry,
      s: args.schema,
      a: args.attrib ?? { i: args.issuer, role: "holder" },
      ...(args.edge ? { e: args.edge } : {}),
    },
    makify: true,
  });
}

function anchorArgs(creder: SerderACDC, issuer: Prefixer) {
  return {
    creder,
    prefixer: issuer,
    seqner: ordinal(0),
    saider: new Diger({ qb64: creder.said! }),
  };
}

function setState(
  reger: Reger,
  registry: string,
  said: string,
  et: string = Ilks.iss,
): void {
  let tever = reger.tevers.get(registry) as FakeTever | undefined;
  if (!tever) {
    tever = new FakeTever();
    reger.tevers.set(registry, tever);
  }
  tever.states.set(said, { et, dt: makeNowIso8601() });
}

function assertDecision(
  decision: VerifierDecision,
  kind: VerifierDecision["kind"],
  reason?: string,
): void {
  const detail = JSON.stringify(decision);
  assertEquals(decision.kind, kind, detail);
  if ("reason" in decision) {
    assertEquals(decision.reason, reason, detail);
  }
}

Deno.test("Verifier saves direct revoked credentials and KERIpy indexes", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `verifier-save-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const reger = yield* createReger({
      name: `verifier-save-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const registry = digestFor("registry-save").qb64;
      const schemer = new Schemer({ sed: schemaSed() });
      hby.db.schema.pin(schemer.said, schemer);
      const creder = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
      });
      setState(reger, registry, creder.said!, Ilks.rev);

      const verifier = new Verifier(hby, { reger });
      const decision = verifier.processCredential(anchorArgs(creder, issuer));

      assertDecision(decision, "accept");
      assertEquals(reger.saved.get([creder.said!])?.qb64, creder.said);
      assertEquals(reger.issus.get([issuer.qb64]).map((saider) => saider.qb64), [creder.said]);
      assertEquals(reger.schms.get([schemer.said]).map((saider) => saider.qb64), [creder.said]);
      assertEquals(reger.subjs.get([issuer.qb64]).map((saider) => saider.qb64), [creder.said]);
      assertEquals(verifier.cues.peekTail()?.kin, "saved");
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Verifier escrows missing registry and emits telquery cue", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `verifier-mre-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const reger = yield* createReger({
      name: `verifier-mre-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const registry = digestFor("registry-mre").qb64;
      const schemer = new Schemer({
        sed: schemaSed({ requiredIssuee: false }),
      });
      const creder = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
      });

      const verifier = new Verifier(hby, { reger });
      const decision = verifier.processCredential(anchorArgs(creder, issuer));

      assertDecision(decision, "escrow", "missingRegistry");
      assertExists(reger.mre.get([creder.said!]));
      assertEquals(verifier.cues.peekTail(), {
        kin: "telquery",
        q: { ri: registry, i: creder.said!, issr: issuer.qb64 },
      });
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Verifier replays missing schema escrow after schema arrives", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `verifier-mse-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const reger = yield* createReger({
      name: `verifier-mse-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const registry = digestFor("registry-mse").qb64;
      const schemer = new Schemer({
        sed: schemaSed({ requiredIssuee: false }),
      });
      const creder = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
      });
      setState(reger, registry, creder.said!, Ilks.iss);

      const verifier = new Verifier(hby, { reger });
      assertDecision(
        verifier.processCredential(anchorArgs(creder, issuer)),
        "escrow",
        "missingSchema",
      );
      assertExists(reger.mse.get([creder.said!]));

      hby.db.schema.pin(schemer.said, schemer);
      verifier.processEscrows();

      assertEquals(reger.mse.get([creder.said!]), null);
      assertEquals(reger.saved.get([creder.said!])?.qb64, creder.said);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Verifier escrows missing chains and rejects revoked chains", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `verifier-chain-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const reger = yield* createReger({
      name: `verifier-chain-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const registry = digestFor("registry-chain").qb64;
      const schemer = new Schemer({
        sed: schemaSed({ requiredIssuee: false }),
      });
      hby.db.schema.pin(schemer.said, schemer);
      const child = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
      });
      const parent = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
        edge: { child: { n: child.said } },
      });
      setState(reger, registry, parent.said!, Ilks.iss);
      setState(reger, registry, child.said!, Ilks.rev);

      const verifier = new Verifier(hby, { reger });
      assertDecision(
        verifier.processCredential(anchorArgs(parent, issuer)),
        "escrow",
        "missingChain",
      );
      assertExists(reger.mce.get([parent.said!]));
      assertEquals(verifier.cues.peekTail(), { kin: "proof", said: child.said! });

      assertDecision(verifier.processCredential(anchorArgs(child, issuer)), "accept");
      assertDecision(
        verifier.processCredential(anchorArgs(parent, issuer)),
        "reject",
        "revokedChain",
      );
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Verifier supports NI2I chain default when child has no issuee", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `verifier-ni2i-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const reger = yield* createReger({
      name: `verifier-ni2i-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const registry = digestFor("registry-ni2i").qb64;
      const schemer = new Schemer({
        sed: schemaSed({ requiredIssuee: false }),
      });
      hby.db.schema.pin(schemer.said, schemer);
      const child = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
        attrib: { role: "root" },
      });
      const parent = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
        edge: { child: { n: child.said } },
      });
      setState(reger, registry, child.said!, Ilks.iss);
      setState(reger, registry, parent.said!, Ilks.iss);

      const verifier = new Verifier(hby, { reger });
      assertDecision(verifier.processCredential(anchorArgs(child, issuer)), "accept");
      assertDecision(verifier.processCredential(anchorArgs(parent, issuer)), "accept");
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Verifier rejects DI2I chains explicitly", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `verifier-di2i-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const reger = yield* createReger({
      name: `verifier-di2i-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const issuer = makePrefixer();
      const registry = digestFor("registry-di2i").qb64;
      const schemer = new Schemer({ sed: schemaSed() });
      hby.db.schema.pin(schemer.said, schemer);
      const child = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
      });
      const parent = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: schemer.said,
        edge: { child: { n: child.said, o: "DI2I" } },
      });
      setState(reger, registry, child.said!, Ilks.iss);
      setState(reger, registry, parent.said!, Ilks.iss);

      const verifier = new Verifier(hby, { reger });
      assertDecision(verifier.processCredential(anchorArgs(child, issuer)), "accept");
      assertDecision(
        verifier.processCredential(anchorArgs(parent, issuer)),
        "reject",
        "unsupportedChainOperator",
      );
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Verifier publishes saved and dependency cues with credential or escrow writes", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `verifier-cues-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const reger = yield* createReger({ name: `verifier-cues-${crypto.randomUUID()}`, temp: true });
    try {
      const issuer = makePrefixer();
      for (const branch of ["registry", "state", "staleState", "schema", "chain", "staleChain", "saved"] as const) {
        const schema = new Schemer({ sed: schemaSed({ requiredIssuee: false }) });
        if (branch === "schema") hby.db.schema.rem(schema.said);
        else hby.db.schema.pin(schema.said, schema);
        const registry = digestFor(branch).qb64;
        const child = makeCredential({ issuer: issuer.qb64, registry, schema: schema.said });
        const creder = makeCredential({
          issuer: issuer.qb64,
          registry,
          schema: schema.said,
          attrib: { i: issuer.qb64, role: branch },
          ...((branch === "chain" || branch === "staleChain") ? { edge: { child: { n: child.said } } } : {}),
        });
        if (branch === "state") reger.tevers.set(registry, new FakeTever());
        else if (branch !== "registry") setState(reger, registry, creder.said!, Ilks.rev);
        if (branch === "staleState") {
          (reger.tevers.get(registry) as FakeTever).states.get(creder.said!)!.dt = "2000-01-01T00:00:00Z";
        }
        const cues = new Deck<AgentCue>();
        const verifier = new Verifier(hby, { reger, cues, credentialExpiryMs: 60_000 });
        if (branch === "staleChain") {
          verifier.saveCredential(anchorArgs(child, issuer));
          setState(reger, registry, child.said!);
          (reger.tevers.get(registry) as FakeTever).states.get(child.said!)!.dt = "2000-01-01T00:00:00Z";
        }
        const decision = verifier.processCredential(anchorArgs(creder, issuer));
        const reason = branch === "schema"
          ? "missingSchema"
          : branch === "chain" || branch === "staleChain"
          ? "missingChain"
          : "missingRegistry";
        assertDecision(decision, branch === "saved" ? "accept" : "escrow", branch === "saved" ? undefined : reason);
        const expected: VerifierCue = branch === "saved"
          ? { kin: "saved", creder }
          : branch === "schema"
          ? { kin: "query", q: { r: "schema", said: schema.said } }
          : branch === "chain"
          ? { kin: "proof", said: child.said! }
          : branch === "staleChain"
          ? { kin: "query", q: { r: "tels", pre: child.said! } }
          : {
            kin: "telquery",
            q: { ri: registry, i: creder.said!, ...(branch === "registry" ? { issr: issuer.qb64 } : {}) },
          };
        assertEquals(cues.pull(), expected);
        if (branch === "saved") {
          assertEquals(reger.saved.get([creder.said!])?.qb64, creder.said);
          assertEquals(reger.creds.get([creder.said!])?.raw, creder.raw);
        } else if (reason === "missingChain") {
          assertDecision(verifier.processCredential(anchorArgs(creder, issuer)), "escrow", reason);
          assertEquals(cues.pull(), expected);
        } else {
          const date = (reason === "missingSchema" ? reger.mse : reger.mre).get([creder.said!])!.dts;
          assertDecision(verifier.processCredential(anchorArgs(creder, issuer)), "escrow", reason);
          assertEquals(cues.length, 0);
          assertEquals((reason === "missingSchema" ? reger.mse : reger.mre).get([creder.said!])!.dts, date);
        }
      }
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Verifier replay retains original escrow on storage failure and advances dependencies", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `verifier-retry-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const reger = yield* createReger({ name: `verifier-retry-${crypto.randomUUID()}`, temp: true });
    const warn = consoleLogger.warn, warnings: unknown[][] = [];
    consoleLogger.warn = (...args) => {
      warnings.push(args);
    };
    try {
      const issuer = makePrefixer(), schema = new Schemer({ sed: schemaSed({ requiredIssuee: false }) });
      for (const migration of [false, true]) {
        const registry = digestFor(`retry-${migration}`).qb64;
        const child = makeCredential({ issuer: issuer.qb64, registry, schema: schema.said });
        const creder = makeCredential({
          issuer: issuer.qb64,
          registry,
          schema: schema.said,
          ...(migration ? { edge: { child: { n: child.said } } } : {}),
        });
        setState(reger, registry, creder.said!);
        const cues = new Deck<AgentCue>();
        const verifier = new Verifier(hby, { reger, cues });
        hby.db.schema.rem(schema.said);
        assertDecision(verifier.processCredential(anchorArgs(creder, issuer)), "escrow", "missingSchema");
        assertEquals(verifier.processEscrows(), false, "unchanged schema dependency is not progress");
        cues.clear();
        const date = reger.mse.get([creder.said!])!.dts;
        hby.db.schema.pin(schema.said, schema);
        const verify = Schemer.prototype.verify, verifyChain = verifier.verifyChain;
        const unexpected = new TypeError(migration ? "Chain lookup failed" : "Schema validator failed");
        if (migration) {
          verifier.verifyChain = () => {
            throw unexpected;
          };
        } else {
          Schemer.prototype.verify = () => {
            throw unexpected;
          };
        }
        try {
          assertStrictEquals(assertThrows(() => verifier.processEscrows()), unexpected);
          assertEquals(reger.mse.get([creder.said!])!.dts, date);
          assertEquals(warnings, [], "unexpected validation infrastructure failure retains escrow");
        } finally {
          Schemer.prototype.verify = verify;
          verifier.verifyChain = verifyChain;
        }
        if (!migration) {
          const save = verifier.saveCredential, failure = new Error("Credential storage failed");
          verifier.saveCredential = () => {
            throw failure;
          };
          try {
            assertStrictEquals(assertThrows(() => verifier.processEscrows()), failure);
            assertEquals(reger.mse.get([creder.said!])!.dts, date);
          } finally {
            verifier.saveCredential = save;
          }
        }
        assertEquals(verifier.processEscrows(), true, "acceptance and dependency migration advance membership");
        assertEquals(reger.mse.get([creder.said!]), null);
        assertEquals(cues.peekTail()?.kin, migration ? "proof" : "saved");
        assertEquals(reger.saved.get([creder.said!]) !== null, !migration);
        assertEquals(reger.mce.get([creder.said!]) !== null, migration);
        assertEquals(
          verifier.processEscrows(),
          false,
          "pending chain cues and identical proof writes are not progress",
        );
        cues.clear();
        if (migration) reger.mce.rem([creder.said!]);
      }
      assertEquals(warnings, [], "successful recovery, dependency migration and storage faults are not ejections");
      const invalidSchema = new Schemer({ sed: schemaSed({ requiredRole: true }) });
      const registry = digestFor("retry-invalid-schema").qb64;
      const invalid = makeCredential({
        issuer: issuer.qb64,
        registry,
        schema: invalidSchema.said,
        attrib: { i: issuer.qb64 },
      });
      setState(reger, registry, invalid.said!);
      const cues = new Deck<AgentCue>();
      const verifier = new Verifier(hby, { reger, cues });
      assertDecision(verifier.processCredential(anchorArgs(invalid, issuer)), "escrow", "missingSchema");
      cues.clear();
      hby.db.schema.pin(invalidSchema.said, invalidSchema);
      consoleLogger.warn = (...args) => {
        assertEquals(reger.mse.get([invalid.said!]), null, "report rejection only after membership is removed");
        warnings.push(args);
      };
      assertEquals(verifier.processEscrows(), true, "terminal rejection removes pending membership");
      assertEquals(reger.mse.get([invalid.said!]), null);
      assertEquals(reger.saved.get([invalid.said!]), null);
      assertEquals(cues.length, 0);
      assertEquals(warnings.length, 1);
      const detail = warnings[0][1];
      assert(detail !== null && typeof detail === "object" && "cause" in detail);
      assertObjectMatch(detail, {
        family: "missingSchema",
        said: invalid.said,
        issuer: issuer.qb64,
        registry,
        reason: "invalidSchema",
      });
      assertInstanceOf(detail.cause, Error, "retain the schema validator's original failure");
      assertEquals(verifier.processEscrows(), false);
      assertEquals(warnings.length, 1, "ejected evidence is not reported on later sweeps");
      const expired = makeCredential({
        issuer: issuer.qb64,
        registry: digestFor("expired-registry").qb64,
        schema: schema.said,
      });
      assertDecision(verifier.processCredential(anchorArgs(expired, issuer)), "escrow", "missingRegistry");
      reger.mre.pin([expired.said!], new Dater({ dts: "2020-01-01T00:00:00.000000+00:00" }));
      const remove = reger.mre.rem.bind(reger.mre), failure = new Error("Escrow removal failed");
      reger.mre.rem = () => {
        throw failure;
      };
      try {
        assertStrictEquals(assertThrows(() => verifier.processEscrows()), failure);
        assertExists(reger.mre.get([expired.said!]));
        assertEquals(warnings.length, 1, "failed removal must not report expiry");
      } finally {
        reger.mre.rem = remove;
      }
      consoleLogger.warn = (...args) => {
        assertEquals(reger.mre.get([expired.said!]), null, "expiry diagnostics follow successful removal");
        warnings.push(args);
      };
      assertEquals(verifier.processEscrows(), true, "expiry changes pending membership only after successful removal");
      assertEquals(warnings[1], ["Verifier ejected credential escrow", {
        family: "missingRegistry",
        said: expired.said,
        reason: "expired",
        detail: `Credential dependency remained unresolved beyond ${verifier.missingRegistryTimeoutMs} ms.`,
      }]);
    } finally {
      consoleLogger.warn = warn;
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});
