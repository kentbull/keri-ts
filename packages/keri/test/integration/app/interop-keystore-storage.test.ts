import { assert, assertEquals } from "jsr:@std/assert";
import {
  createScenarioContext,
  extractIdentifierLines,
  extractKelStream,
  extractLastNonEmptyLine,
  extractPrefix,
  normalizeCesr,
  runCmd,
  runTufa,
  type ScenarioContext,
} from "./interop-keystore-helpers.ts";

import { ensureCompatLmdbBuild } from "../../../test/utils.ts";

/** Read the same persisted KERIpy store through Tufa compatibility paths. */
async function runKliCompatStoreOpen(
  ctx: ScenarioContext,
): Promise<void> {
  await ensureCompatLmdbBuild(ctx.packageRoot);

  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const name = `kli-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(ctx.kliCommand, [
    "init",
    "--version",
    "1.0",
    "--name",
    name,
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
    name,
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
  const kliPre = extractPrefix(kliIncept.stdout);
  const expectedListLine = `${alias} (${kliPre})`;

  const tufaList = await runTufa(
    [
      "list",
      "--name",
      name,
      "--passcode",
      passcode,
      "--compat",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaList.code !== 0) {
    throw new Error(`tufa list failed: ${tufaList.stderr}\n${tufaList.stdout}`);
  }

  const tufaAid = await runTufa(
    [
      "aid",
      "--name",
      name,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--compat",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaAid.code !== 0) {
    throw new Error(`tufa aid failed: ${tufaAid.stderr}\n${tufaAid.stdout}`);
  }

  assertEquals(extractIdentifierLines(tufaList.stdout), [expectedListLine]);
  assertEquals(extractLastNonEmptyLine(tufaAid.stdout), kliPre);
}

/** Reopen encrypted material with the correct passcode and reject an incorrect one. */
async function runEncryptedKeeperSemantics(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `encrypted-keeper-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "encrypted-aid";
  const passcode = "MyPasscodeARealSecret";
  const wrongPasscode = "WrongPasscodeSecretAB";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const name = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const tufaInit = await runTufa(
    [
      "init",
      "--name",
      name,
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
      name,
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
  const pre = extractPrefix(tufaIncept.stdout);
  const expectedListLine = `${alias} (${pre})`;

  const tufaList = await runTufa(
    [
      "list",
      "--name",
      name,
      "--base",
      base,
      "--passcode",
      passcode,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaList.code !== 0) {
    throw new Error(`tufa list failed: ${tufaList.stderr}\n${tufaList.stdout}`);
  }

  const tufaAid = await runTufa(
    [
      "aid",
      "--name",
      name,
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

  const tufaExport = await runTufa(
    [
      "export",
      "--name",
      name,
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

  const wrongList = await runTufa(
    [
      "list",
      "--name",
      name,
      "--base",
      base,
      "--passcode",
      wrongPasscode,
    ],
    ctx.env,
    ctx.packageRoot,
  );

  assertEquals(extractIdentifierLines(tufaList.stdout), [expectedListLine]);
  assertEquals(extractLastNonEmptyLine(tufaAid.stdout), pre);
  assertEquals(
    normalizeCesr(extractKelStream(tufaExport.stdout)).length > 0,
    true,
  );
  assertEquals(wrongList.code === 0, false);
  assert(
    /too many attempts|not associated with last aeid|valid passcode required/i
      .test(`${wrongList.stdout}\n${wrongList.stderr}`),
    `Expected wrong passcode failure, got:\n${wrongList.stdout}\n${wrongList.stderr}`,
  );
}

Deno.test("interop/Tufa opens a KERIpy-created keystore", async () => {
  await runKliCompatStoreOpen(await createScenarioContext());
});

Deno.test("interop/encrypted keeper enforces matching passcode and reopens qualified material", async () => {
  await runEncryptedKeeperSemantics(await createScenarioContext());
});
