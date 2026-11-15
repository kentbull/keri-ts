/**
 * Closing an LMDB store must release its native file descriptors and mappings.
 *
 * Data-v1 lmdb-js builds without kriszyp/lmdb-js#388 never called
 * mdb_env_close(), so each close leaked lock.mdb, two data.mdb descriptors and
 * both maps; @keri-ts/lmdb-js carries that fix. The probe counts only descriptors and
 * mappings under this test's own directory, so other test files sharing the
 * process cannot disturb it. It reads /proc/self, so it runs on Linux only.
 */
import { run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { LMDBer } from "../../../../src/db/core/lmdber.ts";
import { FakeRuntimeHttpClient, ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

const linuxOnly = Deno.build.os !== "linux";
const CYCLES = 10;

/** Native LMDB resources this process holds under one directory. */
interface NativeHold {
  fds: number;
  maps: number;
}

/** Count open descriptors and memory mappings whose target lies under `dir`. */
function nativeHold(dir: string): NativeHold {
  const root = Deno.realPathSync(dir);
  let fds = 0;
  for (const entry of Deno.readDirSync("/proc/self/fd")) {
    try {
      if (Deno.readLinkSync(`/proc/self/fd/${entry.name}`).startsWith(root)) fds++;
    } catch {
      // The descriptor used to read the directory itself is gone by now.
    }
  }
  const maps = Deno.readTextFileSync("/proc/self/maps").split("\n").filter((line) => line.includes(root)).length;
  return { fds, maps };
}

Deno.test({
  name: "db/core lmdber close release - repeated open/close returns every descriptor and mapping",
  ignore: linuxOnly,
  async fn() {
    const headDirPath = await Deno.makeTempDir({ prefix: "lmdber-close-release-" });
    try {
      await run(function*() {
        for (let cycle = 0; cycle < CYCLES; cycle++) {
          const lmdber = new LMDBer({ headDirPath, name: "release" });
          assertEquals(yield* lmdber.reopen({ headDirPath }), true);
          const table = lmdber.openDB("cycles.", false);
          lmdber.setVal(table, Uint8Array.of(1), Uint8Array.of(cycle));
          const open = nativeHold(headDirPath);
          assert(open.fds > 0 && open.maps > 0, "the probe must see the open environment");
          yield* lmdber.close();
          assertEquals(nativeHold(headDirPath), { fds: 0, maps: 0 }, `cycle ${cycle} left native resources open`);
        }
      });
    } finally {
      await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: "db/core lmdber close release - a Habery with its agent runtime stores closes without residue",
  ignore: linuxOnly,
  async fn() {
    const headDirPath = await Deno.makeTempDir({ prefix: "habery-close-release-" });
    try {
      await run(function*() {
        for (let cycle = 0; cycle < CYCLES; cycle++) {
          const hby = yield* createHabery({ name: "release", headDirPath, skipConfig: true });
          try {
            const runtime = yield* createAgentRuntime(hby, new FakeRuntimeHttpClient(), new ManualRuntimeClock(), {
              enableMailboxStore: true,
            });
            assert(nativeHold(headDirPath).fds > 0, "the probe must see the open stores");
            yield* runtime.close();
          } finally {
            yield* hby.close();
          }
          assertEquals(nativeHold(headDirPath), { fds: 0, maps: 0 }, `cycle ${cycle} left native resources open`);
        }
      });
    } finally {
      await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
    }
  },
});
