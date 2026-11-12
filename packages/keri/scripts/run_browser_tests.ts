/**
 * Real-browser lane: bundle `test/browser/main.ts`, serve it locally, run it in each
 * requested engine through Playwright, and fail unless every engine executed exactly the
 * cases `deno test` would register, every one passing.
 *
 * Usage (from packages/keri, or `deno task test:browser` anywhere):
 *   deno task test:browser                      all three engines
 *   deno task test:browser firefox webkit       only the named engines
 *   KERI_BROWSER_ENGINES=webkit deno task test:browser
 * Engines: chromium, firefox, webkit. Arguments win over the environment variable.
 *
 * One-time setup (binaries land in Playwright's user cache, nothing is committed):
 *   npx playwright-core@1.56.1 install chromium firefox webkit
 * On Linux add system libraries with scripts/ci/install-browser-deps.sh.
 */

import { type BrowserType, chromium, firefox, webkit } from "npm:playwright-core@1.56.1";
import { registerCases } from "../test/browser/cases.ts";
import { collect } from "../test/browser/collector.ts";
import type { BrowserRun } from "../test/browser/main.ts";

const browserDir = new URL("../test/browser/", import.meta.url);
const packageDir = new URL("../", import.meta.url);
const engines: Record<string, BrowserType> = { chromium, firefox, webkit };

/** Pick engines from arguments, then `KERI_BROWSER_ENGINES` (comma separated), else all. */
function selectEngines(): string[] {
  const requested = Deno.args.length ? Deno.args : (Deno.env.get("KERI_BROWSER_ENGINES")?.split(",") ?? []);
  const names = requested.map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !(name in engines));
  if (unknown.length) {
    throw new Error(`Unknown browser engine: ${unknown.join(", ")}. Choose from ${Object.keys(engines).join(", ")}.`);
  }
  return names.length ? [...new Set(names)] : Object.keys(engines);
}

/** Bundle the entry as ESM for the browser; the cesr-ts graph needs top-level await. */
async function bundle(outDir: string): Promise<void> {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform", "browser", "--format", "esm", "-o", `${outDir}/main.js`, "test/browser/main.ts"],
    cwd: packageDir,
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(`deno bundle failed:\n${new TextDecoder().decode(out.stderr)}`);
  const source = await Deno.readTextFile(`${outDir}/main.js`);
  const forbidden = source.match(
    /^\s*(?:import|export)\b[^\n]*\bfrom\s*["'][^"']*["']|\bimport\s*\(|["'](?:node:|npm:|jsr:|lmdb)[^"']*["']/m,
  );
  if (forbidden) throw new Error(`Bundle must be self-contained and LMDB-free; found ${forbidden[0].trim()}`);
  await Deno.copyFile(new URL("index.html", browserDir), `${outDir}/index.html`);
}

/** Serve the bundle directory on an ephemeral localhost port, a secure context for IndexedDB. */
function serve(dir: string): { origin: string; server: Deno.HttpServer } {
  const types: Record<string, string> = { "/": "text/html", "/index.html": "text/html", "/main.js": "text/javascript" };
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request) => {
    const path = new URL(request.url).pathname;
    const type = types[path];
    if (!type) return new Response("not found", { status: 404 });
    return new Response(await Deno.readFile(`${dir}/${path === "/" ? "index.html" : path.slice(1)}`), {
      headers: { "content-type": type },
    });
  });
  return { origin: `http://localhost:${server.addr.port}`, server };
}

/** Run the page once in one engine and report; true when it matched Deno's case set and all passed. */
async function runEngine(name: string, origin: string, expected: string[]): Promise<boolean> {
  const browser = await engines[name].launch().catch((error) => {
    throw new Error(`${error.message}\nInstall it with: npx playwright-core@1.56.1 install ${name}`);
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`[${name}] page error: ${error.message}`));
    await page.goto(origin);
    await page.waitForFunction(() => (globalThis as unknown as { keriBrowserRun: BrowserRun }).keriBrowserRun.done, {
      timeout: 300_000,
    });
    const run = await page.evaluate(() => (globalThis as unknown as { keriBrowserRun: BrowserRun }).keriBrowserRun);
    console.log(`\n=== ${name} ${browser.version()} | ${run.engine}`);
    for (const { name: caseName, ok, error } of run.results) {
      if (!ok) console.log(`FAIL ${caseName}\n${error}`);
    }
    for (const line of run.notes) console.log(`note: ${line}`);
    const passed = run.results.filter(({ ok }) => ok).length;
    const ran = run.results.map(({ name }) => name);
    const missing = expected.filter((caseName) => !ran.includes(caseName));
    const extra = ran.filter((caseName) => !expected.includes(caseName));
    console.log(
      `${name}: cases browser ${ran.length}, deno ${expected.length}; passed ${passed}, failed ${ran.length - passed}; `
        + `${(run.elapsedMs / 1000).toFixed(1)} s`,
    );
    if (missing.length || extra.length || ran.length !== expected.length) {
      console.error(
        `${name}: case set differs from Deno. Missing: ${missing.join("; ") || "none"}. Extra: ${
          extra.join("; ") || "none"
        }.`,
      );
      return false;
    }
    return passed === ran.length;
  } finally {
    await browser.close();
  }
}

const expected = collect(registerCases).map(({ name }) => name);
const outDir = await Deno.makeTempDir({ prefix: "keri-browser-" });
let failed = false;
try {
  const selected = selectEngines();
  await bundle(outDir);
  const { origin, server } = serve(outDir);
  const summary: string[] = [];
  try {
    for (const name of selected) {
      const ok = await runEngine(name, origin, expected).catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        return false;
      });
      summary.push(`${name} ${ok ? "ok" : "FAILED"}`);
      failed ||= !ok;
    }
  } finally {
    await server.shutdown();
  }
  console.log(`\nsummary: ${summary.join(", ")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failed = true;
} finally {
  await Deno.remove(outDir, { recursive: true });
}
Deno.exit(failed ? 1 : 0);
