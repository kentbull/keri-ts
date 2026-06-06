// @file-test-lane app-stateful-b

import { run } from "effection";
import { assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { Diger } from "../../../../cesr/mod.ts";
import { exportCommand } from "../../../src/app/cli/export.ts";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { CLITestHarness } from "../../../test/utils.ts";

Deno.test("CLI - export command works with custom head directory", async () => {
  const name = `export-head-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  await run(() =>
    inceptCommand({
      name,
      headDirPath,
      alias: "alice",
      transferable: true,
      icount: 1,
      ncount: 1,
      toad: 0,
    })
  );

  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() =>
      exportCommand({
        name,
        headDirPath,
        alias: "alice",
      })
    );
    const output = harness.getOutput().join("\n");
    assertStringIncludes(output, "KERI10JSON");
    assertStringIncludes(output, "-V");
    assertStringIncludes(output, "1AAG");
  } finally {
    harness.restoreOutput();
  }
});

Deno.test("CLI - export command refuses unapproved delegated AIDs and exports approved delegation chains", async () => {
  const name = `export-delegated-${crypto.randomUUID()}`;
  const alias = "delegate";
  const headDirPath = `/tmp/tufa-export-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({ name, headDirPath });
    try {
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        ncount: 1,
        toad: 0,
      });
      const delegate = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        ncount: 1,
        toad: 0,
        delpre: delegator.pre,
      });
    } finally {
      yield* hby.close();
    }
  });

  await assertRejects(
    () => run(() => exportCommand({ name, headDirPath, alias })),
    Error,
    "requires a locally known approving delegation chain",
  );

  await run(function*() {
    const hby = yield* createHabery({ name, headDirPath });
    try {
      const delegator = hby.habByName("delegator");
      const delegate = hby.habByName(alias);
      delegator?.interact({
        data: [{
          i: delegate?.pre,
          s: "0",
          d: delegate?.kever?.said,
        }],
      });
      const approving = delegator?.kever?.said
        ? hby.db.getEvtSerder(delegator.pre, delegator.kever.said)
        : null;
      if (!delegate?.kever?.said || !approving?.sner || !approving.said) {
        throw new Error("Expected approved delegated export fixtures.");
      }
      hby.db.aess.pin(dgKey(delegate.pre, delegate.kever.said), [
        approving.sner,
        new Diger({ qb64: approving.said }),
      ]);
    } finally {
      yield* hby.close();
    }
  });

  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() => exportCommand({ name, headDirPath, alias }));
    const output = harness.getOutput().join("\n");
    assertStringIncludes(output, "KERI10JSON");
  } finally {
    harness.restoreOutput();
  }
});
