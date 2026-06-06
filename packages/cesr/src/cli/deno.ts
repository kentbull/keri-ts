/** Deno launcher for the runtime-neutral package-level `cesr` CLI. */
import { createDenoCliIo } from "./io-deno.ts";
import { cesrCli } from "./main.ts";

if (import.meta.main) {
  const code = await cesrCli(Deno.args, createDenoCliIo());
  Deno.exit(code);
}
