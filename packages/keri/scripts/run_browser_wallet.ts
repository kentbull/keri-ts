/**
 * Real-browser wallet scenario: a wallet opened with `openWebWallet` on IndexedDB inside Chromium,
 * WebKit or Firefox, talking to a KERIpy witness, a Tufa mailbox and a Tufa counterparty that run in
 * Docker (`scripts/ci/browser-wallet-servers.sh`). The scenario steps are in
 * `test/browser-wallet/scenario.ts` (Deno side) and `steps.ts` (page side).
 *
 * Usage (from packages/keri, or `deno task test:browser:wallet` anywhere):
 *   deno task test:browser:wallet [chromium|firefox|webkit ...]
 * Servers come from `KERI_WALLET_SERVERS` (the JSON `browser-wallet-servers.sh up` prints) or, when
 * unset, from that script. Every step is timed; a per-engine table is printed at the end and any
 * failed or skipped step fails the run. `KERI_WALLET_REPORT=<file>` also writes the results as JSON.
 */

import { type Context, type PeerResult, steps } from "../test/browser-wallet/scenario.ts";
import type { StepArgs } from "../test/browser-wallet/steps.ts";
import { bundle, launch, openPage, selectEngines, serve } from "./browser_lane.ts";

const walletDir = new URL("../test/browser-wallet/", import.meta.url);
const serversScript = new URL("../../../scripts/ci/browser-wallet-servers.sh", import.meta.url).pathname;
/** Longest a single page step or counterparty command may take. */
const STEP_LIMIT_MS = 300_000;

interface Servers {
  witness: { origin: string; pre: string };
  mailbox: { origin: string; pre: string };
  peer: { origin: string };
}

/** Outcome of one step in one engine. */
interface StepResult {
  name: string;
  status: "pass" | "FAIL" | "skipped";
  ms: number;
  detail: string;
}

/** Run the server script and return its endpoint JSON (or nothing for `down`). */
async function serverScript(verb: "up" | "down"): Promise<string> {
  const out = await new Deno.Command("bash", { args: [serversScript, verb], stdout: "piped", stderr: "inherit" })
    .output();
  if (!out.success) throw new Error(`browser-wallet-servers.sh ${verb} failed`);
  return new TextDecoder().decode(out.stdout);
}

