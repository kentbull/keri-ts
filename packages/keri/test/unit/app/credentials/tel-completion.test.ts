import { run, sleep, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  issuedCredentialStatus,
  type TelCompletionDeps,
  telEventStatus,
  waitForIssuedCredential,
  waitForTelEvent,
} from "../../../../src/app/credentials/tel-completion.ts";

type Progress = ReturnType<TelCompletionDeps["publication"]["progress"]>;

/** A publication whose durable progress and saved-credential evidence the test advances. */
function fakeDeps() {
  const state: { progress: Progress; saved: boolean } = { progress: null, saved: false };
  const deps: TelCompletionDeps = {
    publication: {
      progress: () => state.progress,
      reger: { saved: { get: () => state.saved ? {} : null } },
    } as unknown as TelCompletionDeps["publication"],
  };
  return { state, deps };
}

Deno.test("telEventStatus follows the publication stages", () => {
  const { state, deps } = fakeDeps();
  assertEquals(telEventStatus(deps, "EReg"), { state: "unknown", reason: "not-tracked" });
  for (const phase of ["awaitingAnchor", "awaitingReceipts", "awaitingPublication"] as const) {
    state.progress = phase;
    assertEquals(telEventStatus(deps, "EReg"), { state: "active", phase });
  }
  state.progress = "complete";
  assertEquals(telEventStatus(deps, "EReg"), { state: "complete" });
});

Deno.test("issuance is not complete until the credential is saved", () => {
  const { state, deps } = fakeDeps();
  state.progress = "complete";
  assertEquals(issuedCredentialStatus(deps, "ESaid"), { state: "active", phase: "awaitingCredentialSave" });
  state.saved = true;
  assertEquals(issuedCredentialStatus(deps, "ESaid"), { state: "complete" });
});

Deno.test("an expired TEL wait is a value carrying the last status", async () => {
  const { state, deps } = fakeDeps();
  state.progress = "awaitingReceipts";
  const result = await run(() => waitForTelEvent(deps, "EReg", 0, { deadline: Date.now() + 30 }));
  assertEquals(result.outcome, "timed-out");
  assertEquals(result.status, { state: "active", phase: "awaitingReceipts" });
  const zero = await run(() => waitForTelEvent(deps, "EReg", 0, { deadline: Date.now() }));
  assertEquals(zero.outcome, "timed-out");
});

Deno.test("TEL waits only observe: the host advances progress and nothing else is touched", async () => {
  const { state, deps } = fakeDeps();
  // Any member beyond the declared interface (a worker runner, the runtime) fails the test.
  const strict = new Proxy(deps, {
    get(target, prop, receiver) {
      if (prop !== "publication") throw new Error(`unexpected access: ${String(prop)}`);
      return Reflect.get(target, prop, receiver);
    },
  });
  const settled = await run(function*() {
    yield* spawn(function*() {
      yield* sleep(20);
      state.progress = "complete";
      yield* sleep(20);
      state.saved = true;
    });
    return yield* waitForIssuedCredential(strict, "ESaid", { deadline: Date.now() + 5_000 });
  });
  assertEquals(settled, { outcome: "settled", status: { state: "complete" } });
});
