import { run } from "npm:effection@^3.6.0";
import { reportCliFailure, tufa } from "../keri/src/app/cli/cli.ts";

/**
 * `tufa` application entrypoint.
 *
 * Stage 1 ownership rule:
 * - the runnable CLI now lives in the `tufa` package
 * - `keri-ts` package roots stay library entrypoints
 */
run(() => tufa(Deno.args)).catch((error) => {
  Deno.exit(reportCliFailure(error));
});
