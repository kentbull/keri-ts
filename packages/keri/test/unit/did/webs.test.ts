import { ShortageError, WireParseError } from "cesr-ts";
import { run, sleep, spawn } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, settleRuntimeIngress } from "../../../src/app/agent-runtime.ts";
import { dwsGenerateCommand } from "../../../src/app/cli/did.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import type { Reger } from "../../../src/db/reger.ts";
import {
  bindDesignatedAliases,
  DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME,
  DESIGNATED_ALIASES_SCHEMA_SAID,
  didWebsArtifactUrls,
  generateBareDidDocument,
  generateDidWebsArtifacts,
  listActiveDesignatedAliasCredentials,
  parseDid,
  pinDesignatedAliasesSchema,
  resolveDidWebs,
} from "../../../src/did/index.ts";

Deno.test("did/webs - parses DID Webs host, path, AID, and artifact URLs", () => {
  const parsed = parseDid("did:webs:127.0.0.1%3A7678:dws:EAid?meta=true");
  assertEquals(parsed.kind, "webs");
  assertEquals(parsed.aid, "EAid");
  if (parsed.kind !== "webs") {
    throw new Error("Expected did:webs parse result.");
  }
  assertEquals(parsed.host, "127.0.0.1:7678");
  assertEquals(parsed.path, ["dws"]);
  assertEquals(didWebsArtifactUrls("did:webs:127.0.0.1%3A7678:dws:EAid?meta=true", { scheme: "http" }), {
    didJson: "http://127.0.0.1:7678/dws/EAid/did.json?meta=true",
    keriCesr: "http://127.0.0.1:7678/dws/EAid/keri.cesr",
  });
});

Deno.test("did/webs - rejects raw port separators", () => {
  assertThrows(
    () => parseDid("did:webs:127.0.0.1:7678:dws:EAid"),
    Error,
    "must encode host ports",
  );
});

