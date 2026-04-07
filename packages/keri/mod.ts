import { run } from "npm:effection@^3.6.0";
import { reportCliFailure, tufa } from "./src/app/cli/cli.ts";

/**
 * Main entry point - Effection is the outermost runtime
 * All execution happens within Effection's structured concurrency
 */
run(() => tufa(Deno.args)).catch((error) => {
  Deno.exit(reportCliFailure(error));
});
