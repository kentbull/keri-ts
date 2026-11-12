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

import { registerCases } from "../test/browser/cases.ts";
import { collect } from "../test/browser/collector.ts";
import type { BrowserRun } from "../test/browser/main.ts";
import { bundle, launch, selectEngines, serve } from "./browser_lane.ts";

const browserDir = new URL("../test/browser/", import.meta.url);

/** Run the page once in one engine and report; true when it matched Deno's case set and all passed. */
async function runEngine(name: string, origin: string, expected: string[]): Promise<boolean> {
  const browser = await launch(name);
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
  await bundle(outDir, "test/browser/main.ts", new URL("index.html", browserDir));
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
