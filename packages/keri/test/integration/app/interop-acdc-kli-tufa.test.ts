// @file-test-lane interop-parity

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  createInteropContext,
  extractLastNonEmptyLine,
  extractPrefix,
  randomPort,
  requireSuccess,
  runCmd,
  runTufa,
  spawnChild,
  withStartedChild,
  workspaceRoot,
} from "./interop-test-helpers.ts";

function schemaSed(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "",
    title: "InteropCredential",
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
        required: ["i", "role"],
        properties: {
          i: { type: "string" },
          role: { type: "string" },
        },
      },
    },
  };
}

function tufaStoreArgs(
  name: string,
  headDirPath: string,
  passcode: string,
): string[] {
  return ["--name", name, "--head-dir", headDirPath, "--passcode", passcode];
}

function kliStoreArgs(name: string, passcode: string): string[] {
  return ["--name", name, "--passcode", passcode];
}

function parseJsonLine(output: string): Record<string, unknown> {
  const line = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .at(-1);
  if (!line) {
    throw new Error(`Unable to parse JSON line from output:\n${output}`);
  }
  return JSON.parse(line) as Record<string, unknown>;
}

async function initAndInceptTufa(
  env: Record<string, string>,
  name: string,
  headDirPath: string,
  passcode: string,
  alias: string,
): Promise<string> {
  await requireSuccess(
    `tufa ${alias} init`,
    runTufa(["init", ...tufaStoreArgs(name, headDirPath, passcode)], env, workspaceRoot()),
  );
  const incept = await requireSuccess(
    `tufa ${alias} incept`,
    runTufa(
      [
        "incept",
        ...tufaStoreArgs(name, headDirPath, passcode),
        "--alias",
        alias,
        "--transferable",
        "--isith",
        "1",
        "--icount",
        "1",
        "--nsith",
        "1",
        "--ncount",
        "1",
        "--toad",
        "0",
      ],
      env,
      workspaceRoot(),
    ),
  );
  return extractPrefix(incept.stdout);
}

async function initAndInceptKli(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  passcode: string,
): Promise<string> {
  await requireSuccess(
    "kli issuer init",
    runCmd(kliCommand, ["init", ...kliStoreArgs(name, passcode)], env),
  );
  const incept = await requireSuccess(
    "kli issuer incept",
    runCmd(kliCommand, [
      "incept",
      ...kliStoreArgs(name, passcode),
      "--alias",
      "issuer",
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ], env),
  );
  return extractPrefix(incept.stdout);
}

