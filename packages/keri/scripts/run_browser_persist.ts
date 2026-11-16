/**
 * Persistent-profile browser lane: write a keeper-shaped store and a web wallet in one browser launch,
 * close the context, relaunch the same profile directory, and verify every row and the wallet reopen.
 * A regular browser tab keeps IndexedDB in on-disk files, and an ephemeral context never exercises that
 * backend, so this lane is what covers reloads from disk.
 *
 * Usage (from packages/keri, or `deno task test:browser:persist` anywhere):
 *   deno task test:browser:persist [chromium|firefox|webkit ...]
 * One server serves both phases, so they share an origin and therefore one IndexedDB. Engine selection and
 * installation are as in `run_browser_tests.ts`.
 */

import type { KeriPersist } from "../test/browser/persist-main.ts";
import { bundle, launchPersistent, openPage, selectEngines, serve } from "./browser_lane.ts";

const browserDir = new URL("../test/browser/", import.meta.url);

type Phase = "write" | "verify";

/** Run one phase in a fresh launch of the profile in `profile`; returns what the page reports. */
async function phase(name: string, origin: string, profile: string, which: Phase, pre: string): Promise<string> {
  const context = await launchPersistent(name, profile);
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`[${name}] page error: ${error.message}`));
    await openPage(page, origin, "keriPersist");
    return await page.evaluate(
      ([which, pre]) => {
        const persist = (globalThis as unknown as { keriPersist: KeriPersist }).keriPersist;
        return which === "write" ? persist.write() : persist.verify(pre);
      },
      [which, pre] as const,
    );
  } finally {
    await context.close();
  }
}

/** Write in one launch and verify in the next; true when the second launch sees everything. */
async function runEngine(name: string, origin: string): Promise<boolean> {
  const profile = await Deno.makeTempDir({ prefix: `keri-persist-${name}-` });
  try {
    const pre = await phase(name, origin, profile, "write", "");
    console.log(`${name}: wrote wallet ${pre}`);
    console.log(`${name}: verified after relaunch: ${await phase(name, origin, profile, "verify", pre)}`);
    return true;
  } catch (error) {
    console.error(`${name}: FAILED after relaunch: ${error instanceof Error ? error.message : error}`);
    return false;
  } finally {
    await Deno.remove(profile, { recursive: true });
  }
}

const outDir = await Deno.makeTempDir({ prefix: "keri-persist-" });
let failed = false;
try {
  const selected = selectEngines();
  await bundle(outDir, "test/browser/persist-main.ts", new URL("index.html", browserDir));
  const { origin, server } = serve(outDir);
  const summary: string[] = [];
  try {
    for (const name of selected) {
      const ok = await runEngine(name, origin);
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
