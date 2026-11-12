#!/usr/bin/env -S deno run -A

/**
 * Check that `@keri-ts/wallet/web` stays free of the native LMDB backend and that
 * the built npm manifest exposes the Node root and browser entry truthfully.
 *
 * The root `@keri-ts/wallet` reaches `keri-ts/db/lmdb` through `createWalletBaser`
 * on purpose, so only `./web` is gated here and the root must not claim a
 * `browser` condition.
 */

import { assertBrowserGraphClean } from "../../../scripts/npm/dnt-helpers.ts";

interface DenoInfoModule {
  specifier?: string;
  dependencies?: { code?: { specifier?: string } }[];
}
interface DenoInfoOutput {
  roots?: string[];
  redirects?: Record<string, string>;
  modules?: DenoInfoModule[];
}
interface ExportTarget {
  browser?: string;
  import: string;
  types: string;
}

const PACKAGE_DIR = new URL("../", import.meta.url);
const NPM_DIR = new URL("../npm/", import.meta.url);
const WEB_ENTRYPOINT = new URL("../web.ts", import.meta.url);

/** Host modules and the LMDB-bound wallet module that `./web` must never load. */
const WEB_FORBIDDEN = ["npm:lmdb", "npm:/lmdb@", "node:", "/db-lmdb.ts", "/src/lmdb-storing.ts"];

/** Runtime (non-type) module reach of one entrypoint, following `deno info`. */
async function reach(entrypoint: URL): Promise<string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint.pathname],
    cwd: PACKAGE_DIR.pathname,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (output.code !== 0) {
    throw new Error(`deno info failed for ${entrypoint.pathname}\n${new TextDecoder().decode(output.stderr)}`);
  }
  const info = JSON.parse(new TextDecoder().decode(output.stdout)) as DenoInfoOutput;
  const modules = new Map((info.modules ?? []).map((module) => [module.specifier, module]));
  const seen = new Set<string>();
  const pending = [...(info.roots ?? [])];
  while (pending.length > 0) {
    const raw = pending.pop()!;
    const specifier = info.redirects?.[raw] ?? raw;
    if (seen.has(specifier)) continue;
    seen.add(specifier);
    for (const dependency of modules.get(specifier)?.dependencies ?? []) {
      if (dependency.code?.specifier) pending.push(dependency.code.specifier);
    }
  }
  return [...seen];
}

/** `./web` must reach no LMDB, `node:` module or `Deno` global in the sources it loads. */
async function assertWebSurface(): Promise<void> {
  const specifiers = await reach(WEB_ENTRYPOINT);
  const hits = specifiers.filter((specifier) => WEB_FORBIDDEN.some((pattern) => specifier.includes(pattern)));
  const denoUse = specifiers.filter((specifier) =>
    specifier.startsWith("file://") && /\bDeno\./.test(Deno.readTextFileSync(new URL(specifier)))
  );
  const problems = [...hits.map((hit) => `forbidden module ${hit}`), ...denoUse.map((use) => `Deno global in ${use}`)];
  if (problems.length > 0) {
    throw new Error(`wallet web surface is not browser-safe:\n  ${problems.sort().join("\n  ")}`);
  }
}

/** The built manifest: root Node-only (no `browser`), `./web` browser-safe with a clean graph. */
function assertManifest(): void {
  let raw: string;
  try {
    raw = Deno.readTextFileSync(new URL("package.json", NPM_DIR));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    console.warn("Skipping npm manifest check because packages/wallet/npm/package.json has not been generated.");
    return;
  }
  const manifest = JSON.parse(raw) as { exports?: Record<string, ExportTarget> };
  const exported = manifest.exports ?? {};
  if (Object.keys(exported).sort().join() !== [".", "./web"].join()) {
    throw new Error(`wallet exports drifted: ${Object.keys(exported).join(", ")}`);
  }
  if (exported["."].browser !== undefined) {
    throw new Error("Root export reaches LMDB and must not declare a browser condition");
  }
  const web = exported["./web"];
  if (!web.browser || !web.import || !web.types) {
    throw new Error("./web export needs browser, import and types targets");
  }
  assertBrowserGraphClean(NPM_DIR.pathname, [web.browser]);
}

await assertWebSurface();
assertManifest();
console.log("wallet library boundary ok");
