/** The mailbox poller's state machine as pure transitions: no clock, no network. */
import { assertEquals } from "jsr:@std/assert";
import {
  backOff,
  classifyPollRefusal,
  MailboxPoller,
  nextPoll,
  type PollOutcome,
  type PollState,
} from "../../../../src/app/mailbox/mailbox-poller.ts";

const { initialMs, maxMs } = MailboxPoller.RefusalBackoff;

Deno.test("nextPoll: a served poll resets the backoff and polls at once", () => {
  assertEquals(nextPoll({ backoffMs: 8_000 }, "served"), { state: { backoffMs: 0 }, action: { kind: "poll" } });
});

Deno.test("nextPoll: a refused, silent or unreachable mailbox doubles the wait up to the cap", () => {
  for (const outcome of ["refused", "no-response", "unreachable"] as PollOutcome[]) {
    let state: PollState = { backoffMs: 0 };
    const waits: number[] = [];
    for (let poll = 0; poll < 8; poll++) {
      const step = nextPoll(state, outcome);
      assertEquals(step.action.kind, "wait", outcome);
      state = step.state;
      waits.push(step.action.kind === "wait" ? step.action.ms : -1);
    }
    assertEquals(waits, [initialMs, 2 * initialMs, 4 * initialMs, 8 * initialMs, 16 * initialMs, maxMs, maxMs, maxMs]);
  }
  assertEquals(backOff({ backoffMs: maxMs }), { state: { backoffMs: maxMs }, action: { kind: "wait", ms: maxMs } });
});

Deno.test("nextPoll: a 403 prompts the publisher, then waits like any refusal", () => {
  assertEquals(nextPoll({ backoffMs: 0 }, "unauthorized"), {
    state: { backoffMs: initialMs },
    action: { kind: "prompt-publisher", ms: initialMs },
  });
  assertEquals(nextPoll({ backoffMs: initialMs }, "unauthorized").action, {
    kind: "prompt-publisher",
    ms: 2 * initialMs,
  });
});

Deno.test("classifyPollRefusal: 403 is unauthorized, every other status is refused", () => {
  assertEquals([403, 500, 406, 401, 404].map(classifyPollRefusal), [
    "unauthorized",
    "refused",
    "refused",
    "refused",
    "refused",
  ]);
});

Deno.test("a supplied refusal policy sets the wait instead of the production default", () => {
  assertEquals(backOff({ backoffMs: 0 }, { initialMs: 5, maxMs: 12 }), {
    state: { backoffMs: 5 },
    action: { kind: "wait", ms: 5 },
  });
  assertEquals(backOff({ backoffMs: 10 }, { initialMs: 5, maxMs: 12 }), {
    state: { backoffMs: 12 },
    action: { kind: "wait", ms: 12 },
  });
});
