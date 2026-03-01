import { assertEquals, assertThrows } from "jsr:@std/assert";
import { VersionError } from "../../src/core/errors.ts";
import {
  CtrDexByVersion,
  LEGACY_COMPAT_COUNTER_CODES_BY_VERSION,
  resolveCounterCodeNameTable,
  resolveCtrDex,
  resolveVersionedRegistryValue,
  type VersionedRegistry,
} from "../../src/tables/counter-version-registry.ts";

Deno.test(
  "versioned registry resolver binds to latest compatible minor within major",
  () => {
    const registry: VersionedRegistry<string> = {
      1: { 0: "v1.0", 2: "v1.2" },
      2: { 0: "v2.0" },
    };

    const resolved = resolveVersionedRegistryValue(
      registry,
      { major: 1, minor: 0 },
      "test registry",
    );
    assertEquals(resolved.value, "v1.2");
    assertEquals(resolved.resolvedMinor, 2);
    assertEquals(resolved.latestMinor, 2);
  },
);

Deno.test(
  "versioned registry resolver rejects unsupported requested minor",
  () => {
    const registry: VersionedRegistry<string> = {
      1: { 0: "v1.0", 2: "v1.2" },
      2: { 0: "v2.0" },
    };

    assertThrows(
      () =>
        resolveVersionedRegistryValue(
          registry,
          { major: 1, minor: 3 },
          "test registry",
        ),
      VersionError,
    );
  },
);

Deno.test(
  "CtrDexByVersion excludes legacy v1 sad-path aliases but keeps explicit allowlist",
  () => {
    const ctr = resolveCtrDex({ major: 1, minor: 0 });
    assertEquals("SadPathSig" in ctr, false);
    assertEquals("SadPathSigGroup" in ctr, false);

    const aliases = LEGACY_COMPAT_COUNTER_CODES_BY_VERSION[1][0];
    assertEquals(aliases.has("-J"), true);
    assertEquals(aliases.has("-K"), true);
  },
);

Deno.test(
  "counter code-name table resolution enforces supported minor bounds",
  () => {
    const names = resolveCounterCodeNameTable({ major: 2, minor: 0 });
    assertEquals(names["-A"], "GenericGroup");

    assertThrows(
      () => resolveCounterCodeNameTable({ major: 2, minor: 1 }),
      VersionError,
    );
  },
);

Deno.test(
  "CtrDexByVersion uses explicit minor-keyed branches for each supported major",
  () => {
    assertEquals(Object.keys(CtrDexByVersion[1]).map(Number), [0]);
    assertEquals(Object.keys(CtrDexByVersion[2]).map(Number), [0]);
  },
);