Deno.test("Interop: KLI issuer credential presents through Tufa holder and verifier", async () => {
  const ctx = await createInteropContext();
  const workDir = await Deno.makeTempDir({ prefix: "kli-tufa-acdc-" });
  const env = {
    ...ctx.env,
    KERI_LMDB_MAP_SIZE: "134217728",
  };
  const passcode = "MyPasscodeARealSecret";
  const holderName = `tufa-holder-${crypto.randomUUID().slice(0, 8)}`;
  const verifierName = `tufa-verifier-${crypto.randomUUID().slice(0, 8)}`;
  const kliName = `kli-issuer-${crypto.randomUUID().slice(0, 8)}`;
  const tufaHeadDir = `${workDir}/tufa`;
  const schemaPath = `${workDir}/schema.json`;
  const credentialPath = `${workDir}/kli-credential.cesr`;
  const verifierGrantPath = `${workDir}/verifier-grant.cesr`;
  const agentPort = randomPort();
  const hookPort = randomPort();
  const hookOrigin = `http://127.0.0.1:${hookPort}`;

  try {
    await Deno.writeTextFile(schemaPath, JSON.stringify(schemaSed()));
    await requireSuccess(
      "tufa schema saidify",
      runTufa(["saidify", "--file", schemaPath, "--label", "$id"], env, workspaceRoot()),
    );
    const schemaSaid = (JSON.parse(await Deno.readTextFile(schemaPath)) as Record<string, unknown>)["$id"] as string;

    const hookChild = spawnChild(
      Deno.execPath(),
      [
        "run",
        "--allow-all",
        "--unstable-ffi",
        "packages/tufa/mod.ts",
        "hook",
        "demo",
        "--http",
        String(hookPort),
      ],
      env,
      workspaceRoot(),
    );

    await withStartedChild(hookChild, hookPort, async () => {
      const holderPre = await initAndInceptTufa(env, holderName, tufaHeadDir, passcode, "holder");
      const verifierPre = await initAndInceptTufa(env, verifierName, tufaHeadDir, passcode, "verifier");
      const agentChild = spawnChild(
        Deno.execPath(),
        [
          "run",
          "--allow-all",
          "--unstable-ffi",
          "packages/tufa/mod.ts",
          "agent",
          ...tufaStoreArgs(holderName, tufaHeadDir, passcode),
          "--port",
          String(agentPort),
        ],
        env,
        workspaceRoot(),
      );

      await withStartedChild(agentChild, agentPort, async () => {
        const issuerPre = await initAndInceptKli(ctx.kliCommand, env, kliName, passcode);
        const holderOobi = `http://127.0.0.1:${agentPort}/oobi/${holderPre}/controller`;
        const resolve = await requireSuccess(
          "kli resolve tufa holder",
          runCmd(ctx.kliCommand, [
            "oobi",
            "resolve",
            ...kliStoreArgs(kliName, passcode),
            "--oobi",
            holderOobi,
            "--oobi-alias",
            "holder",
          ], env),
        );
        assertStringIncludes(resolve.stdout, "resolved");

        const schemaImport = await requireSuccess(
          "kli schema import",
          runCmd(ctx.kliCommand, [
            "vc",
            "schema",
            "import_",
            ...kliStoreArgs(kliName, passcode),
            "--schema",
            schemaPath,
          ], env),
        );
        assertStringIncludes(schemaImport.stdout, schemaSaid);

        await requireSuccess(
          "kli registry incept",
          runCmd(ctx.kliCommand, [
            "vc",
            "registry",
            "incept",
            ...kliStoreArgs(kliName, passcode),
            "--alias",
            "issuer",
            "--registry-name",
            "issuer-reg",
            "--no-backers",
            "true",
          ], env),
        );

        const create = await requireSuccess(
          "kli credential create",
          runCmd(ctx.kliCommand, [
            "vc",
            "create",
            ...kliStoreArgs(kliName, passcode),
            "--alias",
            "issuer",
            "--registry-name",
            "issuer-reg",
            "--schema",
            schemaSaid,
            "--recipient",
            "holder",
            "--data",
            JSON.stringify({ role: "holder" }),
          ], env),
        );
        assertStringIncludes(create.stdout, "has been created");

        const issued = await requireSuccess(
          "kli list issued credential",
          runCmd(ctx.kliCommand, [
            "vc",
            "list",
            ...kliStoreArgs(kliName, passcode),
            "--alias",
            "issuer",
            "--issued",
            "--said",
          ], env),
        );
        const credentialSaid = extractLastNonEmptyLine(issued.stdout);
        assertStringIncludes(create.stdout, credentialSaid);

        const exported = await requireSuccess(
          "kli credential export",
          runCmd(ctx.kliCommand, [
            "vc",
            "export",
            ...kliStoreArgs(kliName, passcode),
            "--alias",
            "issuer",
            "--said",
            credentialSaid,
            "--full",
          ], env),
        );
        await Deno.writeTextFile(credentialPath, exported.stdout);

        await requireSuccess(
          "tufa holder schema import",
          runTufa(
            ["vc", "schema", "import", ...tufaStoreArgs(holderName, tufaHeadDir, passcode), "--schema", schemaPath],
            env,
            workspaceRoot(),
          ),
        );
        const imported = await requireSuccess(
          "tufa holder credential import",
          runTufa(
            ["vc", "import", ...tufaStoreArgs(holderName, tufaHeadDir, passcode), "--in", credentialPath],
            env,
            workspaceRoot(),
          ),
        );
        assertEquals(parseJsonLine(imported.stdout).saved, [credentialSaid]);

        const listed = await requireSuccess(
          "tufa holder credential list",
          runTufa(
            ["vc", "list", ...tufaStoreArgs(holderName, tufaHeadDir, passcode), "--alias", "holder"],
            env,
            workspaceRoot(),
          ),
        );
        const credential = parseJsonLine(listed.stdout);
        assertEquals(credential.said, credentialSaid);
        assertEquals(credential.issuer, issuerPre);
        assertEquals(credential.issuee, holderPre);
        assertEquals(credential.schema, schemaSaid);
        assertEquals(credential.status, "iss");

        const grant = await requireSuccess(
          "tufa holder ipex grant",
          runTufa(
            [
              "ipex",
              "grant",
              ...tufaStoreArgs(holderName, tufaHeadDir, passcode),
              "--alias",
              "holder",
              "--recipient",
              verifierPre,
              "--said",
              credentialSaid,
              "--message",
              "presentation",
              "--out",
              verifierGrantPath,
            ],
            env,
            workspaceRoot(),
          ),
        );
        assertEquals(parseJsonLine(grant.stdout).credential, credentialSaid);

        await requireSuccess(
          "tufa verifier schema import",
          runTufa(
            ["vc", "schema", "import", ...tufaStoreArgs(verifierName, tufaHeadDir, passcode), "--schema", schemaPath],
            env,
            workspaceRoot(),
          ),
        );
        await requireSuccess(
          "tufa verifier grant import",
          runTufa(
            ["vc", "import", ...tufaStoreArgs(verifierName, tufaHeadDir, passcode), "--in", verifierGrantPath],
            env,
            workspaceRoot(),
          ),
        );
        const verifierRun = await requireSuccess(
          "tufa verifier issuance run",
          runTufa(
            [
              "verifier",
              "run",
              ...tufaStoreArgs(verifierName, tufaHeadDir, passcode),
              "--hook",
              `${hookOrigin}/`,
              "--once",
            ],
            env,
            workspaceRoot(),
          ),
        );
        const verifierResult = parseJsonLine(verifierRun.stdout).result as Record<string, unknown>;
        assertEquals(verifierResult.webhooksSent, 1);

        const hookResponse = await fetch(`${hookOrigin}/?holder=${holderPre}`);
        try {
          assertEquals(hookResponse.status, 200);
          const hookPresentation = await hookResponse.json() as Record<string, unknown>;
          assertEquals(hookPresentation.credential, credentialSaid);
          assertEquals(hookPresentation.issuer, issuerPre);
          assertEquals(hookPresentation.holder, holderPre);
          assertEquals(hookPresentation.schema, schemaSaid);
        } finally {
          await hookResponse.body?.cancel().catch(() => undefined);
        }
      });
    });
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => undefined);
    await Deno.remove(ctx.home, { recursive: true }).catch(() => undefined);
  }
});
