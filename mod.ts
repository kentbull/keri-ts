import { run } from "npm:effection@^3.6.0";
import { kli } from "./src/app/cli/cli.ts";

/**
 * Main entry point - Effection is the outermost runtime
 * All execution happens within Effection's structured concurrency
 */
run(() => kli(Deno.args)).catch((error) => {
  console.error("Fatal error:", error);
  Deno.exit(1);
});
