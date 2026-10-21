/** Operator validation belongs to the Tufa-owned verifier command. */
import { run } from "effection";
import { assertRejects } from "jsr:@std/assert";
import { ValidationError } from "keri-ts/runtime";
import { verifierRunCommand } from "../../src/cli/verifier.ts";

Deno.test({
  name: "verifier command rejects malformed flags before storage or config I/O",
  permissions: { read: false, write: false, net: false },
  async fn() {
    await assertRejects(() => run(() => verifierRunCommand({ once: "false" })), ValidationError, "once");
    for (const intervalMs of [null, "", false, [], Infinity, -1]) {
      await assertRejects(() => run(() => verifierRunCommand({ intervalMs })), ValidationError, "intervalMs");
    }
  },
});
