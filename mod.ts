#!/usr/bin/env -S deno run --allow-sys --allow-net --allow-env --allow-read --allow-write
import { run } from 'npm:effection@3.6.0';
import { kli } from './src/app/cli/cli.ts';

/**
 * Main entry point - Effection is the outermost runtime
 * All execution happens within Effection's structured concurrency
 */
if (import.meta.main) {
  run(
    () => kli(Deno.args)
  )
  .catch((error) => {
    console.error('Fatal error:', error);
    Deno.exit(1);
  }
);
}
