/** Operator validation belongs to the Tufa-owned verifier command. */
import { VerifierAgent, VerifierCueBaser } from "@keri-ts/verifier";
import { run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createHabery, ValidationError } from "keri-ts/runtime";
import { verifierRunCommand } from "../../src/cli/commands/verifier.ts";

Deno.test({
  name: "verifier command rejects malformed flags before storage or config I/O",
  permissions: { read: false, write: false, net: false },
  async fn() {
    await assertRejects(() => run(() => verifierRunCommand({ once: "false" })), ValidationError, "once");
    const acdcV2 = {
      name: "unopened",
      hook: "http://unused.test/",
      acdcV2: true,
      alias: "verifier",
      observer: "https://observer.test/",
    };
    await assertRejects(
      () => run(() => verifierRunCommand({ ...acdcV2, observer: "http://observer.test/" })),
      ValidationError,
      "HTTPS",
    );
    for (const key of ["maximumAgeMs", "sourceTimeoutMs"] as const) {
      await assertRejects(() => run(() => verifierRunCommand({ ...acdcV2, [key]: 0 })), ValidationError, "positive");
    }
    for (const intervalMs of [null, "", false, [], Infinity, -1]) {
      await assertRejects(() => run(() => verifierRunCommand({ intervalMs })), ValidationError, "intervalMs");
    }
  },
});

Deno.test("verifier command preserves owned-close failures and reports success only after cleanup", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "verifier-command-close-" });
  const name = "verifier";
  await run(function*() {
    const hby = yield* createHabery({ name, headDirPath, skipConfig: true });
    yield* hby.close();
  });
  const close = VerifierCueBaser.prototype.close, processOnce = VerifierAgent.prototype.processOnce;
  const log = console.log, lines: unknown[][] = [];
  const closeFailure = new Error("cue store close fault"), operationFailure = new Error("verifier operation fault");
  try {
    console.log = (...args) => {
      lines.push(args);
    };
    VerifierCueBaser.prototype.close = function*(this: VerifierCueBaser, ...args: Parameters<typeof close>) {
      yield* close.apply(this, args);
      throw closeFailure;
    };
    const args = { name, headDirPath, hook: "http://unused.test/", once: true };
    const closed = await assertRejects(() => run(() => verifierRunCommand(args)));
    assertStrictEquals(closed, closeFailure);
    assertEquals(lines, []);
    VerifierAgent.prototype.processOnce = function*() {
      throw operationFailure;
    };
    const both = await assertRejects(() => run(() => verifierRunCommand(args)), AggregateError);
    assertEquals(both.errors, [operationFailure, closeFailure]);
    assertEquals(lines, []);
  } finally {
    console.log = log;
    VerifierCueBaser.prototype.close = close;
    VerifierAgent.prototype.processOnce = processOnce;
    await Deno.remove(headDirPath, { recursive: true });
  }
});
