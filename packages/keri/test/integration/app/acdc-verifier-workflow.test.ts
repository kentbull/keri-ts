// @file-test-lane interop-gates-c

import { assertEquals, assertExists } from "jsr:@std/assert";
import { t } from "../../../../cesr/mod.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { startStaticHttpHost } from "../../http-test-support.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function packageRoot(): string {
  return new URL("../../../../../", import.meta.url).pathname;
}

async function runTufa(
  args: string[],
  env: Record<string, string>,
): Promise<CmdResult> {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
    cwd: packageRoot(),
    stdout: "piped",
    stderr: "piped",
    env,
  }).output();
  return {
    code: out.code,
    stdout: t(out.stdout),
    stderr: t(out.stderr),
  };
}

async function requireSuccess(
  label: string,
  resultPromise: Promise<CmdResult>,
): Promise<CmdResult> {
  const result = await resultPromise;
  if (result.code !== 0) {
    throw new Error(`${label} failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function storeArgs(name: string, headDirPath: string, passcode: string): string[] {
  return ["--name", name, "--head-dir", headDirPath, "--passcode", passcode];
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

function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((line) => line.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  const value = line.trim().split(/\s+/).at(-1);
  if (!value) {
    throw new Error(`Unable to parse prefix value from output:\n${output}`);
  }
  return value;
}

function schemaSed(): Record<string, unknown> {
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
        required: ["i", "role"],
        properties: {
          i: { type: "string" },
          role: { type: "string" },
        },
      },
    },
  };
}

async function initAndIncept(
  env: Record<string, string>,
  headDirPath: string,
  name: string,
  alias: string,
  passcode: string,
): Promise<string> {
  await requireSuccess(
    `${alias} init`,
    runTufa(["init", ...storeArgs(name, headDirPath, passcode)], env),
  );
  const incept = await requireSuccess(
    `${alias} incept`,
    runTufa([
      "incept",
      ...storeArgs(name, headDirPath, passcode),
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
    ], env),
  );
  return extractPrefix(incept.stdout);
}

Deno.test("ACDC workflow: tufa issuer -> holder -> verifier with revoke webhook", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-acdc-workflow-" });
  const env = {
    ...Deno.env.toObject(),
    KERI_LMDB_MAP_SIZE: "134217728",
  };
  const passcode = "MyPasscodeARealSecret";
  const issuerName = `issuer-${crypto.randomUUID().slice(0, 8)}`;
  const holderName = `holder-${crypto.randomUUID().slice(0, 8)}`;
  const verifierName = `verifier-${crypto.randomUUID().slice(0, 8)}`;
  const schemaPath = `${headDirPath}/schema.json`;
  const holderStreamPath = `${headDirPath}/holder-credential.cesr`;
  const verifierGrantPath = `${headDirPath}/verifier-grant.cesr`;
  const verifierRevocationPath = `${headDirPath}/verifier-revocation.cesr`;
  const webhookBodies: Record<string, unknown>[] = [];
  const hook = startStaticHttpHost(async (request, url) => {
    if (url.pathname !== "/hook") {
      return new Response("not found", { status: 404 });
    }
    webhookBodies.push(JSON.parse(await request.text()) as Record<string, unknown>);
    return new Response("", { status: 202 });
  });

  try {
    const schemer = new Schemer({ sed: schemaSed() });
    await Deno.writeFile(schemaPath, schemer.raw);
    const issuerPre = await initAndIncept(env, headDirPath, issuerName, "issuer", passcode);
    const holderPre = await initAndIncept(env, headDirPath, holderName, "holder", passcode);
    const verifierPre = await initAndIncept(env, headDirPath, verifierName, "verifier", passcode);

    const issuerSchema = await requireSuccess(
      "issuer schema import",
      runTufa(["vc", "schema", "import", ...storeArgs(issuerName, headDirPath, passcode), "--schema", schemaPath], env),
    );
    const schemaSaid = parseJsonLine(issuerSchema.stdout).schema as string;
    assertEquals(schemaSaid, schemer.said);

    const registry = await requireSuccess(
      "issuer registry incept",
      runTufa([
        "vc",
        "registry",
        "incept",
        ...storeArgs(issuerName, headDirPath, passcode),
        "--alias",
        "issuer",
        "--registry-name",
        "issuer-reg",
      ], env),
    );
    assertEquals(parseJsonLine(registry.stdout).issuer, issuerPre);

    const issued = await requireSuccess(
      "issuer credential create",
      runTufa([
        "vc",
        "create",
        ...storeArgs(issuerName, headDirPath, passcode),
        "--alias",
        "issuer",
        "--registry-name",
        "issuer-reg",
        "--schema",
        schemaSaid,
        "--recipient",
        holderPre,
        "--data",
        JSON.stringify({ role: "holder" }),
        "--out",
        holderStreamPath,
      ], env),
    );
    const issuedJson = parseJsonLine(issued.stdout);
    const credentialSaid = issuedJson.said as string;
    assertEquals(issuedJson.status, "accept");

    await requireSuccess(
      "holder schema import",
      runTufa(["vc", "schema", "import", ...storeArgs(holderName, headDirPath, passcode), "--schema", schemaPath], env),
    );
    const holderImport = await requireSuccess(
      "holder credential import",
      runTufa(["vc", "import", ...storeArgs(holderName, headDirPath, passcode), "--in", holderStreamPath], env),
    );
    assertEquals(parseJsonLine(holderImport.stdout).saved, [credentialSaid]);

    const holderGrant = await requireSuccess(
      "holder ipex grant",
      runTufa([
        "ipex",
        "grant",
        ...storeArgs(holderName, headDirPath, passcode),
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
      ], env),
    );
    assertEquals(parseJsonLine(holderGrant.stdout).credential, credentialSaid);

    await requireSuccess(
      "verifier schema import",
      runTufa(
        ["vc", "schema", "import", ...storeArgs(verifierName, headDirPath, passcode), "--schema", schemaPath],
        env,
      ),
    );
    await requireSuccess(
      "verifier grant import",
      runTufa(["vc", "import", ...storeArgs(verifierName, headDirPath, passcode), "--in", verifierGrantPath], env),
    );

    const firstVerifierRun = await requireSuccess(
      "verifier issuance run",
      runTufa([
        "verifier",
        "run",
        ...storeArgs(verifierName, headDirPath, passcode),
        "--hook",
        `${hook.origin}/hook`,
        "--once",
      ], env),
    );
    const firstResult = parseJsonLine(firstVerifierRun.stdout).result as Record<string, unknown>;
    assertEquals(firstResult.webhooksSent, 1);
    assertEquals(webhookBodies.length, 1);
    assertEquals(webhookBodies[0]!.action, "iss");
    assertEquals(webhookBodies[0]!.actor, issuerPre);
    assertEquals((webhookBodies[0]!.data as Record<string, unknown>).credential, credentialSaid);
    assertEquals((webhookBodies[0]!.data as Record<string, unknown>).recipient, holderPre);

    await requireSuccess(
      "issuer credential revoke",
      runTufa([
        "vc",
        "revoke",
        ...storeArgs(issuerName, headDirPath, passcode),
        "--registry-name",
        "issuer-reg",
        "--said",
        credentialSaid,
        "--out",
        verifierRevocationPath,
      ], env),
    );
    await requireSuccess(
      "verifier revocation import",
      runTufa(["vc", "import", ...storeArgs(verifierName, headDirPath, passcode), "--in", verifierRevocationPath], env),
    );

    const secondVerifierRun = await requireSuccess(
      "verifier revocation run",
      runTufa([
        "verifier",
        "run",
        ...storeArgs(verifierName, headDirPath, passcode),
        "--hook",
        `${hook.origin}/hook`,
        "--once",
      ], env),
    );
    const secondResult = parseJsonLine(secondVerifierRun.stdout).result as Record<string, unknown>;
    assertEquals(secondResult.webhooksSent, 1);
    assertEquals(webhookBodies.length, 2);
    assertEquals(webhookBodies[1]!.action, "rev");
    assertEquals((webhookBodies[1]!.data as Record<string, unknown>).credential, credentialSaid);

    const thirdVerifierRun = await requireSuccess(
      "verifier idempotence run",
      runTufa([
        "verifier",
        "run",
        ...storeArgs(verifierName, headDirPath, passcode),
        "--hook",
        `${hook.origin}/hook`,
        "--once",
      ], env),
    );
    const thirdResult = parseJsonLine(thirdVerifierRun.stdout).result as Record<string, unknown>;
    assertEquals(thirdResult.webhooksSent, 0);
    assertEquals(webhookBodies.length, 2);
  } finally {
    await hook.close();
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});
