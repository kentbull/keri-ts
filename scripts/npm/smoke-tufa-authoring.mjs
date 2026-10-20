/** Exercise the packed registry/credential command adapters through the actual Tufa launcher. */
import { Schemer } from "keri-ts/runtime";
import { execFileSync } from "node:child_process";
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
  const anchorFile = join(root, "anchor.json");
  writeFileSync(anchorFile, JSON.stringify({ i: credential.said, s: "0", d: credential.tel }));
  const queried = command("query", ...store, "--alias", "issuer", "--prefix", pre, "--anchor", anchorFile);
  if (!queried.includes(`Identifier: ${pre}`) || !queried.includes("Seq No:")) {
    throw new Error("Installed query command lost its accepted anchor/state display");
  }

} finally {
  rmSync(root, { recursive: true, force: true });
}
console.error("Installed Tufa registry/credential authoring and accepted-anchor query adapters passed.");
