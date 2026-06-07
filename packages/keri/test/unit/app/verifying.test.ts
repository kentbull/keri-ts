// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Diger, Ilks, NumberPrimitive, NumDex, Prefixer, SerderACDC, Signer } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Verifier, type VerifierDecision } from "../../../src/app/verifying.ts";
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
