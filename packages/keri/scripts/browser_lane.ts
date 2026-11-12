/**
 * Shared machinery of the real-browser lanes: choose engines, bundle a browser entry,
 * serve the bundle, and launch Playwright. `run_browser_tests.ts` (store contract) and
 * `run_browser_transport.ts` (HTTP transport probe) both build on it.
 */

import { type Browser, type BrowserType, chromium, firefox, webkit } from "npm:playwright-core@1.56.1";
import { echoHandler } from "./transport_echo.ts";

const packageDir = new URL("../", import.meta.url);
export const engines: Record<string, BrowserType> = { chromium, firefox, webkit };

/** Pick engines from arguments, then `KERI_BROWSER_ENGINES` (comma separated), else all. */
export function selectEngines(): string[] {
  const requested = Deno.args.length ? Deno.args : (Deno.env.get("KERI_BROWSER_ENGINES")?.split(",") ?? []);
  const names = requested.map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !(name in engines));
  if (unknown.length) {
    throw new Error(`Unknown browser engine: ${unknown.join(", ")}. Choose from ${Object.keys(engines).join(", ")}.`);
  }
  return names.length ? [...new Set(names)] : Object.keys(engines);
}

/**
 * Bundle `entry` (relative to packages/keri) as ESM for the browser and copy `html` beside it.
 * The cesr-ts graph needs top-level await; the bundle must be self-contained and LMDB-free.
 */
export async function bundle(outDir: string, entry: string, html: URL): Promise<void> {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform", "browser", "--format", "esm", "-o", `${outDir}/main.js`, entry],
    cwd: packageDir,
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(`deno bundle failed:\n${new TextDecoder().decode(out.stderr)}`);
  const source = await Deno.readTextFile(`${outDir}/main.js`);
  const forbidden = source.match(
    /^\s*(?:import|export)\b[^\n]*\bfrom\s*["'][^"']*["']|\bimport\s*\(|["'](?:node:|npm:|jsr:|lmdb)[^"']*["']/m,
  );
  if (forbidden) throw new Error(`Bundle must be self-contained and LMDB-free; found ${forbidden[0].trim()}`);
  await Deno.copyFile(html, `${outDir}/index.html`);
}

/**
 * Serve the bundle directory on an ephemeral localhost port, a secure context for IndexedDB.
 * Any other path goes to the echo handler, so cases can talk to a server on the page's own origin.
 */
export function serve(dir: string): { origin: string; server: Deno.HttpServer } {
  const echo = echoHandler();
  const types: Record<string, string> = { "/": "text/html", "/index.html": "text/html", "/main.js": "text/javascript" };
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request) => {
    const path = new URL(request.url).pathname;
    const type = types[path];
    if (!type) return await echo(request);
    return new Response(await Deno.readFile(`${dir}/${path === "/" ? "index.html" : path.slice(1)}`), {
      headers: { "content-type": type },
    });
  });
  return { origin: `http://localhost:${server.addr.port}`, server };
}

/** Launch one engine, naming the install command when its binary is missing. */
export async function launch(name: string): Promise<Browser> {
  return await engines[name].launch().catch((error) => {
    throw new Error(`${error.message}\nInstall it with: npx playwright-core@1.56.1 install ${name}`);
  });
}
