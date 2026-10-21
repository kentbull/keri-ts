import { run } from "effection";
import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import type { ChallengeResponsePayload } from "../../../../../src/app/identity/challenging.ts";
import { challengeGenerateCommand, challengeVerifyCommand } from "../../../../../src/cli/identity/challenge.ts";
import { testCLICommand } from "../../../../utils.ts";

// @ts-expect-error A challenge response must carry its word list.
void ({} satisfies ChallengeResponsePayload);
// @ts-expect-error Every challenge word is text, not an arbitrary decoded value.
void ({ words: ["valid", 7] } satisfies ChallengeResponsePayload);

Deno.test("challenge generate emits JSON, string, and newline-delimited outputs", async () => {
  const json = await run(() => testCLICommand(challengeGenerateCommand({ strength: 128, out: "json" })));
  const jsonWords = JSON.parse(json.output.at(-1) ?? "[]");
  assertEquals(Array.isArray(jsonWords), true);
  assertEquals(jsonWords.length >= 1, true);

  const string = await run(() => testCLICommand(challengeGenerateCommand({ strength: 128, out: "string" })));
  assertStringIncludes(string.output.at(-1) ?? "", " ");

  const words = await run(() => testCLICommand(challengeGenerateCommand({ strength: 128, out: "words" })));
  assertStringIncludes(words.output.at(-1) ?? "", "\n");
});

Deno.test({
  name: "challenge options reject invalid supplied values before storage",
  permissions: { read: false, write: false },
  fn: async () => {
    for (const strength of [0, -1, 1.5, null, "", false, Infinity]) {
      await assertRejects(() => run(() => challengeGenerateCommand({ strength })), Error, "strength");
    }
    for (const timeout of [-1, null, "", false, Infinity, 1e308]) {
      await assertRejects(() => run(() => challengeVerifyCommand({ name: "unopened", timeout })), Error, "timeout");
    }
    for (const pollDelayMs of [0, -1, null, "", Infinity]) {
      await assertRejects(
        () => run(() => challengeVerifyCommand({ name: "unopened", pollDelayMs })),
        Error,
        "pollDelayMs",
      );
    }
  },
});
