import { benchmarkCli, createDenoBenchmarkIo } from "./cli.ts";

if (import.meta.main) {
  // Minimal executable wrapper: keep runtime wiring separate from benchmark logic.
  const code = await benchmarkCli(Deno.args, createDenoBenchmarkIo());
  Deno.exit(code);
}
