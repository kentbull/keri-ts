#!/usr/bin/env -S deno run --allow-sys --allow-net --allow-env --allow-read --allow-write
import { type Operation, run, spawn } from 'npm:effection@3.6.0';
import { startServer } from './server.ts';

run(function* (): Operation<void> {
  const serverTask = yield* spawn(() => startServer());
  yield* serverTask;
  console.log('Shutdown complete.');
}).catch(console.error);
