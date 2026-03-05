import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  onKey,
  splitKey,
  splitKeyON,
  splitOnKey,
} from "../../../../src/db/core/keys.ts";
import { t } from '../../../../../cesr/mod.ts'

Deno.test("db/core keys - splitKey uses rightmost separator", () => {
  const [top, suffix] = splitKey("alpha.beta.gamma", ".");
  assertEquals(t(top), "alpha.beta");
  assertEquals(t(suffix), "gamma");
});

Deno.test("db/core keys - splitOnKey alias matches splitKeyON", () => {
  const key = onKey("aid.prefix.with.dot", 15);
  const [topA, onA] = splitKeyON(key);
  const [topB, onB] = splitOnKey(key);

  assertEquals(onA, 15);
  assertEquals(onB, 15);
  assertEquals(t(topA), "aid.prefix.with.dot");
  assertEquals(t(topA), t(topB));
});

Deno.test("db/core keys - splitKey rejects unsplittable keys", () => {
  assertThrows(
    () => splitKey("nosplitvalue"),
    Error,
    "rightmost separator",
  );
});
