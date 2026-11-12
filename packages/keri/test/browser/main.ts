/** Browser entry: collect the cases, run them in order, and publish results on `window`. */

import { registerCases } from "./cases.ts";
import { type Case, collect } from "./collector.ts";

export interface CaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

export interface BrowserRun {
  done: boolean;
  engine: string;
  results: CaseResult[];
  /** Observations the cases reported through `note`. */
  notes: string[];
  elapsedMs: number;
  /** The case running now, so a runner that times out can name it. */
  current?: string;
}

async function runCase({ name, fn }: Case): Promise<CaseResult> {
  try {
    await fn();
    return { name, ok: true };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error),
    };
  }
}

const started = performance.now();
const state: BrowserRun = { done: false, engine: navigator.userAgent, results: [], notes: [], elapsedMs: 0 };
(globalThis as unknown as { keriBrowserNotes: string[] }).keriBrowserNotes = state.notes;
(globalThis as unknown as { keriBrowserRun: BrowserRun }).keriBrowserRun = state;

for (const testCase of collect(registerCases)) {
  state.current = testCase.name;
  state.results.push(await runCase(testCase));
}
state.elapsedMs = performance.now() - started;
state.done = true;
