import { run } from "effection";
import { assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert";
import { Siger } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { signCommand } from "../../../src/app/cli/sign.ts";
import { verifyCommand } from "../../../src/app/cli/verify.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { assertOperationThrows, CLITestHarness, createMockArgs } from "../../../test/utils.ts";

function captureOperationOutput(
  operationFactory: () => ReturnType<typeof signCommand>,
): Promise<string[]> {
  const harness = new CLITestHarness();
  harness.captureOutput();
  return run(operationFactory)
    .then(() => harness.getOutput())
    .finally(() => harness.restoreOutput());
}

function extractRawSignature(lines: string[]): string {
  const first = lines.find((line) => /^\d+\.\s+/.test(line));
  if (!first) {
    throw new Error(`Unable to parse signature from output:\n${lines.join("\n")}`);
  }
  return first.replace(/^\d+\.\s+/, "");
}

Deno.test("CLI sign signs inline text and @file text identically", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-sign-inline-" });
  const name = `sign-inline-${crypto.randomUUID()}`;
  const alias = "alice";
  const message = "hello from sign";
  const filePath = `${headDirPath}/message.txt`;
  Deno.writeTextFileSync(filePath, message);

  await run(function*() {
    const hby = yield* createHabery({ name, headDirPath });
    try {
      hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
    } finally {
      yield* hby.close();
    }
  });

  const inline = await captureOperationOutput(() =>
    signCommand(createMockArgs({
      name,
      headDirPath,
      alias,
      text: message,
    }))
  );
  const fromFile = await captureOperationOutput(() =>
    signCommand(createMockArgs({
      name,
      headDirPath,
      alias,
      text: `@${filePath}`,
    }))
  );

  assertEquals(inline.length, 1);
  assertEquals(fromFile.length, 1);
  assertEquals(inline[0], fromFile[0]);
});

Deno.test("CLI verify validates raw signatures and rejects out-of-range indices", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-verify-" });
  const name = `verify-${crypto.randomUUID()}`;
  const alias = "alice";
  const message = "verify me";
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({ name, headDirPath });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
    } finally {
      yield* hby.close();
    }
  });

  const signed = await captureOperationOutput(() =>
    signCommand(createMockArgs({
      name,
      headDirPath,
      alias,
      text: message,
    }))
  );
  const signature = extractRawSignature(signed);
  const verified = await captureOperationOutput(() =>
    verifyCommand(createMockArgs({
      name,
      headDirPath,
      prefix: pre,
      text: message,
      signature: [signature],
    }))
  );
  assertEquals(verified, ["Signature 1 is valid."]);

  const highIndex = new Siger({
    code: "A",
    raw: new Uint8Array(64),
    index: 1,
  }).qb64;
  await assertOperationThrows(
    verifyCommand(createMockArgs({
      name,
      headDirPath,
      prefix: pre,
      text: message,
      signature: [highIndex],
    })),
    "Index = 1 to large for keys.",
  );
});

Deno.test("CLI verify fails against stale key state after source rotation", async () => {
  const sourceHeadDir = await Deno.makeTempDir({ prefix: "tufa-stale-source-" });
  const observerHeadDir = await Deno.makeTempDir({ prefix: "tufa-stale-observer-" });
  const sourceName = `stale-source-${crypto.randomUUID()}`;
  const observerName = `stale-observer-${crypto.randomUUID()}`;
  const alias = "alice";
  const message = "stale verify";
  let pre = "";
  let staleFailureSignature = "";

  await run(function*() {
    const source = yield* createHabery({ name: sourceName, headDirPath: sourceHeadDir });
    const observer = yield* createHabery({
      name: observerName,
      headDirPath: observerHeadDir,
      skipSignator: true,
    });
    const runtime = yield* createAgentRuntime(observer, { mode: "local" });
    try {
      const hab = source.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;

      for (const evt of source.db.clonePreIter(hab.pre, 0)) {
        ingestKeriBytes(runtime, evt);
      }
      yield* processRuntimeTurn(runtime, { pollMailbox: false });
      assertEquals(observer.db.getKever(hab.pre)?.sn, 0);

      const oldKey = hab.kever?.verfers[0]?.qb64 ?? "";
      hab.rotate({ ncount: 1, nsith: "1" });
      const newKey = hab.kever?.verfers[0]?.qb64 ?? "";
      assertNotEquals(newKey, oldKey);

      staleFailureSignature = (hab.sign(new TextEncoder().encode(message), true)[0]?.qb64) ?? "";
    } finally {
      yield* runtime.close();
      yield* observer.close();
      yield* source.close();
    }
  });

  await assertOperationThrows(
    verifyCommand(createMockArgs({
      name: observerName,
      headDirPath: observerHeadDir,
      prefix: pre,
      text: message,
      signature: [staleFailureSignature],
    })),
    "Signature 1 is invalid.",
  );
});

Deno.test("CLI verify still expects raw signature material, not numbered sign output", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-verify-raw-" });
  const name = `verify-raw-${crypto.randomUUID()}`;
  const alias = "alice";
  const message = "raw signature only";
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({ name, headDirPath });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
    } finally {
      yield* hby.close();
    }
  });

  const signed = await captureOperationOutput(() =>
    signCommand(createMockArgs({
      name,
      headDirPath,
      alias,
      text: message,
    }))
  );
  const numberedLine = signed[0] ?? "";

  try {
    await run(() =>
      verifyCommand(createMockArgs({
        name,
        headDirPath,
        prefix: pre,
        text: message,
        signature: [numberedLine],
      }))
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    assertEquals(
      messageText.includes("Unsupported code") || messageText.includes("Unknown indexer code"),
      true,
      messageText,
    );
    return;
  }

  throw new Error("Expected numbered sign output to be rejected by verify.");
});
