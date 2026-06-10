// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { dwsGenerateCommand } from "../../../src/app/cli/did.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import {
  bindDesignatedAliases,
  DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME,
  DESIGNATED_ALIASES_SCHEMA_SAID,
  didWebsArtifactUrls,
  generateDidWebsArtifacts,
  listActiveDesignatedAliasCredentials,
  parseDid,
  pinDesignatedAliasesSchema,
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
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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

Deno.test("did/webs - keri.cesr replays controller KEL once and appends DA material", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `did-webs-cesr-${crypto.randomUUID()}`,
      temp: true,
    });
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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
      ingestKeriBytes(
        runtime,
        hab.makeLocScheme("http://127.0.0.1:7723/dws/mailbox", hab.pre, "http"),
      );
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
      );
      yield* processRuntimeTurn(runtime, { hab });

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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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