/** Reject after `ms` so a hung page or command fails its step instead of the lane. */
function limited<T>(label: string, work: Promise<T>, ms = STEP_LIMIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Run one `tufa` command on the counterparty; throws unless it exits 0. */
async function runPeer(peer: string, args: string[], timeoutMs = 120_000): Promise<PeerResult> {
  const response = await limited(
    `tufa ${args.slice(0, 2).join(" ")}`,
    fetch(`${peer}/tufa`, { method: "POST", body: JSON.stringify({ args, timeoutMs }) }),
    timeoutMs + 30_000,
  );
  const result = await response.json() as PeerResult;
  if (result.code !== 0) {
    throw new Error(
      `tufa ${args.join(" ").replace(/-p \S+/, "-p ***")} exited ${result.code}${
        result.timedOut ? " (timed out)" : ""
      }\n${result.stdout}\n${result.stderr}`.slice(0, 4000),
    );
  }
  return result;
}

/** Run the whole scenario in one engine with a fresh page, wallet name and counterparty state. */
async function runEngine(name: string, pageUrl: string, servers: Servers): Promise<StepResult[]> {
  const browser = await launch(name);
  const results: StepResult[] = [];
  try {
    const tab = await browser.newPage();
    tab.on("pageerror", (error) => console.error(`[${name}] page error: ${error.message}`));
    tab.on("console", (message) => console.log(`[${name}] ${message.text()}`));
    // Non-2xx responses with the request that drew them: the browser console only says "Failed to load resource".
    tab.on("response", async (response) => {
      if (response.status() >= 400) {
        const request = response.request();
        const body = await response.text().catch(() => "");
        console.log(
          `[${name}] HTTP ${response.status()} ${request.method()} ${response.url()} ${
            request.headers()["cesr-destination"] ?? ""
          } ${body.slice(0, 300)}`,
        );
      }
    });
    await openPage(tab, pageUrl, "keriWallet");
    console.log(`\n=== ${name} ${browser.version()}`);
    const base: StepArgs = {
      witness: servers.witness,
      mailbox: servers.mailbox,
      name: `wallet-${name}-${crypto.randomUUID().slice(0, 8)}`,
      bran: "abcdefghijklmnopqrstu",
    };
    const store = [
      "-n",
      `peer-${name}-${crypto.randomUUID().slice(0, 8)}`,
      "--head-dir",
      "/work/peer",
      "-p",
      "abcdefghijklmnopqrstu",
    ];
    const context: Context = {
      page: (step, args = {}) =>
        limited(
          `page step ${step}`,
          tab.evaluate(
            ([step, args]) =>
              (globalThis as unknown as { keriWallet: { step(n: string, a: unknown): Promise<unknown> } }).keriWallet
                .step(step, args),
            [step, { ...base, ...args }] as const,
          ),
        ),
      peer: (args, timeoutMs) => runPeer(servers.peer.origin, args, timeoutMs),
      peerConfig: async (config) => {
        const response = await fetch(`${servers.peer.origin}/config`, {
          method: "POST",
          body: JSON.stringify({ name: store[1], config }),
        });
        if (!response.ok) throw new Error(`peer config failed: ${await response.text()}`);
      },
      store,
      facts: {},
      servers,
    };
    const passed = new Set<string>();
    for (const step of steps) {
      const missing = (step.needs ?? []).filter((need) => !passed.has(need));
      if (missing.length) {
        results.push({ name: step.name, status: "skipped", ms: 0, detail: `needs ${missing.join("; ")}` });
        continue;
      }
      const started = performance.now();
      try {
        const value = await step.run(context);
        const ms = Math.round(performance.now() - started);
        results.push({ name: step.name, status: "pass", ms, detail: JSON.stringify(value) ?? "" });
        passed.add(step.name);
      } catch (error) {
        const ms = Math.round(performance.now() - started);
        results.push({
          name: step.name,
          status: "FAIL",
          ms,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      const last = results.at(-1)!;
      console.log(`${last.status} ${last.name} (${last.ms} ms) ${last.detail.slice(0, 3500)}`);
    }
  } finally {
    await browser.close();
  }
  return results;
}

/** Print one row per step with a column per engine. */
function table(all: Record<string, StepResult[]>): void {
  const engines = Object.keys(all);
  console.log(`\n| step | ${engines.join(" | ")} |\n|---|${engines.map(() => "---|").join("")}`);
  for (const step of steps) {
    const cells = engines.map((engine) => {
      const result = all[engine].find(({ name }) => name === step.name);
      return result ? `${result.status} ${(result.ms / 1000).toFixed(1)} s` : "not run";
    });
    console.log(`| ${step.name} | ${cells.join(" | ")} |`);
  }
}

const outDir = await Deno.makeTempDir({ prefix: "keri-wallet-" });
let startedServers = false;
let failed = false;
try {
  const selected = selectEngines();
  const given = Deno.env.get("KERI_WALLET_SERVERS");
  startedServers = !given;
  const servers = JSON.parse(given ?? await serverScript("up")) as Servers;
  await bundle(outDir, "test/browser-wallet/main.ts", new URL("index.html", walletDir));
  const { origin, server } = serve(outDir);
  try {
    const all: Record<string, StepResult[]> = {};
    for (const engine of selected) {
      // Each engine gets its own counterparty identity: clear it between engines through a fresh store name.
      all[engine] = await runEngine(engine, origin, servers).catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        return [{ name: "engine", status: "FAIL" as const, ms: 0, detail: String(error) }];
      });
    }
    table(all);
    const report = Deno.env.get("KERI_WALLET_REPORT");
    if (report) await Deno.writeTextFile(report, JSON.stringify(all, null, 2));
    failed = Object.values(all).some((results) => results.some(({ status }) => status !== "pass"));
    console.log(`\nsummary: ${selected.join(", ")} ${failed ? "FAILED" : "all steps passed"}`);
  } finally {
    await server.shutdown();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failed = true;
} finally {
  if (startedServers) await serverScript("down").catch((error) => console.error(error.message));
  await Deno.remove(outDir, { recursive: true });
}
Deno.exit(failed ? 1 : 0);
