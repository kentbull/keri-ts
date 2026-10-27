import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import reference from "../../../../../scripts/ci/keripy-reference.json" with { type: "json" };
import { keripySuiteEnvironment } from "../../../../../scripts/ci/run-keri-test-group.ts";
import {
  keripyProtocolVersionArgs,
  selectedKeripyProfile,
  verifyKeripy,
} from "../../integration/app/keripy-runtime.ts";

Deno.test("KERIpy release profiles select actual CLI version arguments", () => {
  assertEquals(selectedKeripyProfile({}), undefined);
  assertEquals(keripyProtocolVersionArgs({}, "1.0"), ["--version", "1.0"]);
  assertEquals(keripyProtocolVersionArgs({ KERIPY_INTEROP_PROFILE: "main" }, "2.0"), ["--version", "2.0"]);
  assertEquals(keripyProtocolVersionArgs({ KERIPY_INTEROP_PROFILE: "candidate" }, "2.0"), ["--version", "2.0"]);
  for (const profile of ["1.2", "1.3"]) {
    const env = { KERIPY_INTEROP_PROFILE: profile };
    assertEquals(keripyProtocolVersionArgs(env, "1.0"), []);
    assertThrows(() => keripyProtocolVersionArgs(env, "2.0"), Error, "only support protocol v1");
  }
  assertThrows(() => selectedKeripyProfile({ KERIPY_INTEROP_PROFILE: "unknown" }), Error, "Unknown KERIpy profile");
});

Deno.test("KERIpy release profiles refuse missing environments and mismatched pins before execution", async () => {
  const pinned = { python: "must-not-run", commit: "0".repeat(40) };
  for (const profile of ["main", "candidate"]) {
    await assertRejects(
      () => verifyKeripy("must-not-create", { KERIPY_INTEROP_PROFILE: profile }, pinned),
      Error,
      "requires KERIPY_INTEROP_ROOT",
    );
  }
  for (const profile of ["1.2", "candidate"]) {
    await assertRejects(
      () =>
        verifyKeripy("must-not-create", {
          KERIPY_INTEROP_PROFILE: profile,
          KERIPY_INTEROP_ROOT: "must-not-open",
          KERIPY_INTEROP_EXPECTED_COMMIT: "0".repeat(40),
        }, pinned),
      Error,
      "disagree",
    );
  }
});

Deno.test("Native registry and IPEX require their candidate while ESSR keeps its main peer", () => {
  const main = { KERIPY_MAIN_ROOT: "/main", KERIPY_MAIN_PYTHON: "/main/python" };
  for (const owner of ["interop-native-registry", "interop-ipex-disclosure"]) {
    assertThrows(() => keripySuiteEnvironment(owner, main), Error, "requires a candidate");
  }
  assertThrows(
    () => keripySuiteEnvironment("interop-native-registry", { ...main, KERIPY_CANDIDATE_ROOT: "/candidate" }),
    Error,
    "requires a candidate",
  );
  const selected = keripySuiteEnvironment("interop-native-registry", {
    ...main,
    KERIPY_INTEROP_ROOT: "/mailbox",
    KERIPY_INTEROP_EXPECTED_COMMIT: reference.commit,
    KERIPY_CANDIDATE_ROOT: "/candidate",
    KERIPY_CANDIDATE_PYTHON: "/candidate/python",
  });
  assertEquals(selected.KERIPY_INTEROP_PROFILE, "candidate");
  assertEquals(selected.KERIPY_INTEROP_ROOT, "/candidate");
  assertEquals(selected.KERIPY_INTEROP_PYTHON, "/candidate/python");
  assertEquals(selected.KERIPY_INTEROP_EXPECTED_COMMIT, reference.profiles.candidate.commit);
  // Explicit selection also works for a direct owner run; main setup cannot replace it.
  for (const owner of ["interop-native-registry", "interop-ipex-disclosure", "interop-essr-storage"]) {
    assertEquals(keripySuiteEnvironment(owner, selected), selected);
  }
  for (const owner of ["interop-essr-storage"]) {
    const env = keripySuiteEnvironment(owner, main);
    assertEquals(env.KERIPY_INTEROP_PROFILE, "main");
    assertEquals(env.KERIPY_INTEROP_ROOT, main.KERIPY_MAIN_ROOT);
    assertEquals(env.KERIPY_INTEROP_EXPECTED_COMMIT, reference.profiles.main.commit);
  }
  const fork = {
    KERIPY_INTEROP_ROOT: "/mailbox",
    KERIPY_INTEROP_PYTHON: "/mailbox/python",
    KERIPY_INTEROP_EXPECTED_COMMIT: reference.commit,
    KERIPY_CANDIDATE_ROOT: "/candidate",
    KERIPY_CANDIDATE_PYTHON: "/candidate/python",
  };
  assertEquals(keripySuiteEnvironment("interop-kram", fork), fork, "mailbox providers retain their separate fork");
});