Deno.test("did/webs - pins DA schema from JSON resource and rebinds active aliases", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `did-webs-${crypto.randomUUID()}`,
      temp: true,
    });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const schema = pinDesignatedAliasesSchema(runtime);
      assertEquals(schema.said, DESIGNATED_ALIASES_SCHEMA_SAID);

      const first = bindDesignatedAliases(runtime, {
        alias: "issuer",
        dids: [
          `did:webs:127.0.0.1%3A7678:dws:${hab.pre}`,
          `did:keri:${hab.pre}`,
        ],
      });
      assertEquals(first.revoked, []);

      const second = bindDesignatedAliases(runtime, {
        alias: "issuer",
        dids: [`did:webs:example.com:dws:${hab.pre}`],
      });
      assertEquals(second.revoked, [first.issued]);

      const active = listActiveDesignatedAliasCredentials(runtime, hab.pre);
      assertEquals(active.map((item) => item.creder.said), [second.issued]);
      assertEquals(active.flatMap((item) => item.aliases), [
        `did:webs:example.com:dws:${hab.pre}`,
      ]);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("did/webs - bind reuses existing DA registry across runtime reopen", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "dws-bind-registry-" });
  const name = `did-webs-bind-${crypto.randomUUID()}`;
  const alias = "issuer";
  try {
    let aid = "";
    let firstRegistry = "";
    let firstIssued = "";

    await run(function*() {
      const hby = yield* createHabery({
        name,
        headDirPath,
        skipConfig: true,
      });
      const runtime = yield* createAgentRuntime(hby);
      try {
        const hab = hby.makeHab(alias, undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        aid = hab.pre;
        const first = bindDesignatedAliases(runtime, {
          alias,
          dids: [`did:webs:example.com:dws:${aid}`],
        });
        firstRegistry = first.registry;
        firstIssued = first.issued;
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });

    await run(function*() {
      const hby = yield* createHabery({
        name,
        headDirPath,
        skipConfig: true,
      });
      const runtime = yield* createAgentRuntime(hby);
      try {
        const second = bindDesignatedAliases(runtime, {
          alias,
          dids: [`did:webs:example.org:dws:${aid}`],
        });
        assertEquals(second.registryName, DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME);
        assertEquals(second.registry, firstRegistry);
        assertEquals(second.revoked, [firstIssued]);
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("did/webs - streamed resolution waits for EOF and joins cancellation without masking failures", async () => {
  await run(function*() {
    const issuer = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const source = yield* createAgentRuntime(issuer);
    let fetches: string[] = [], mode = "stream", body: ReadableStream<Uint8Array>;
    const injected = new TypeError("injected client invariant failure");
    const runtime = yield* createAgentRuntime(target, {
      services: {
        http: {
          // deno-lint-ignore require-await -- Model asynchronous Fetch rejection and response completion.
          async fetch(url) {
            fetches.push(url);
            if (mode === "injected") throw injected;
            if (mode === "status" && fetches.length === 1) return new Response(null, { status: 503 });
            if (url.endsWith("did.json")) {
              if (mode === "mismatch") return new Response(JSON.stringify({ id: did }));
            }
            return new Response(url.endsWith("did.json") ? Uint8Array.from(artifacts.didJson) : body);
          },
        },
      },
    });
    let escrowPasses = 0;
    const advance = runtime.reactor.processEscrowsOnce.bind(runtime.reactor);
    runtime.reactor.processEscrowsOnce = function*() {
      escrowPasses++;
      yield* advance();
    };
    const hab = issuer.makeHab("issuer", undefined, { toad: 0 });
    const did = `did:webs:example.com:dws:${hab.pre}`;
    const aliases = bindDesignatedAliases(source, { alias: "issuer", dids: [did, `did:keri:${hab.pre}`] });
    const artifacts = generateDidWebsArtifacts(source, { alias: "issuer", did });
    const clearSavedCue = () => {
      assertEquals(runtime.cues.toArray().map((cue) => cue.kin === "saved" ? cue.creder.said : cue.kin), [
        aliases.issued,
      ]);
      assertEquals(runtime.vdr!.reger.saved.get([aliases.issued])?.qb64, aliases.issued);
      runtime.cues.clear();
    };
    const first = [...issuer.db.clonePreIter(hab.pre)][0];
    let controller: ReadableStreamDefaultController<Uint8Array>, canceled = false, finishCleanup = () => {};
    const cleanup = new Promise<void>((resolve) => finishCleanup = resolve);
    try {
      body = new ReadableStream({
        start(current) {
          controller = current;
          current.enqueue(first);
        },
      }, { highWaterMark: 0 });
      let complete = false;
      const task = yield* spawn(function*() {
        const result = yield* resolveDidWebs(runtime, { did });
        complete = true;
        return result;
      });
      for (let i = 0; i < 100 && !target.db.getState(hab.pre); i++) yield* sleep(1);
      assertExists(target.db.getState(hab.pre), "Independent KEL becomes accepted before artifact EOF");
      assertEquals([complete, fetches.length], [false, 1]);
      controller!.enqueue(artifacts.keriCesr.slice(first.length));
      controller!.close();
      assertEquals((yield* task).document.id, did);
      assertEquals(escrowPasses, 2, "Preserve both legacy convergence passes after complete intake");
      assertEquals(
        runtime.cues.toArray().map((cue) =>
          cue.kin === "receipt"
            ? [cue.kin, cue.serder.pre, cue.serder.said]
            : cue.kin === "keyStateSaved"
            ? [cue.kin, cue.ksn.i, cue.ksn.d]
            : cue.kin === "saved"
            ? [cue.kin, cue.creder.said]
            : [cue.kin]
        ),
        [...issuer.db.getKelItemIter(hab.pre)].flatMap(([, said]) =>
          ["receipt", "keyStateSaved"].map((kin) => [kin, hab.pre, said])
        ).concat([["saved", aliases.issued]]),
      );
      assertEquals(target.db.getState(hab.pre)?.d, hab.kever!.said);
      assertEquals(runtime.vdr!.reger.saved.get([aliases.issued])?.qb64, aliases.issued);
      runtime.cues.clear();
      fetches = [];
      body = new ReadableStream({
        start(current) {
          current.enqueue(first);
        },
        cancel() {
          canceled = true;
          return cleanup;
        },
      }, { highWaterMark: 0 });
      const stopped = yield* spawn(function*() {
        yield* resolveDidWebs(runtime, { did });
      });
      for (let i = 0; i < 100 && !fetches.length; i++) yield* sleep(1);
      yield* sleep(5);
      let joined = false;
      const halt = yield* spawn(function*() {
        yield* stopped.halt();
        joined = true;
      });
      for (let i = 0; i < 100 && !canceled; i++) yield* sleep(1);
      assertEquals([canceled, joined, fetches.length], [true, false, 1]);
      finishCleanup();
      yield* halt;
      assertExists(target.db.getState(hab.pre));
      fetches = [];
      const fault = new Error("late artifact read failed");
      body = new ReadableStream({
        start(current) {
          current.enqueue(first);
          controller = current;
        },
      }, { highWaterMark: 0 });
      const failed = yield* spawn(function*() {
        try {
          yield* resolveDidWebs(runtime, { did });
        } catch (error) {
          return error;
        }
      });
      for (let i = 0; i < 100 && !fetches.length; i++) yield* sleep(1);
      controller!.error(fault);
      assertEquals(yield* failed, fault);
      assertEquals(fetches.length, 1, "Started body failures cannot fall back to an alternate URL");
      assertExists(target.db.getState(hab.pre), "Late failure preserves prior accepted state");
      fetches = [];
      mode = "stream";
      body = new ReadableStream({
        start(current) {
          current.enqueue(artifacts.keriCesr);
          current.close();
        },
      });
      const escrows = runtime.reactor.processEscrowsOnce;
      runtime.reactor.processEscrowsOnce = function*() {
        throw fault;
      };
      try {
        yield* resolveDidWebs(runtime, { did });
        throw new Error("Expected escrow infrastructure failure");
      } catch (error) {
        assertEquals(error, fault);
      } finally {
        runtime.reactor.processEscrowsOnce = escrows;
      }
      assertEquals(fetches.length, 1, "Escrow/storage failures cannot become an alternate artifact fetch");
      clearSavedCue();
      fetches = [];
      body = new ReadableStream({
        start(current) {
          current.enqueue(first);
          current.enqueue(Uint8Array.of(123));
          current.close();
        },
      });
      let truncated: unknown;
      try {
        yield* resolveDidWebs(runtime, { did });
      } catch (error) {
        truncated = error;
      }
      assertEquals(truncated instanceof WireParseError && truncated.cause instanceof ShortageError, true);
      assertEquals(fetches.length, 1, "Truncated EOF cannot finish a cached DID or trigger fallback");
      assertExists(target.db.getState(hab.pre));
      fetches = [];
      mode = "injected";
      try {
        yield* resolveDidWebs(runtime, { did });
        throw new Error("Expected injected failure");
      } catch (error) {
        assertEquals(error, injected);
      }
      assertEquals(fetches.length, 1);
      fetches = [];
      mode = "status";
      body = new ReadableStream({
        start(current) {
          current.enqueue(artifacts.keriCesr);
          current.close();
        },
      });
      assertEquals((yield* resolveDidWebs(runtime, { did })).document.id, did);
      assertEquals(fetches.slice(0, 2).map((url) => new URL(url).protocol), ["https:", "http:"]);
      clearSavedCue();

      for (const [failure, expected] of [["mismatch", ValidationError]] as const) {
        mode = failure;
        fetches = [];
        body = new ReadableStream({
          start(current) {
            current.enqueue(artifacts.keriCesr);
            current.close();
          },
        });
        let rejected: unknown;
        try {
          yield* resolveDidWebs(runtime, { did });
        } catch (error) {
          rejected = error;
        }
        assertEquals(rejected instanceof expected, true, `${failure}: ${String(rejected)}`);
        assertEquals(fetches.length, 2, "DID JSON/content failures cannot trigger transport fallback");
        clearSavedCue();
      }
    } finally {
      finishCleanup();
      yield* runtime.close();
      yield* source.close();
      yield* target.close(true);
      yield* issuer.close(true);
    }
  });
});

Deno.test("did/webs - keri.cesr replays controller KEL once and appends DA material", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `did-webs-cesr-${crypto.randomUUID()}`,
      temp: true,
    });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const did = `did:webs:example.com:dws:${hab.pre}`;
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme("http://127.0.0.1:7723/dws/mailbox", hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
      ]);

      bindDesignatedAliases(runtime, {
        alias: "issuer",
        dids: [
          did,
          `did:webs:example.org:dws:${hab.pre}`,
        ],
      });

      const artifacts = generateDidWebsArtifacts(runtime, {
        alias: "issuer",
        did,
      });
      const keriCesr = new TextDecoder().decode(artifacts.keriCesr);
      assertEquals(
        countOccurrences(
          keriCesr,
          `"t":"icp","d":"${hab.pre}","i":"${hab.pre}"`,
        ),
        1,
      );
      assertEquals(keriCesr.includes("\"t\":\"vcp\""), true);
      assertEquals(keriCesr.includes("\"t\":\"iss\""), true);
      assertEquals(keriCesr.includes("\"v\":\"ACDC"), true);
      assertEquals(keriCesr.includes("\"r\":\"/loc/scheme\""), true);
      assertEquals(keriCesr.includes("\"role\":\"mailbox\""), true);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

type VerificationMethodDocument = Record<string, unknown> & {
  id: string;
  type?: string;
  threshold?: unknown;
  conditionThreshold?: unknown;
  conditionWeightedThreshold?: unknown;
  conditionAnd?: unknown;
  conditionOr?: unknown;
};

function didFor(pre: string): string {
  return `did:webs:example.com:dws:${pre}`;
}

function verificationMethodMap(document: Record<string, unknown>): Map<string, VerificationMethodDocument> {
  const methods = document.verificationMethod;
  if (!Array.isArray(methods)) {
    throw new Error("Expected verificationMethod array.");
  }
  return new Map(methods.map((method) => {
    if (!method || typeof method !== "object" || typeof (method as { id?: unknown }).id !== "string") {
      throw new Error("Expected verification method with id.");
    }
    return [(method as { id: string }).id, method as VerificationMethodDocument];
  }));
}

function requireVerificationMethod(
  methods: Map<string, VerificationMethodDocument>,
  id: string,
): VerificationMethodDocument {
  const method = methods.get(id);
  assertExists(method);
  return method;
}

function assertOnlyConditionFamily(method: VerificationMethodDocument): void {
  const families = [
    "conditionThreshold",
    "conditionWeightedThreshold",
    "conditionAnd",
    "conditionOr",
  ].filter((key) => key in method);
  assertEquals(families.length, 1, method.id);
  assertEquals("path" in method, false, method.id);
  assertEquals(Array.isArray(method.threshold), false, method.id);
  assertEquals(
    method.threshold !== null && typeof method.threshold === "object",
    false,
    method.id,
  );
}

function assertConditionalProofMethods(document: Record<string, unknown>): void {
  for (const method of verificationMethodMap(document).values()) {
    if (method.type === "ConditionalProof2022") {
      assertOnlyConditionFamily(method);
    }
  }
}

Deno.test("did/webs - numeric thresholds project as conditionThreshold methods", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `did-webs-numeric-${crypto.randomUUID()}`,
      temp: true,
    });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const hab = hby.makeHab("numeric", undefined, {
        transferable: true,
        icount: 2,
        isith: "2",
        ncount: 2,
        nsith: "2",
        toad: 0,
      });
      const document = generateBareDidDocument(runtime, didFor(hab.pre));
      const methods = verificationMethodMap(document);
      const keyMethods = hab.kever!.verfers.map((verfer) => `#${verfer.qb64}`);
      const root = requireVerificationMethod(methods, `#${hab.pre}`);

      assertEquals(root.type, "ConditionalProof2022");
      assertEquals(root.threshold, 2);
      assertEquals(root.conditionThreshold, keyMethods);
      assertConditionalProofMethods(document);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("did/webs - flat weighted thresholds project with scaled integer weights", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `did-webs-flat-weighted-${crypto.randomUUID()}`,
      temp: true,
    });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const hab = hby.makeHab("flat", undefined, {
        transferable: true,
        icount: 2,
        isith: ["1/2", "1/2"],
        ncount: 2,
        nsith: ["1/2", "1/2"],
        toad: 0,
      });
      const document = generateBareDidDocument(runtime, didFor(hab.pre));
      const methods = verificationMethodMap(document);
      const keyMethods = hab.kever!.verfers.map((verfer) => `#${verfer.qb64}`);
      const root = requireVerificationMethod(methods, `#${hab.pre}`);

      assertEquals(root.type, "ConditionalProof2022");
      assertEquals(root.threshold, 2);
      assertEquals(root.conditionWeightedThreshold, [
        { condition: keyMethods[0], weight: 1 },
        { condition: keyMethods[1], weight: 1 },
      ]);
      assertConditionalProofMethods(document);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("did/webs - nested weighted thresholds project recursively without path fields", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `did-webs-nested-weighted-${crypto.randomUUID()}`,
      temp: true,
    });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const hab = hby.makeHab("nested", undefined, {
        transferable: true,
        icount: 3,
        isith: [{ "1": ["1/2", "1/2"] }, "1"],
        ncount: 3,
        nsith: [{ "1": ["1/2", "1/2"] }, "1"],
        toad: 0,
      });
      const document = generateBareDidDocument(runtime, didFor(hab.pre));
      const methods = verificationMethodMap(document);
      const keyMethods = hab.kever!.verfers.map((verfer) => `#${verfer.qb64}`);
      const root = requireVerificationMethod(methods, `#${hab.pre}`);
      const childId = `#${hab.pre}-kt-c0-g0`;
      const child = requireVerificationMethod(methods, childId);

      assertEquals(root.type, "ConditionalProof2022");
      assertEquals(root.threshold, 1);
      assertEquals(root.conditionWeightedThreshold, [
        { condition: childId, weight: 1 },
        { condition: keyMethods[2], weight: 1 },
      ]);
      assertEquals(child.type, "ConditionalProof2022");
      assertEquals(child.threshold, 2);
      assertEquals(child.conditionWeightedThreshold, [
        { condition: keyMethods[0], weight: 1 },
        { condition: keyMethods[1], weight: 1 },
      ]);
      assertConditionalProofMethods(document);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("did/webs - multi-clause weighted thresholds project as conditionAnd children", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `did-webs-multi-clause-${crypto.randomUUID()}`,
      temp: true,
    });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const hab = hby.makeHab("multi", undefined, {
        transferable: true,
        icount: 4,
        isith: [["1/2", "1/2"], ["1/2", "1/2"]],
        ncount: 4,
        nsith: [["1/2", "1/2"], ["1/2", "1/2"]],
        toad: 0,
      });
      const document = generateBareDidDocument(runtime, didFor(hab.pre));
      const methods = verificationMethodMap(document);
      const keyMethods = hab.kever!.verfers.map((verfer) => `#${verfer.qb64}`);
      const root = requireVerificationMethod(methods, `#${hab.pre}`);
      const first = requireVerificationMethod(methods, `#${hab.pre}-kt-c0`);
      const second = requireVerificationMethod(methods, `#${hab.pre}-kt-c1`);

      assertEquals(root.type, "ConditionalProof2022");
      assertEquals(root.conditionAnd, [`#${hab.pre}-kt-c0`, `#${hab.pre}-kt-c1`]);
      assertEquals("threshold" in root, false);
      assertEquals(first.threshold, 2);
      assertEquals(first.conditionWeightedThreshold, [
        { condition: keyMethods[0], weight: 1 },
        { condition: keyMethods[1], weight: 1 },
      ]);
      assertEquals(second.threshold, 2);
      assertEquals(second.conditionWeightedThreshold, [
        { condition: keyMethods[2], weight: 1 },
        { condition: keyMethods[3], weight: 1 },
      ]);
      assertConditionalProofMethods(document);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) {
      return count;
    }
    count += 1;
    offset = index + needle.length;
  }
}

Deno.test("did/webs - CLI generate writes artifacts under the DID path", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "dws-generate-" });
  try {
    await run(function*() {
      const name = `did-webs-cli-${crypto.randomUUID()}`;
      const hby = yield* createHabery({
        name,
        headDirPath,
        skipConfig: true,
      });
      const runtime = yield* createAgentRuntime(hby);
      let did = "";
      try {
        const hab = hby.makeHab("issuer", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        did = `did:webs:example.com:dws:${hab.pre}`;
        bindDesignatedAliases(runtime, {
          alias: "issuer",
          dids: [did],
        });
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }

      const outputDir = `${headDirPath}/web-root`;
      yield* dwsGenerateCommand({
        name,
        headDirPath,
        alias: "issuer",
        did,
        outputDir,
      });

      const aid = did.split(":").at(-1);
      const artifactDir = `${outputDir}/dws/${aid}`;
      assertEquals(Deno.statSync(`${artifactDir}/did.json`).isFile, true);
      assertEquals(Deno.statSync(`${artifactDir}/keri.cesr`).isFile, true);
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});
