#!/usr/bin/env -S deno run -A
/**
 * Build the shared KERIpy interop caches once, before any test file starts.
 *
 * Usage: provision-keripy.ts <keripy|did-webs>...
 *
 * The group runner calls this ahead of owners that run files concurrently, so two test processes
 * never race to create the same venv under ~/.cache/tufa-interop. The helpers behind it take a
 * cache lock and skip finished entries, so a direct `deno test` stays safe and a warm cache costs
 * one marker check.
 */
import {
  ensurePinnedDidWebsResolver,
  ensurePinnedKeripyKli,
} from "../../packages/keri/test/integration/app/interop-test-helpers.ts";

const env = Deno.env.toObject();
for (const target of Deno.args) {
  if (target === "keripy") console.log(`==> KERIpy interop CLI: ${await ensurePinnedKeripyKli(env)}`);
  else if (target === "did-webs") {
    console.log(`==> did-webs-resolver: ${(await ensurePinnedDidWebsResolver(env)).dwsCommand}`);
  } else throw new Error(`Unknown provisioning target ${target}; choose keripy or did-webs.`);
}
