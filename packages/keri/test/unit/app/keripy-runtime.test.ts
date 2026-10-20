import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  keripyProtocolVersionArgs,
  selectedKeripyProfile,
  verifyKeripy,
} from "../../integration/app/keripy-runtime.ts";

Deno.test("KERIpy release profiles select actual CLI version arguments", () => {
  assertEquals(selectedKeripyProfile({}), undefined);
  assertEquals(keripyProtocolVersionArgs({}, "1.0"), ["--version", "1.0"]);
  assertEquals(keripyProtocolVersionArgs({ KERIPY_INTEROP_PROFILE: "main" }, "2.0"), ["--version", "2.0"]);
  for (const profile of ["1.2", "1.3"]) {
    const env = { KERIPY_INTEROP_PROFILE: profile };
    assertEquals(keripyProtocolVersionArgs(env, "1.0"), []);
    assertThrows(() => keripyProtocolVersionArgs(env, "2.0"), Error, "only support protocol v1");
  }
  assertThrows(() => selectedKeripyProfile({ KERIPY_INTEROP_PROFILE: "unknown" }), Error, "Unknown KERIpy profile");
});

Deno.test("KERIpy release profiles refuse missing environments and mismatched pins before execution", async () => {
  const pinned = { python: "must-not-run", commit: "0".repeat(40) };
  await assertRejects(
    () => verifyKeripy("must-not-create", { KERIPY_INTEROP_PROFILE: "main" }, pinned),
    Error,
    "requires KERIPY_INTEROP_ROOT",
  );
  await assertRejects(
    () =>
      verifyKeripy("must-not-create", {
        KERIPY_INTEROP_PROFILE: "1.2",
        KERIPY_INTEROP_ROOT: "must-not-open",
        KERIPY_INTEROP_EXPECTED_COMMIT: "0".repeat(40),
      }, pinned),
    Error,
    "disagree",
  );
});
