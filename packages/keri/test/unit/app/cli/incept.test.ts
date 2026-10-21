import { type Operation, run } from "effection";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { createHabery, Habery } from "../../../../src/app/identity/habbing.ts";
import { inceptCommand } from "../../../../src/cli/identity/incept.ts";
import { initCommand } from "../../../../src/cli/identity/init.ts";
import { rotateCommand } from "../../../../src/cli/identity/rotate.ts";
import { assertOperationThrows, CLITestHarness } from "../../../utils.ts";

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
    // The earlier close failure did not roll back Alice; reach makeHab with an unused alias.
    const combined = await assertRejects(
      () => run(() => inceptCommand({ name, headDirPath, alias: "bob" })),
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

Deno.test("lifecycle commands apply explicit overrides before defaults and persist file choices", async () => {
  const headDirPath = Deno.makeTempDirSync();
  const name = `lifecycle-${crypto.randomUUID()}`;
  const file = `${headDirPath}/options.json`;
  const store = { name, headDirPath };
  try {
    await captureCommandOutput(initCommand({ ...store, nopasscode: true }));
    Deno.writeTextFileSync(
      file,
      JSON.stringify({
        transferable: true,
        icount: 2,
        isith: "1",
        ncount: 2,
        nsith: "2",
        estOnly: true,
        wits: [],
        data: [{ purpose: "file" }],
      }),
    );
    await captureCommandOutput(inceptCommand({ ...store, alias: "alice", file, estOnly: false }));
    await run(function*() {
      const hby = yield* createHabery({ ...store, skipConfig: true });
      try {
        const hab = hby.habByName("alice");
        assertExists(hab?.kever);
        assertEquals(hab.kever.verfers.length, 2);
        assertEquals(hab.kever.ndigers.length, 2);
        assertEquals(hab.kever.estOnly, false);
        assertEquals(hby.db.getEvtSerder(hab.pre, hab.kever.said)?.ked?.a, [{ purpose: "file" }]);
      } finally {
        yield* hby.close();
      }
    });
    Deno.writeTextFileSync(file, JSON.stringify({ ncount: 3, nsith: "2", data: [{ purpose: "rotation" }] }));
    await captureCommandOutput(rotateCommand({ ...store, alias: "alice", file, data: [] }));
    await run(function*() {
      const hby = yield* createHabery({ ...store, skipConfig: true });
      try {
        const hab = hby.habByName("alice");
        assertExists(hab?.kever);
        assertEquals(hab.kever.ndigers.length, 3);
        assertEquals(hab.kever.ntholder?.sith, "2");
        assertEquals(hby.db.getEvtSerder(hab.pre, hab.kever.said)?.ked?.a, []);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    Deno.removeSync(headDirPath, { recursive: true });
  }
});

Deno.test("lifecycle commands reject malformed options before opening a missing store", async () => {
  const headDirPath = Deno.makeTempDirSync();
  try {
    for (
      const [command, values] of [
        [inceptCommand, [{ transferable: "false" }, { icount: 0 }, { wits: ["aid", 1] }, { isith: "" }]],
        [rotateCommand, [{ nextCount: "1e2" }, { witnesses: [1] }, { authenticate: "false" }]],
      ] as const
    ) {
      for (const invalid of values) {
        const error = await assertRejects(() =>
          run(() =>
            command({
              name: "missing",
              alias: "alice",
              headDirPath,
              ...invalid,
            })
          )
        );
        assertInstanceOf(error, Error);
        const key = Object.keys(invalid)[0];
        assertStringIncludes(error.message.toLowerCase(), key === "isith" ? "threshold" : key.toLowerCase());
        assertEquals([...Deno.readDirSync(headDirPath)], []);
      }
    }
  } finally {
    Deno.removeSync(headDirPath, { recursive: true });
  }
});
