import { run } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import type { ChallengeResponsePayload } from "../../../src/app/challenging.ts";
import { challengeGenerateCommand } from "../../../src/app/cli/challenge.ts";
import { testCLICommand } from "../../utils.ts";

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
