import { run } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { concatBytes, Counter } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { createProtocolProcessor } from "../../../src/app/protocol-processing.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import {
  createInteropContext,
  extractPrefix,
  requireSuccess,
  runCmdWithTimeout,
  startKeriPyWitnessHarness,
} from "./interop-test-helpers.ts";
import { keripyProtocolVersionArgs, selectedKeripyProfile } from "./keripy-runtime.ts";

Deno.test("selected KERIpy CLI creates and exports a signed v1 inception accepted by TypeScript", async () => {
  const ctx = await createInteropContext();
  try {
    const name = `profile-${crypto.randomUUID()}`;
    const config = `${ctx.home}/inception.json`;
    await Deno.writeTextFile(
      config,
      JSON.stringify({
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        wits: [],
      }),
    );
    const versions = keripyProtocolVersionArgs(ctx.env, "1.0");
    await requireSuccess(
      "reference init",
      runCmdWithTimeout(ctx.kliCommand, ["init", ...versions, "--name", name, "--nopasscode"], ctx.env, 20_000),
    );
    const inception = await requireSuccess(
      "reference inception",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "incept",
          ...versions,
          "--name",
          name,
          "--alias",
          "alice",
          "--file",
          config,
        ],
        ctx.env,
        20_000,
      ),
    );
    const pre = extractPrefix(inception.stdout);
    const exported = await requireSuccess(
      "reference export",
      runCmdWithTimeout(ctx.kliCommand, ["export", "--name", name, "--alias", "alice"], ctx.env, 20_000),
    );
    await run(function*() {
      const hby = yield* createHabery({ name: `profile-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      try {
        const protocol = createProtocolProcessor(hby);
        const reactor = new Reactor(protocol);
        // CLI export omits a selector; its attachment genus is independent of the signed v1 body.
        const major = selectedKeripyProfile(ctx.env)?.exportGenus ?? 2;
        assert(major === 1 || major === 2);
        yield* reactor.processBytes(concatBytes(
          Counter.makeGVC({ major, minor: 0 }),
          new TextEncoder().encode(exported.stdout),
        ));
        const accepted = hby.db.kevers.get(pre);
        assertExists(accepted);
        assertEquals(accepted.sn, 0);
        assertEquals(accepted.pre, pre);
      } finally {
        yield* hby.close(true);
      }
    });
    const invalid = await runCmdWithTimeout(ctx.kliCommand, ["init", "--not-a-real-option"], ctx.env, 10_000);
    assertEquals(invalid.code, 2, "The verified console launcher must preserve argparse failure.");
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("selected KERIpy profile serves its real v1 witness OOBI", async () => {
  const ctx = await createInteropContext();
  try {
    const witnesses = await startKeriPyWitnessHarness(ctx, { aliases: ["wan"] });
    try {
      const response = await fetch(witnesses.node("wan").witnessOobi);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assertEquals(response.status, 200);
      assertEquals(bytes.length > 0, true);
    } finally {
      await witnesses.close();
    }
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});
