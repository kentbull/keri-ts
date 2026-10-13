import { assertEquals } from "jsr:@std/assert";
import { assertExportParity } from "./interop-export-helpers.ts";
import {
  createScenarioContext,
  extractIdentifierLines,
  extractLastNonEmptyLine,
  extractPrefix,
  runCmd,
  runTufa,
  type ScenarioContext,
} from "./interop-keystore-helpers.ts";

/** Compare independently initialized and incepted identifiers plus exported KEL bytes. */
async function runInitInceptExportParity(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `keystore-parity-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const kliName = `kli-${crypto.randomUUID().slice(0, 8)}`;
  const tufaName = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(ctx.kliCommand, [
    "init",
    "--version",
    "1.0",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--salt",
    salt,
  ], ctx.env);
  if (kliInit.code !== 0) {
    throw new Error(`kli init failed: ${kliInit.stderr}\n${kliInit.stdout}`);
  }

  const kliIncept = await runCmd(ctx.kliCommand, [
    "incept",
    "--version",
    "1.0",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--transferable",
    "--isith",
    "1",
    "--icount",
    "1",
    "--nsith",
    "1",
    "--ncount",
    "1",
    "--toad",
    "0",
  ], ctx.env);
  if (kliIncept.code !== 0) {
    throw new Error(
      `kli incept failed: ${kliIncept.stderr}\n${kliIncept.stdout}`,
    );
  }

  const tufaInit = await runTufa(
    [
      "init",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaInit.code !== 0) {
    throw new Error(`tufa init failed: ${tufaInit.stderr}\n${tufaInit.stdout}`);
  }

  const tufaIncept = await runTufa(
    [
      "incept",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaIncept.code !== 0) {
    throw new Error(
      `tufa incept failed: ${tufaIncept.stderr}\n${tufaIncept.stdout}`,
    );
  }

  assertEquals(
    extractPrefix(tufaIncept.stdout),
    extractPrefix(kliIncept.stdout),
  );

  const kliExport = await runCmd(ctx.kliCommand, [
    "export",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
  ], ctx.env);
  if (kliExport.code !== 0) {
    throw new Error(
      `kli export failed: ${kliExport.stderr}\n${kliExport.stdout}`,
    );
  }

  const tufaExport = await runTufa(
    [
      "export",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaExport.code !== 0) {
    throw new Error(
      `tufa export failed: ${tufaExport.stderr}\n${tufaExport.stdout}`,
    );
  }

  await assertExportParity(
    ctx,
    { name: kliName, base, passcode, alias },
    tufaExport.stdout,
    kliExport.stdout,
  );
}

/** Verify empty and populated identifier views through both CLIs. */
async function runListAidVisibilityParity(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `keystore-visibility-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const kliName = `kli-${crypto.randomUUID().slice(0, 8)}`;
  const tufaName = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(ctx.kliCommand, [
    "init",
    "--version",
    "1.0",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--salt",
    salt,
  ], ctx.env);
  if (kliInit.code !== 0) {
    throw new Error(`kli init failed: ${kliInit.stderr}\n${kliInit.stdout}`);
  }

  const tufaInit = await runTufa(
    [
      "init",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaInit.code !== 0) {
    throw new Error(`tufa init failed: ${tufaInit.stderr}\n${tufaInit.stdout}`);
  }

  const kliListBefore = await runCmd(ctx.kliCommand, [
    "list",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
  ], ctx.env);
  if (kliListBefore.code !== 0) {
    throw new Error(
      `kli list (before) failed: ${kliListBefore.stderr}\n${kliListBefore.stdout}`,
    );
  }

  const tufaListBefore = await runTufa(
    [
      "list",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaListBefore.code !== 0) {
    throw new Error(
      `tufa list (before) failed: ${tufaListBefore.stderr}\n${tufaListBefore.stdout}`,
    );
  }

  assertEquals(extractIdentifierLines(kliListBefore.stdout), []);
  assertEquals(extractIdentifierLines(tufaListBefore.stdout), []);

  const kliIncept = await runCmd(ctx.kliCommand, [
    "incept",
    "--version",
    "1.0",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--transferable",
    "--isith",
    "1",
    "--icount",
    "1",
    "--nsith",
    "1",
    "--ncount",
    "1",
    "--toad",
    "0",
  ], ctx.env);
  if (kliIncept.code !== 0) {
    throw new Error(
      `kli incept failed: ${kliIncept.stderr}\n${kliIncept.stdout}`,
    );
  }

  const tufaIncept = await runTufa(
    [
      "incept",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaIncept.code !== 0) {
    throw new Error(
      `tufa incept failed: ${tufaIncept.stderr}\n${tufaIncept.stdout}`,
    );
  }

  const kliPre = extractPrefix(kliIncept.stdout);
  const tufaPre = extractPrefix(tufaIncept.stdout);
  assertEquals(tufaPre, kliPre);

  const expectedListLine = `${alias} (${tufaPre})`;

  const kliListAfter = await runCmd(ctx.kliCommand, [
    "list",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
  ], ctx.env);
  if (kliListAfter.code !== 0) {
    throw new Error(
      `kli list (after) failed: ${kliListAfter.stderr}\n${kliListAfter.stdout}`,
    );
  }

  const tufaListAfter = await runTufa(
    [
      "list",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaListAfter.code !== 0) {
    throw new Error(
      `tufa list (after) failed: ${tufaListAfter.stderr}\n${tufaListAfter.stdout}`,
    );
  }

  assertEquals(extractIdentifierLines(kliListAfter.stdout), [expectedListLine]);
  assertEquals(extractIdentifierLines(tufaListAfter.stdout), [
    expectedListLine,
  ]);

  const kliAid = await runCmd(ctx.kliCommand, [
    "aid",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
  ], ctx.env);
  if (kliAid.code !== 0) {
    throw new Error(`kli aid failed: ${kliAid.stderr}\n${kliAid.stdout}`);
  }

  const tufaAid = await runTufa(
    [
      "aid",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaAid.code !== 0) {
    throw new Error(`tufa aid failed: ${tufaAid.stderr}\n${tufaAid.stdout}`);
  }

  assertEquals(extractLastNonEmptyLine(kliAid.stdout), tufaPre);
  assertEquals(extractLastNonEmptyLine(tufaAid.stdout), tufaPre);
}

Deno.test("interop/keystore initialization, inception, and exported KEL match KERIpy", async () => {
  await runInitInceptExportParity(await createScenarioContext());
});

Deno.test("interop/keystore list and AID visibility match KERIpy", async () => {
  await runListAidVisibilityParity(await createScenarioContext());
});
