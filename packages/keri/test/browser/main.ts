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
}

async function runCase({ name, fn }: Case): Promise<CaseResult> {
  try {
    await fn();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
  }
}

const state: BrowserRun = { done: false, engine: navigator.userAgent, results: [] };
(globalThis as unknown as { keriBrowserRun: BrowserRun }).keriBrowserRun = state;

for (const testCase of collect(registerCases)) state.results.push(await runCase(testCase));
state.done = true;
