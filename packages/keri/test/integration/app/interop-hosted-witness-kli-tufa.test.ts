/**
 * KERIpy controllers register with and receipt through the Tufa hosted witness backend
 * (`tufa witness backend`), which follows witness-hk's `/aids` and `/receipts` contract.
 */
import { assertEquals, assertMatch } from "jsr:@std/assert";
import { TOTP } from "npm:otpauth@9.4.1";
import {
  createInteropContext,
  extractPrefix,
  randomPort,
  requireSuccess,
  runCmdWithTimeout,
  spawnChild,
  stopChild,
  waitForHttpOk,
  workspaceRoot,
} from "./interop-test-helpers.ts";
import { keripyProtocolVersionArgs } from "./keripy-runtime.ts";

const PASSCODE = "MyPasscodeARealSecret";
const SALT = "0AAwMTIzNDU2Nzg5YWJjZGVm";

Deno.test("Interop hosted witness: kli witness authenticate after inception and kli rotate --authenticate --code", async () => {
  const ctx = await createInteropContext();
  const headDir = await Deno.makeTempDir({ prefix: "tufa-hosted-witness-kli-" });
  const httpPort = randomPort(), bootPort = randomPort(new Set([httpPort]));
  const publicUrl = `http://127.0.0.1:${httpPort}`, bootUrl = `http://127.0.0.1:${bootPort}`;
  const backend = spawnChild(
    Deno.execPath(),
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "packages/tufa/mod.ts",
      "witness",
      "backend",
      "--name",
      "provider",
      "--url",
      publicUrl,
      "--http",
      String(httpPort),
      "--boot-port",
      String(bootPort),
      "--head-dir",
      headDir,
      "--passcode",
      "abcdefghijklmnopqrstu",
    ],
    ctx.env,
    workspaceRoot(),
  );
  const name = `kli-${crypto.randomUUID().slice(0, 8)}`, base = `hosted-${crypto.randomUUID().slice(0, 8)}`;
  /** Run one kli subcommand against the controller keystore. */
  const kli = (label: string, command: string[], args: string[] = [], timeoutMs = 30_000) =>
    requireSuccess(
      label,
      runCmdWithTimeout(
        ctx.kliCommand,
        [...command, "--name", name, "--base", base, "--passcode", PASSCODE, ...args],
        ctx.env,
        timeoutMs,
      ),
    );
  try {
    await waitForHttpOk(bootUrl + "/health", 60_000);
    await kli("kli init", ["init"], ["--salt", SALT]);
    const incept = (alias: string, keys: string) =>
      kli(`kli incept ${alias}`, ["incept"], [
        "--alias",
        alias,
        "--transferable",
        "--isith",
        keys,
        "--icount",
        keys,
        "--nsith",
        keys,
        "--ncount",
        keys,
        "--toad",
        "0",
        ...keripyProtocolVersionArgs(ctx.env, "2.0"),
      ]);
    const allocate = async (aid: string): Promise<{ eid: string; oobis: string[] }> => {
      const response = await fetch(bootUrl + "/witnesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aid }),
      });
      assertEquals(response.status, 200);
      return await response.json();
    };
    /** Register through `kli witness authenticate`; the seed stays inside this test. */
    const authenticate = async (alias: string, eid: string): Promise<string> => {
      const result = await kli(`kli witness authenticate ${alias}`, ["witness", "authenticate"], [
        "--alias",
        alias,
        "--witness",
        eid,
        "--url-only",
      ]);
      const secret = /otpauth:\/\/totp\/KERIpy:[^?\s]+\?secret=([A-Z2-7]{32})&issuer=KERIpy/.exec(result.stdout)?.[1];
      if (!secret) throw new Error("kli witness authenticate printed no otpauth URL");
      return secret;
    };

    // A single-key controller registers after its KEL has advanced past inception.
    const pre = extractPrefix((await incept("controller", "1")).stdout);
    await kli("kli interact", ["interact"], ["--alias", "controller"]);
    const witness = await allocate(pre);
    await kli("kli oobi resolve", ["oobi", "resolve"], ["--oobi", witness.oobis[0], "--oobi-alias", "hosted"]);
    const secret = await authenticate("controller", witness.eid);

    /** Generate a code inside one TOTP step so kli's own code time selects the same step. */
    const codeFor = async (secret: string): Promise<string> => {
      while (30 - Math.floor(Date.now() / 1000) % 30 < 8) await new Promise(resolve => setTimeout(resolve, 1000));
      return new TOTP({ secret }).generate();
    };
    const code = await codeFor(secret);
    await kli("kli rotate --authenticate", ["rotate"], [
      "--alias",
      "controller",
      "--witness-add",
      witness.eid,
      "--toad",
      "1",
      "--receipt-endpoint",
      "--authenticate",
      "--code",
      `${witness.eid}:${code}`,
    ], 60_000);
    // The witness accepted the authenticated rotation and holds its own receipt for sn 2.
    const receipt = await fetch(`${publicUrl}/receipts?pre=${pre}&sn=2`, {
      headers: { "CESR-DESTINATION": witness.eid },
    });
    await receipt.arrayBuffer();
    assertEquals(receipt.status, 200);
    const status = await kli("kli status", ["status"], ["--alias", "controller"]);
    // The controller holds the hosted witness receipt: one of one witness, fully witnessed at sn 2.
    assertMatch(status.stdout, /Seq No:\s+2\s[\s\S]*Count:\s+1\s+Receipts:\s+1\s+Threshold:\s+1/);

    // Re-registration with the full KEL that names the witness issues a new secret for later events.
    const renewed = await authenticate("controller", witness.eid);
    await kli("kli interact --authenticate", ["interact"], [
      "--alias",
      "controller",
      "--receipt-endpoint",
      "--authenticate",
      "--code",
      `${witness.eid}:${await codeFor(renewed)}`,
    ], 60_000);
    const interaction = await fetch(`${publicUrl}/receipts?pre=${pre}&sn=3`, {
      headers: { "CESR-DESTINATION": witness.eid },
    });
    await interaction.arrayBuffer();
    assertEquals(interaction.status, 200);
  } finally {
    await stopChild(backend);
    await Deno.remove(headDir, { recursive: true }).catch(() => undefined);
    await Deno.remove(ctx.home, { recursive: true }).catch(() => undefined);
  }
});
