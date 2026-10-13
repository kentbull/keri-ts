/** Six KERIpy witnesses, threshold six, inception and two rotations; explicit manual selection only. */
import { run } from "npm:effection@^3.6.0";
import { createHabery } from "../../src/app/habbing.ts";
import {
  createInteropContext,
  extractPrefix,
  requireSuccess,
  runTufaWithTimeout,
  startKeriPyWitnessHarness,
} from "../integration/app/interop-test-helpers.ts";
import {
  assertFullyWitnessed,
  assertKeriPyWitnessStores,
  initTufaStore,
  resolveWitnessesForTufa,
} from "../integration/app/interop-witness-helpers.ts";

Deno.test({
  name: "Interop witness: manual 6-witness KERIpy soak reaches full receipt convergence",
  async fn() {
    const ctx = await createInteropContext();
    const headDirPath = await Deno.makeTempDir({ prefix: "tufa-keripy-soak-" });
    const controllerName = `tufa-keripy-soak-${crypto.randomUUID().slice(0, 8)}`;
    const controllerAlias = "controller";
    const harness = await startKeriPyWitnessHarness(ctx);

    try {
      await initTufaStore(controllerName, headDirPath, ctx.env, ctx.repoRoot);
      await resolveWitnessesForTufa(
        controllerName,
        headDirPath,
        ctx.env,
        ctx.repoRoot,
        harness.nodes,
      );

      const incepted = await requireSuccess(
        "tufa incept six keripy witnesses",
        runTufaWithTimeout(
          [
            "incept",
            "--name",
            controllerName,
            "--head-dir",
            headDirPath,
            "--alias",
            controllerAlias,
            "--transferable",
            "--icount",
            "1",
            "--isith",
            "1",
            "--ncount",
            "1",
            "--nsith",
            "1",
            "--toad",
            "6",
            "--receipt-endpoint",
            "--wits",
            harness.node("wan").pre,
            "--wits",
            harness.node("wil").pre,
            "--wits",
            harness.node("wes").pre,
            "--wits",
            harness.node("wit").pre,
            "--wits",
            harness.node("wub").pre,
            "--wits",
            harness.node("wyz").pre,
          ],
          ctx.env,
          ctx.repoRoot,
          60_000,
        ),
      );
      const controllerPre = extractPrefix(incepted.stdout);

      for (let index = 0; index < 2; index++) {
        await requireSuccess(
          `tufa six-witness rotate ${index + 1}`,
          runTufaWithTimeout(
            [
              "rotate",
              "--name",
              controllerName,
              "--head-dir",
              headDirPath,
              "--alias",
              controllerAlias,
              "--receipt-endpoint",
              "--toad",
              "6",
            ],
            ctx.env,
            ctx.repoRoot,
            60_000,
          ),
        );
      }

      await run(function*() {
        const controllerHby = yield* createHabery({
          name: controllerName,
          headDirPath,
          skipConfig: true,
          skipSignator: true,
        });
        try {
          assertFullyWitnessed(controllerHby, controllerPre, 0, 6);
          assertFullyWitnessed(controllerHby, controllerPre, 1, 6);
          assertFullyWitnessed(controllerHby, controllerPre, 2, 6);
        } finally {
          yield* controllerHby.close();
        }
      });

      await assertKeriPyWitnessStores(
        ctx,
        harness,
        ["wan", "wil", "wes", "wit", "wub", "wyz"],
        controllerPre,
        2,
        6,
      );
    } finally {
      await harness.close();
    }
  },
});
