/** Real prompt cancellation probe; SIGUSR1 requests Effection task halt. */
import { call, run, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import process from "node:process";
import { readPasscode } from "../../src/cli/common/passcode.ts";

const input = process.stdin;
input.setRawMode(true); // The prompt must restore a caller's already-raw mode too.
const before = {
  raw: input.isRaw ?? false,
  keypress: input.listenerCount("keypress"),
  end: input.listenerCount("end"),
  close: input.listenerCount("close"),
};
const stopped = Promise.withResolvers<void>();
const stop = () => stopped.resolve();
Deno.addSignalListener("SIGUSR1", stop);
try {
  await run(function*() {
    const task = yield* spawn(() => readPasscode("Passcode:"));
    yield* call(() => stopped.promise);
    yield* task.halt();
  });
  assertEquals(input.isRaw ?? false, before.raw);
  assertEquals(input.listenerCount("keypress"), before.keypress);
  assertEquals(input.listenerCount("end"), before.end);
  assertEquals(input.listenerCount("close"), before.close);
  console.log("passcode task halted and input restored");
} finally {
  input.setRawMode(false);
  Deno.removeSignalListener("SIGUSR1", stop);
}
