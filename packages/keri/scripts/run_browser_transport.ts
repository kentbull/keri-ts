/**
 * Real-browser transport probe: serve keri-ts's browser bundle from one origin, point it at a KERIpy
 * witness, a Tufa mailbox and the lane's echo server on other origins, run every probe in each
 * engine, and fail unless each result matches `test/browser-transport/expectations.ts`.
 *
 * Usage (from packages/keri, or `deno task test:browser:transport` anywhere):
 *   deno task test:browser:transport [chromium|firefox|webkit ...]
 * Servers come from `KERI_TRANSPORT_SERVERS` (JSON `{"keripy":{"origin","pre"},"tufa":{...}}`) or, when
 * unset, from `scripts/ci/browser-transport-servers.sh up` (Docker; see that script). Set
 * `KERI_TRANSPORT_REPORT=<file>` to also write the observations as JSON, and `KERI_TRANSPORT_ONLY=<regex>`
 * to run only the probes whose `probe|server` matches (the table check then reports the rest as missing).
 */

import { type Engine, EXPECTED, expectedFor } from "../test/browser-transport/expectations.ts";
import type { Config, ProbeResult } from "../test/browser-transport/probes.ts";
import { bundle, launch, selectEngines, serve } from "./browser_lane.ts";
import { startEcho } from "./transport_echo.ts";

const transportDir = new URL("../test/browser-transport/", import.meta.url);
const serversScript = new URL("../../../scripts/ci/browser-transport-servers.sh", import.meta.url).pathname;

/** Request-header sets keri-ts sends, by name: the method and the headers that need preflight approval. */
const PREFLIGHTS: Record<string, [method: string, headers: string[], path?: string]> = {
  "POST detached CESR": ["POST", ["content-type", "cesr-attachment", "cesr-destination"]],
  "POST detached CESR v2": ["POST", ["content-type", "cesr-attachment", "cesr-destination", "cesr-genus"]],
  "PUT native CESR": ["PUT", ["content-type", "cesr-destination"]],
  "POST with Authorization": ["POST", ["content-type", "cesr-attachment", "cesr-destination", "authorization"]],
  "POST multipart admin": ["POST", ["cesr-destination"], "/mailboxes"],
};

/** Run the server script and return its endpoint JSON. */
async function servers(verb: "up" | "down"): Promise<string> {
  const out = await new Deno.Command("bash", { args: [serversScript, verb], stdout: "piped", stderr: "inherit" })
    .output();
  if (!out.success) throw new Error(`browser-transport-servers.sh ${verb} failed`);
  return new TextDecoder().decode(out.stdout);
}

/**
 * Send the preflight a browser would send and apply the Fetch check to the answer. This runs outside
 * the browser, so it can record the exact response headers; the browsers' own outcomes are probed separately.
 */
async function preflight(
  origin: string,
  page: string,
  [method, headers, path = "/"]: [string, string[], string?],
): Promise<ProbeResult["observed"]> {
  const response = await fetch(`${origin}${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: page,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": headers.join(","),
    },
  });
  await response.body?.cancel();
  const get = (name: string) => response.headers.get(name) ?? "";
  const list = (name: string) => get(name).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!response.ok) return `blocked: HTTP ${response.status}`;
  if (![page, "*"].includes(get("access-control-allow-origin"))) return "blocked: no Allow-Origin";
  const methodOk = ["GET", "HEAD", "POST"].includes(method)
    || list("access-control-allow-methods").includes(method.toLowerCase());
  const allowed = list("access-control-allow-headers");
  const missing = headers.filter((name) =>
    !allowed.includes(name) && !(allowed.includes("*") && name !== "authorization")
  );
  return methodOk && !missing.length
    ? "allowed"
    : `blocked: ${methodOk ? "" : `method ${method} `}${missing.join(",")}`.trim();
}

/** Run the page once in one engine; returns its probe results. */
async function runEngine(name: string, page: string, config: Config): Promise<ProbeResult[]> {
  const browser = await launch(name);
  try {
    const tab = await browser.newPage();
    tab.on("pageerror", (error) => console.error(`[${name}] page error: ${error.message}`));
    tab.on("console", (message) => console.log(`[${name}] ${message.text()}`));
    await tab.goto(page);
    console.log(`\n=== ${name} ${browser.version()}`);
    const run = tab.evaluate(
      (config) =>
        (globalThis as unknown as { keriTransport: { run(c: Config): Promise<ProbeResult[]> } }).keriTransport.run(
          config,
        ),
      config,
    );
    // A hung engine fails the lane instead of stalling it.
    const limit = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${name}: probes exceeded 10 minutes`)), 600_000)
    );
    return await Promise.race([run, limit]);
  } finally {
    await browser.close();
  }
}

