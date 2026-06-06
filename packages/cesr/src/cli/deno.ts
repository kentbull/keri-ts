/** Deno launcher for the runtime-neutral package-level `tephra` CLI. */
import { createDenoCliIo } from "./io-deno.ts";
import { tephraCli } from "./main.ts";

if (import.meta.main) {
  const code = await tephraCli(Deno.args, createDenoCliIo());
  Deno.exit(code);
}
