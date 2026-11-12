/**
 * Real-browser lane: bundle `test/browser/main.ts`, serve it locally, run it in Chromium
 * through Playwright, and fail unless the browser executed exactly the cases `deno test`
 * would register, every one passing.
 *
 * One-time setup (browser binaries land in Playwright's user cache, nothing is committed):
 *   npx playwright-core@1.56.1 install chromium
 */

import { chromium } from "npm:playwright-core@1.56.1";
import { registerCases } from "../test/browser/cases.ts";
import { collect } from "../test/browser/collector.ts";
import type { BrowserRun } from "../test/browser/main.ts";

const browserDir = new URL("../test/browser/", import.meta.url);
const packageDir = new URL("../", import.meta.url);

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

const expected = collect(registerCases).map(({ name }) => name);
const outDir = await Deno.makeTempDir({ prefix: "keri-browser-" });
let failed = false;
try {
  await bundle(outDir);
  const { origin, server } = serve(outDir);
  const browser = await chromium.launch().catch((error) => {
    throw new Error(`${error.message}\nInstall it with: npx playwright-core@1.56.1 install chromium`);
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
    await page.goto(origin);
    await page.waitForFunction(() => (globalThis as unknown as { keriBrowserRun: BrowserRun }).keriBrowserRun.done, {
      timeout: 300_000,
    });
    const run = await page.evaluate(() => (globalThis as unknown as { keriBrowserRun: BrowserRun }).keriBrowserRun);
    for (const { name, ok, error } of run.results) {
      console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n${error}`}`);
    }
    const passed = run.results.filter(({ ok }) => ok).length;
    const ran = run.results.map(({ name }) => name);
    const missing = expected.filter((name) => !ran.includes(name));
    const extra = ran.filter((name) => !expected.includes(name));
    console.log(
      `\nChromium ${browser.version()} | ${run.engine}\ncases: browser ${ran.length}, deno ${expected.length}; `
        + `passed ${passed}, failed ${ran.length - passed}`,
    );
    if (missing.length || extra.length || ran.length !== expected.length) {
      console.error(
        `Case set differs from Deno. Missing: ${missing.join("; ") || "none"}. Extra: ${extra.join("; ") || "none"}.`,
      );
      failed = true;
    }
    if (passed !== ran.length) failed = true;
  } finally {
    await browser.close();
    await server.shutdown();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failed = true;
} finally {
  await Deno.remove(outDir, { recursive: true });
}
Deno.exit(failed ? 1 : 0);
