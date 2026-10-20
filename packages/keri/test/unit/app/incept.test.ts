import { type Operation, run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertStringIncludes } from "jsr:@std/assert";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { Habery } from "../../../src/app/habbing.ts";
import { assertOperationThrows, CLITestHarness } from "../../../test/utils.ts";

async function captureCommandOutput(
  operation: Operation<void>,
): Promise<string> {
  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() => operation);
    return harness.getOutput().join("\n");
  } finally {
    harness.restoreOutput();
  }
}

Deno.test("CLI - incept command reuses initialized stores for happy-path coverage", async () => {
  const name = `incept-unit-${crypto.randomUUID()}`;
  await run(() => initCommand({ name, temp: true, nopasscode: true }));
  const headName = `incept-head-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name: headName,
      headDirPath,
      nopasscode: true,
    })
  );

  const singleSigOutput = await captureCommandOutput(
    inceptCommand({
      name,
      temp: true,
      alias: "alice",
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    }),
  );
  assertStringIncludes(singleSigOutput, "Prefix");
  assertStringIncludes(singleSigOutput, "Public key 1");

  const endpointOutput = await captureCommandOutput(
    inceptCommand({
      name,
      temp: true,
      alias: "relay",
      endpoint: true,
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    }),
  );
  assertStringIncludes(endpointOutput, "Prefix");

  const weightedOutput = await captureCommandOutput(
    inceptCommand({
      name,
      temp: true,
      alias: "weighted",
      transferable: true,
      icount: 2,
      isith: "[\"1/2\",\"1/2\"]",
      ncount: 2,
      nsith: "[{\"1\":[\"1/2\",\"1/2\"]}]",
      toad: 0,
    }),
  );
  assertStringIncludes(weightedOutput, "Prefix");
  assertStringIncludes(weightedOutput, "Public key 2");

  const headDirOutput = await captureCommandOutput(
    inceptCommand({
      name: headName,
      headDirPath,
      alias: "alice",
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    }),
  );
  assertStringIncludes(headDirOutput, "Prefix");
});

Deno.test("CLI - incept command requires alias", async () => {
  await assertOperationThrows(
    inceptCommand({ name: "test", temp: true }),
    "Alias is required and cannot be empty",
  );
});

Deno.test("CLI - initialization and inception report success only after database cleanup", async () => {
  const name = `incept-close-${crypto.randomUUID()}`;
  const headDirPath = await Deno.makeTempDir();
  await run(() => initCommand({ name, headDirPath, nopasscode: true }));
  const close = Habery.prototype.close;
  const makeHab = Habery.prototype.makeHab;
  const failure = new Error("owned Habery close failed");
  const harness = new CLITestHarness();
  Habery.prototype.close = function*(...args) {
    yield* close.apply(this, args);
    throw failure;
  };
  harness.captureOutput();
  try {
    assertStrictEquals(
      await assertRejects(() =>
        run(() =>
          initCommand({
            name: `${name}-new`,
            headDirPath,
            nopasscode: true,
          })
        )
      ),
      failure,
    );
    assertEquals(harness.getOutput(), []);
    assertStrictEquals(
      await assertRejects(() =>
        run(() =>
          inceptCommand({
            name,
            headDirPath,
            alias: "alice",
            transferable: true,
          })
        )
      ),
      failure,
    );
    assertEquals(harness.getOutput(), []);
    const operationFailure = new Error("inception failed");
    Habery.prototype.makeHab = () => {
      throw operationFailure;
    };
    const combined = await assertRejects(
      () => run(() => inceptCommand({ name, headDirPath, alias: "alice" })),
      AggregateError,
    );
    assertEquals(combined.errors, [operationFailure, failure]);
    assertStrictEquals(combined.cause, operationFailure);
  } finally {
    harness.restoreOutput();
    Habery.prototype.close = close;
    Habery.prototype.makeHab = makeHab;
    await Deno.remove(headDirPath, { recursive: true });
  }
});
