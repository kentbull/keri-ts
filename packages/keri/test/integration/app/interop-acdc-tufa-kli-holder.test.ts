// @file-test-lane interop-parity

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  createInteropContext,
  extractLastNonEmptyLine,
  extractPrefix,
  randomPort,
  requireSuccess,
  resolveLocalKeripyKliCommand,
  runCmd,
  runCmdWithTimeout,
  runTufa,
  runTufaWithTimeout,
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

async function assertKliCredentialListed(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  passcode: string,
  schemaSaid: string,
  credentialSaid: string,
): Promise<void> {
  const listed = await requireSuccess(
    "kli holder credential list",
    runCmdWithTimeout(
      kliCommand,
      [
        "vc",
        "list",
        ...kliStoreArgs(name, passcode),
        "--alias",
        "holder",
        "--said",
        "--schema",
        schemaSaid,
      ],
      env,
      30_000,
    ),
  );
  if (listed.stdout.split(/\r?\n/).map((line) => line.trim()).includes(credentialSaid)) {
    return;
  }

  const escrows = await runCmdWithTimeout(
    kliCommand,
    ["escrow", "list", ...kliStoreArgs(name, passcode)],
    env,
    30_000,
  );
  throw new Error(
    `KLI holder did not list credential ${credentialSaid}.\nlist stdout:\n${listed.stdout}\nlist stderr:\n${listed.stderr}\nescrow stdout:\n${escrows.stdout}\nescrow stderr:\n${escrows.stderr}`,
  );
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
  alias: string,
): Promise<string> {
  await requireSuccess(
    `kli ${alias} init`,
    runCmd(kliCommand, ["init", ...kliStoreArgs(name, passcode)], env),
  );
  const incept = await requireSuccess(
    `kli ${alias} incept`,
    runCmd(kliCommand, [
      "incept",
      ...kliStoreArgs(name, passcode),
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

Deno.test("Interop: Tufa issuer credential presents through KLI holder and Tufa verifier", async () => {
  const ctx = await createInteropContext();
  const workDir = await Deno.makeTempDir({ prefix: "tufa-kli-holder-acdc-" });
  const env = {
    ...ctx.env,
    KERI_LMDB_MAP_SIZE: "134217728",
  };
  const passcode = "MyPasscodeARealSecret";
  const providerName = `tufa-provider-${crypto.randomUUID().slice(0, 8)}`;
  const issuerName = `tufa-issuer-${crypto.randomUUID().slice(0, 8)}`;
  const verifierName = `tufa-verifier-${crypto.randomUUID().slice(0, 8)}`;
  const holderName = `kli-holder-${crypto.randomUUID().slice(0, 8)}`;
  const tufaHeadDir = `${workDir}/tufa`;
  const schemaPath = `${workDir}/schema.json`;
  const providerAgentPort = randomPort();
  const agentPort = randomPort();
  const hookPort = randomPort();
  const providerOrigin = `http://127.0.0.1:${providerAgentPort}`;
  const hookOrigin = `http://127.0.0.1:${hookPort}`;
  const kliCommand = await resolveLocalKeripyKliCommand(workDir, ctx.kliCommand, env);

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
      const providerPre = await initAndInceptTufa(env, providerName, tufaHeadDir, passcode, "provider");
      const issuerPre = await initAndInceptTufa(env, issuerName, tufaHeadDir, passcode, "issuer");
      const verifierPre = await initAndInceptTufa(env, verifierName, tufaHeadDir, passcode, "verifier");
      const holderPre = await initAndInceptKli(kliCommand, env, holderName, passcode, "holder");

      await requireSuccess(
        "tufa provider location add",
        runTufa(
          [
            "loc",
            "add",
            ...tufaStoreArgs(providerName, tufaHeadDir, passcode),
            "--alias",
            "provider",
            "--url",
            providerOrigin,
          ],
          env,
          workspaceRoot(),
        ),
      );
      await requireSuccess(
        "tufa provider controller end role",
        runTufa(
          [
            "ends",
            "add",
            ...tufaStoreArgs(providerName, tufaHeadDir, passcode),
            "--alias",
            "provider",
            "--role",
            "controller",
            "--eid",
            providerPre,
          ],
          env,
          workspaceRoot(),
        ),
      );
      await requireSuccess(
        "tufa provider mailbox end role",
        runTufa(
          [
            "ends",
            "add",
            ...tufaStoreArgs(providerName, tufaHeadDir, passcode),
            "--alias",
            "provider",
            "--role",
            "mailbox",
            "--eid",
            providerPre,
          ],
          env,
          workspaceRoot(),
        ),
      );

      await requireSuccess(
        "tufa issuer schema import",
        runTufa(
          ["vc", "schema", "import", ...tufaStoreArgs(issuerName, tufaHeadDir, passcode), "--schema", schemaPath],
          env,
          workspaceRoot(),
        ),
      );
      await requireSuccess(
        "tufa verifier schema import",
        runTufa(
          ["vc", "schema", "import", ...tufaStoreArgs(verifierName, tufaHeadDir, passcode), "--schema", schemaPath],
          env,
          workspaceRoot(),
        ),
      );
      await requireSuccess(
        "tufa registry incept",
        runTufa(
          [
            "vc",
            "registry",
            "incept",
            ...tufaStoreArgs(issuerName, tufaHeadDir, passcode),
            "--alias",
            "issuer",
            "--registry-name",
            "issuer-reg",
          ],
          env,
          workspaceRoot(),
        ),
      );
      const created = await requireSuccess(
        "tufa credential create",
        runTufa(
          [
            "vc",
            "create",
            ...tufaStoreArgs(issuerName, tufaHeadDir, passcode),
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
          ],
          env,
          workspaceRoot(),
        ),
      );
      const credentialSaid = parseJsonLine(created.stdout).said as string;
      assertStringIncludes(created.stdout, holderPre);

      const schemaImport = await requireSuccess(
        "kli holder schema import",
        runCmd(kliCommand, [
          "vc",
          "schema",
          "import_",
          ...kliStoreArgs(holderName, passcode),
          "--schema",
          schemaPath,
        ], env),
      );
      assertStringIncludes(schemaImport.stdout, schemaSaid);

      const providerAgentChild = spawnChild(
        Deno.execPath(),
        [
          "run",
          "--allow-all",
          "--unstable-ffi",
          "packages/tufa/mod.ts",
          "agent",
          ...tufaStoreArgs(providerName, tufaHeadDir, passcode),
          "--port",
          String(providerAgentPort),
        ],
        env,
        workspaceRoot(),
      );

      await withStartedChild(providerAgentChild, providerAgentPort, async () => {
        const providerMailboxOobi = `${providerOrigin}/oobi/${providerPre}/mailbox/${providerPre}`;
        await requireSuccess(
          "kli resolve tufa provider mailbox",
          runCmdWithTimeout(
            kliCommand,
            [
              "oobi",
              "resolve",
              ...kliStoreArgs(holderName, passcode),
              "--oobi",
              providerMailboxOobi,
              "--oobi-alias",
              "provider",
            ],
            env,
            20_000,
          ),
        );

        const mailboxAdd = await requireSuccess(
          "kli holder mailbox add",
          runCmdWithTimeout(
            kliCommand,
            [
              "mailbox",
              "add",
              ...kliStoreArgs(holderName, passcode),
              "--alias",
              "holder",
              "--mailbox",
              "provider",
            ],
            env,
            20_000,
          ),
        );
        assertStringIncludes(mailboxAdd.stdout, providerPre);

        await requireSuccess(
          "tufa issuer resolve provider mailbox",
          runTufaWithTimeout(
            [
              "oobi",
              "resolve",
              ...tufaStoreArgs(issuerName, tufaHeadDir, passcode),
              "--url",
              providerMailboxOobi,
              "--oobi-alias",
              "provider",
            ],
            env,
            workspaceRoot(),
            20_000,
          ),
        );

        const issuerMailboxAdd = await requireSuccess(
          "tufa issuer mailbox add",
          runTufaWithTimeout(
            [
              "mailbox",
              "add",
              ...tufaStoreArgs(issuerName, tufaHeadDir, passcode),
              "--alias",
              "issuer",
              "--mailbox",
              "provider",
            ],
            env,
            workspaceRoot(),
            20_000,
          ),
        );
        assertStringIncludes(issuerMailboxAdd.stdout, providerPre);

        const holderMailboxOobi = await requireSuccess(
          "kli holder mailbox oobi generate",
          runCmdWithTimeout(
            kliCommand,
            [
              "oobi",
              "generate",
              ...kliStoreArgs(holderName, passcode),
              "--alias",
              "holder",
              "--role",
              "mailbox",
            ],
            env,
            20_000,
          ),
        );
        const holderMailboxUrl = extractLastNonEmptyLine(holderMailboxOobi.stdout);

        await requireSuccess(
          "tufa issuer resolve kli holder mailbox",
          runTufaWithTimeout(
            [
              "oobi",
              "resolve",
              ...tufaStoreArgs(issuerName, tufaHeadDir, passcode),
              "--url",
              holderMailboxUrl,
              "--oobi-alias",
              "holder",
            ],
            env,
            workspaceRoot(),
            20_000,
          ),
        );

        const issuerMailboxOobi = await requireSuccess(
          "tufa issuer mailbox oobi generate",
          runTufaWithTimeout(
            [
              "oobi",
              "generate",
              ...tufaStoreArgs(issuerName, tufaHeadDir, passcode),
              "--alias",
              "issuer",
              "--role",
              "mailbox",
            ],
            env,
            workspaceRoot(),
            20_000,
          ),
        );
        const issuerMailboxUrl = extractLastNonEmptyLine(issuerMailboxOobi.stdout);

        await requireSuccess(
          "kli resolve tufa issuer mailbox",
          runCmdWithTimeout(
            kliCommand,
            [
              "oobi",
              "resolve",
              ...kliStoreArgs(holderName, passcode),
              "--oobi",
              issuerMailboxUrl,
              "--oobi-alias",
              "issuer",
            ],
            env,
            20_000,
          ),
        );

        const grantToHolder = await requireSuccess(
          "tufa issuer ipex grant",
          runTufaWithTimeout(
            [
              "ipex",
              "grant",
              ...tufaStoreArgs(issuerName, tufaHeadDir, passcode),
              "--alias",
              "issuer",
              "--recipient",
              holderPre,
              "--said",
              credentialSaid,
              "--message",
              "issuance ok",
            ],
            env,
            workspaceRoot(),
            30_000,
          ),
        );
        assertStringIncludes(grantToHolder.stdout, credentialSaid);

        const listedGrant = await requireSuccess(
          "kli holder ipex grant poll",
          runCmdWithTimeout(
            kliCommand,
            [
              "ipex",
              "list",
              ...kliStoreArgs(holderName, passcode),
              "--alias",
              "holder",
              "--poll",
              "--type",
              "grant",
              "--said",
            ],
            env,
            30_000,
          ),
        );
        const grantSaid = extractLastNonEmptyLine(listedGrant.stdout);

        const admitted = await requireSuccess(
          "kli holder ipex admit",
          runCmdWithTimeout(
            kliCommand,
            [
              "ipex",
              "admit",
              ...kliStoreArgs(holderName, passcode),
              "--alias",
              "holder",
              "--said",
              grantSaid,
              "--message",
              "accepted ok",
            ],
            env,
            30_000,
          ),
        );
        assertStringIncludes(admitted.stdout, "admit message sent");
        await assertKliCredentialListed(kliCommand, env, holderName, passcode, schemaSaid, credentialSaid);
      });

      const agentChild = spawnChild(
        Deno.execPath(),
        [
          "run",
          "--allow-all",
          "--unstable-ffi",
          "packages/tufa/mod.ts",
          "agent",
          ...tufaStoreArgs(verifierName, tufaHeadDir, passcode),
          "--port",
          String(agentPort),
        ],
        env,
        workspaceRoot(),
      );

      await withStartedChild(agentChild, agentPort, async () => {
        const verifierOobi = `http://127.0.0.1:${agentPort}/oobi/${verifierPre}/controller`;
        const resolved = await requireSuccess(
          "kli resolve tufa verifier",
          runCmd(kliCommand, [
            "oobi",
            "resolve",
            ...kliStoreArgs(holderName, passcode),
            "--oobi",
            verifierOobi,
            "--oobi-alias",
            "verifier",
          ], env),
        );
        assertStringIncludes(resolved.stdout, "resolved");

        const grant = await requireSuccess(
          "kli holder ipex grant",
          runCmdWithTimeout(
            kliCommand,
            [
              "ipex",
              "grant",
              ...kliStoreArgs(holderName, passcode),
              "--alias",
              "holder",
              "--recipient",
              "verifier",
              "--said",
              credentialSaid,
              "--message",
              "presentation ok",
            ],
            env,
            30_000,
          ),
        );
        assertStringIncludes(grant.stdout, "grant message sent");
      });

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

      const revocationProviderAgentChild = spawnChild(
        Deno.execPath(),
        [
          "run",
          "--allow-all",
          "--unstable-ffi",
          "packages/tufa/mod.ts",
          "agent",
          ...tufaStoreArgs(providerName, tufaHeadDir, passcode),
          "--port",
          String(providerAgentPort),
        ],
        env,
        workspaceRoot(),
      );

      await withStartedChild(revocationProviderAgentChild, providerAgentPort, async () => {
        const revoked = await requireSuccess(
          "tufa issuer revoke send to KLI holder",
          runTufaWithTimeout(
            [
              "vc",
              "revoke",
              ...tufaStoreArgs(issuerName, tufaHeadDir, passcode),
              "--alias",
              "issuer",
              "--registry-name",
              "issuer-reg",
              "--said",
              credentialSaid,
              "--delivery",
              "indirect",
            ],
            env,
            workspaceRoot(),
            60_000,
          ),
        );
        const revokedJson = parseJsonLine(revoked.stdout);
        assertEquals(revokedJson.status, "accept");

        const listedRevoked = await requireSuccess(
          "kli holder revocation poll",
          runCmdWithTimeout(
            kliCommand,
            [
              "vc",
              "list",
              ...kliStoreArgs(holderName, passcode),
              "--alias",
              "holder",
              "--poll",
              "--schema",
              schemaSaid,
            ],
            env,
            45_000,
          ),
        );
        assertStringIncludes(listedRevoked.stdout, credentialSaid);
        assertStringIncludes(listedRevoked.stdout, "Status: Revoked");
      });
    });
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => undefined);
    await Deno.remove(ctx.home, { recursive: true }).catch(() => undefined);
  }
});
