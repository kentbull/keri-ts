/** Exercise the packed registry/credential command adapters through the actual Tufa launcher. */
import { Schemer } from "keri-ts/runtime";
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = "node_modules/@keri-ts/tufa";
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const launcher = join(packageRoot, manifest.bin.tufa);
const root = mkdtempSync(join(tmpdir(), "tufa-authoring-"));
const store = ["--name", "authoring", "--head-dir", root];

/** Launch the installed CLI, preserving command failure and its diagnostic output. */
function command(...args) {
  return execFileSync(process.execPath, [launcher, ...args], { encoding: "utf8" });
}

try {
  command("init", ...store, "--nopasscode");
  const inception = command("incept", ...store, "--alias", "issuer", "--transferable", "--toad", "0");
  const pre = inception.split(/\r?\n/).find(line => line.startsWith("Prefix"))
    ?.trim().split(/\s+/).at(-1);
  const registry = JSON.parse(command(
    "vc", "registry", "incept", ...store, "--alias", "issuer", "--registry-name", "registry",
  ));
  if (!pre || registry.issuer !== pre || registry.name !== "registry" || typeof registry.registry !== "string") {
    throw new Error("Installed registry adapter lost its created registry identity");
  }
  const schema = new Schemer({ sed: { type: "object" } });
  const schemaFile = join(root, "schema.json");
  writeFileSync(schemaFile, schema.raw);
  const credential = JSON.parse(command(
    "vc", "create", ...store, "--alias", "issuer", "--registry-name", "registry",
    "--schema-file", schemaFile, "--data", "{}",
  ));
  if (
    credential.registry !== registry.registry || credential.issuer !== pre || credential.schema !== schema.said
    || typeof credential.said !== "string" || typeof credential.tel !== "string" || credential.status !== "accept"
  ) {
    throw new Error(`Installed credential adapter lost its issuance result: ${JSON.stringify(credential)}`);
  }
  // Reuse this actual CLI-issued credential for the relocated application.
  const verifierStore = ["--name", "verifier", "--head-dir", root];
  command("init", ...verifierStore, "--nopasscode");
  const verifierInception = command("incept", ...verifierStore, "--alias", "verifier", "--transferable", "--toad", "0");
  const verifierPre = verifierInception.split(/\r?\n/).find(line => line.startsWith("Prefix"))?.trim().split(/\s+/).at(-1);
  if (!verifierPre) throw new Error("Installed verifier identity was not created");
  command("vc", "schema", "import", ...verifierStore, "--schema", schemaFile);
  const grantFile = join(root, "grant.cesr");
  command("ipex", "grant", ...store, "--alias", "issuer", "--recipient", verifierPre, "--said", credential.said, "--out", grantFile);
  command("vc", "import", ...verifierStore, "--in", grantFile);
  const webhooks = [];
  const hook = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    webhooks.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(202); response.end();
  });
  await new Promise((resolve, reject) => { hook.once("error", reject); hook.listen(0, "127.0.0.1", resolve); });
  try {
    const stdout = await new Promise((resolve, reject) => execFile(process.execPath, [launcher,
      "verifier", "run", ...verifierStore, "--once", "--hook", `http://127.0.0.1:${hook.address().port}/hook`,
    ], { encoding: "utf8", timeout: 30_000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    const result = JSON.parse(stdout).result;
    if (result.webhooksSent !== 1 || webhooks.length !== 1 || webhooks[0].action !== "iss" || webhooks[0].data.credential !== credential.said) {
      throw new Error("Installed verifier command did not deliver the accepted grant to its loopback webhook");
    }
  } finally { await new Promise((resolve, reject) => hook.close(error => error ? reject(error) : resolve())); }

  const anchorFile = join(root, "anchor.json");
  writeFileSync(anchorFile, JSON.stringify({ i: credential.said, s: "0", d: credential.tel }));
  const queried = command("query", ...store, "--alias", "issuer", "--prefix", pre, "--anchor", anchorFile);
  if (!queried.includes(`Identifier: ${pre}`) || !queried.includes("Seq No:")) {
    throw new Error("Installed query command lost its accepted anchor/state display");
  }

} finally {
  rmSync(root, { recursive: true, force: true });
}
console.error("Installed Tufa credential authoring, verifier webhook and accepted-anchor query adapters passed.");