/** Compare observations with the table; every expected row must be observed, every observation expected. */
function check(label: string, engine: Engine, results: ProbeResult[], preflights: boolean): string[] {
  const problems: string[] = [];
  for (const { probe, server, ok, observed, detail } of results) {
    const want = expectedFor(probe, server, engine);
    console.log(`${ok ? "pass" : "fail"} ${probe} | ${server} | ${observed}${detail ? `  [${detail}]` : ""}`);
    if (!want) problems.push(`${label}: no expectation for ${probe}|${server} (observed ${observed})`);
    else if (want.ok !== ok || want.observed !== observed) {
      problems.push(`${label}: ${probe}|${server} expected ${want.observed} (${want.reason}), observed ${observed}`);
    }
  }
  const seen = new Set(results.map(({ probe, server }) => `${probe}|${server}`));
  for (const key of Object.keys(EXPECTED)) {
    if (
      key.startsWith("preflight ") === preflights && !seen.has(key)
      && expectedFor(...(key.split("|") as [string, string]), engine)
    ) {
      problems.push(`${label}: expected ${key} was never observed`);
    }
  }
  return problems;
}

const outDir = await Deno.makeTempDir({ prefix: "keri-transport-" });
const echo = startEcho();
let startedServers = false;
let failed = false;
try {
  const selected = selectEngines();
  const given = Deno.env.get("KERI_TRANSPORT_SERVERS");
  startedServers = !given;
  const endpoints = JSON.parse(given ?? await servers("up")) as Record<
    "keripy" | "tufa",
    { origin: string; pre: string }
  >;
  const config: Config = {
    ...endpoints,
    echo: { origin: echo.origin, pre: "" },
    only: Deno.env.get("KERI_TRANSPORT_ONLY"),
  };
  await bundle(outDir, "test/browser-transport/main.ts", new URL("index.html", transportDir));
  const { origin: page, server } = serve(outDir);
  try {
    const problems: string[] = [];
    console.log("\n=== preflight (sent from Deno with the page's Origin; the browsers' outcomes are probed below)");
    const preflights: ProbeResult[] = [];
    for (const name of ["keripy", "tufa"] as const) {
      for (const [label, spec] of Object.entries(PREFLIGHTS)) {
        const observed = await preflight(config[name].origin, page, spec);
        preflights.push({
          probe: `preflight ${label}`,
          server: name,
          ok: observed === "allowed",
          observed,
          detail: "",
        });
      }
    }
    problems.push(...check("preflight", "chromium", preflights, true));
    const all: Record<string, ProbeResult[]> = {};
    for (const engine of selected) {
      all[engine] = await runEngine(engine, page, config).catch((error) => {
        problems.push(`${engine}: ${error.message}`);
        return [];
      });
      if (all[engine].length) problems.push(...check(engine, engine as Engine, all[engine], false));
    }
    const report = Deno.env.get("KERI_TRANSPORT_REPORT");
    if (report) await Deno.writeTextFile(report, JSON.stringify({ preflights, all }, null, 2));
    for (const problem of problems) console.error(`MISMATCH ${problem}`);
    console.log(
      `\nsummary: ${selected.join(", ")} ${
        problems.length ? `${problems.length} mismatches` : "all probes match the expectation table"
      }`,
    );
    failed = problems.length > 0;
  } finally {
    await server.shutdown();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failed = true;
} finally {
  await echo.server.shutdown();
  if (startedServers) await servers("down").catch((error) => console.error(error.message));
  await Deno.remove(outDir, { recursive: true });
}
Deno.exit(failed ? 1 : 0);
