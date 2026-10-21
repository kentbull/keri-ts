/**
 * Cross-implementation CLI and mailbox interoperability tests.
 *
 * The mailbox handoff relies especially on the two mailbox scenarios in this
 * file:
 * - KLI mailbox operations against a Tufa mailbox host
 * - Tufa mailbox operations against the pinned KERIpy mailbox host
 *
 * The helper layer exists to keep those subprocess-heavy scenarios readable and
 * debuggable instead of burying the protocol assertions in process plumbing.
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { createHabery } from "../../../src/app/identity/habbing.ts";
import { mailboxTopicKey, openMailboxerForHabery } from "../../../src/app/mailbox/mailboxing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import {
  createInteropContext,
  extractKelStream,
  extractLastNonEmptyLine,
  extractPrefix,
  extractRawSignature,
  inspectCompatHabery,
  normalizeCesr,
  packageRoot,
  randomPort,
  requireSuccess,
  runCmd,
  runCmdWithTimeout,
  runTufa,
  runTufaWithTimeout,
  spawnChild,
  waitForHealth,
  withStartedChild,
  workspaceRoot,
  writeAgentConfig,
} from "./interop-test-helpers.ts";

/**
 * Proves the forward mailbox interop direction:
 * - KLI authorizes a Tufa mailbox host
 * - Tufa resolves the resulting mailbox OOBI
 * - Tufa delivers `/challenge` traffic that KLI later polls and verifies
 */
Deno.test("Interop: kli mailbox add works against a tufa mailbox host and kli challenge verify polls it", async () => {
  const ctx = await createInteropContext();
  const base = `interop-mailbox-kli-${crypto.randomUUID().slice(0, 8)}`;
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const tufaHeadDir = `${ctx.home}/tufa-head`;
  const providerPort = randomPort();
  const bobPort = randomPort();
  const providerOrigin = `http://127.0.0.1:${providerPort}`;
  const bobOrigin = `http://127.0.0.1:${bobPort}`;
  const providerName = `tufa-mbx-${crypto.randomUUID().slice(0, 8)}`;
  const providerAlias = "relay";
  const kliName = `kli-ctrl-${crypto.randomUUID().slice(0, 8)}`;
  const kliAlias = "alice";
  const bobName = `tufa-bob-${crypto.randomUUID().slice(0, 8)}`;
  const bobAlias = "bob";
  const providerInit = await requireSuccess(
    "tufa provider init",
    runTufa(
      [
        "init",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  assertEquals(providerInit.code, 0);

  const providerIncept = await requireSuccess(
    "tufa provider incept",
    runTufa(
      [
        "incept",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        providerAlias,
        "--icount",
        "1",
        "--isith",
        "1",
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  const providerPre = extractPrefix(providerIncept.stdout);
  // This interop case exercises full mailbox delivery against a real KERIpy
  // host, not just mailbox-admin routing. KERIpy still expects mailbox
  // transport at the rooted provider URL, so keep this fixture rooted.
  const providerUrl = providerOrigin;

  await requireSuccess(
    "tufa provider location add",
    runTufa(
      [
        "loc",
        "add",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        providerAlias,
        "--url",
        providerUrl,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    "tufa provider controller end role",
    runTufa(
      [
        "ends",
        "add",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        providerAlias,
        "--role",
        "controller",
        "--eid",
        providerPre,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    "tufa provider mailbox end role",
    runTufa(
      [
        "ends",
        "add",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        providerAlias,
        "--role",
        "mailbox",
        "--eid",
        providerPre,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );

  const kliInit = await requireSuccess(
    "kli init",
    runCmd(ctx.kliCommand, [
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
    ], ctx.env),
  );
  assertEquals(kliInit.code, 0);

  const kliIncept = await requireSuccess(
    "kli incept",
    runCmd(ctx.kliCommand, [
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
      kliAlias,
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
    ], ctx.env),
  );
  const alicePre = extractPrefix(kliIncept.stdout);

  const bobInit = await requireSuccess(
    "tufa bob init",
    runTufa(
      [
        "init",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  assertEquals(bobInit.code, 0);

  const bobIncept = await requireSuccess(
    "tufa bob incept",
    runTufa(
      [
        "incept",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
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
      ctx.repoRoot,
    ),
  );
  const bobPre = extractPrefix(bobIncept.stdout);
  const bobUrl = `http://127.0.0.1:${bobPort}/${bobPre}`;

  await requireSuccess(
    "tufa bob location add",
    runTufa(
      [
        "loc",
        "add",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
        "--url",
        bobUrl,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    "tufa bob controller end role",
    runTufa(
      [
        "ends",
        "add",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
        "--role",
        "controller",
        "--eid",
        bobPre,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );

  await writeAgentConfig(
    tufaHeadDir,
    "provider-agent",
    providerAlias,
    providerPort,
  );
  await writeAgentConfig(
    tufaHeadDir,
    "bob-agent",
    bobAlias,
    bobPort,
  );
  const providerAgent = spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "agent",
      "--name",
      providerName,
      "--base",
      base,
      "--head-dir",
      tufaHeadDir,
      "--passcode",
      passcode,
      "--port",
      String(providerPort),
      "--config-dir",
      tufaHeadDir,
      "--config-file",
      "provider-agent",
    ],
    ctx.env,
    ctx.repoRoot,
  );
  const providerMailboxOobi = `${providerOrigin}/oobi/${providerPre}/mailbox/${providerPre}`;
  const bobControllerOobi = `${bobOrigin}/oobi/${bobPre}/controller`;
  const bobAgent = spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "agent",
      "--name",
      bobName,
      "--base",
      base,
      "--head-dir",
      tufaHeadDir,
      "--passcode",
      passcode,
      "--port",
      String(bobPort),
      "--config-dir",
      tufaHeadDir,
      "--config-file",
      "bob-agent",
    ],
    ctx.env,
    ctx.repoRoot,
  );

  await withStartedChild(providerAgent, providerPort, async () => {
    await withStartedChild(bobAgent, bobPort, async () => {
      const providerFetch = await fetch(providerMailboxOobi);
      assertEquals(providerFetch.status, 200);
      // OOBI uses the label accepted by pinned KERIpy Oobiery, distinct from POST media.
      assertEquals(providerFetch.headers.get("content-type"), "application/json+cesr");
      assertStringIncludes(
        await providerFetch.text(),
        "\"r\":\"/loc/scheme\"",
      );

      await requireSuccess(
        "kli resolve tufa provider mailbox",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "oobi",
            "resolve",
            "--version",
            "1.0",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--oobi",
            providerMailboxOobi,
            "--oobi-alias",
            providerAlias,
          ],
          ctx.env,
          20_000,
        ),
      );

      await run(() =>
        inspectCompatHabery(
          ctx,
          {
            name: kliName,
            base,
            compat: true,
            readonly: true,
            skipConfig: true,
            skipSignator: true,
            bran: passcode,
          },
          (hby) => {
            assertEquals(
              hby.db.locs.get([providerPre, "http"])?.url,
              providerUrl,
            );
            assertEquals(
              hby.db.ends.get([providerPre, EndpointRoles.mailbox, providerPre])
                ?.allowed,
              true,
            );
          },
        )
      );

      const mailboxAdd = await requireSuccess(
        "kli mailbox add",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "mailbox",
            "add",
            "--version",
            "1.0",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--alias",
            kliAlias,
            "--mailbox",
            providerAlias,
          ],
          ctx.env,
          20_000,
        ),
      );
      assertStringIncludes(mailboxAdd.stdout, providerPre);

      const mailboxList = await requireSuccess(
        "kli mailbox list",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "mailbox",
            "list",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--alias",
            kliAlias,
          ],
          ctx.env,
          20_000,
        ),
      );
      assertStringIncludes(mailboxList.stdout, providerPre);

      await requireSuccess(
        "kli resolve bob controller",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "oobi",
            "resolve",
            "--version",
            "1.0",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--oobi",
            bobControllerOobi,
            "--oobi-alias",
            bobAlias,
          ],
          ctx.env,
          20_000,
        ),
      );

      const mailboxOobi = await requireSuccess(
        "kli mailbox oobi generate",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "oobi",
            "generate",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--alias",
            kliAlias,
            "--role",
            "mailbox",
          ],
          ctx.env,
          20_000,
        ),
      );
      const mailboxUrl = extractLastNonEmptyLine(mailboxOobi.stdout);
      // The KERIpy mailbox provider keeps admin relative to the stored mailbox
      // URL path, but its served OOBI surface remains rooted.
      assertStringIncludes(mailboxUrl, `${providerOrigin}/oobi/`);
      assertStringIncludes(mailboxUrl, alicePre);
      assertStringIncludes(mailboxUrl, providerPre);

      await requireSuccess(
        "tufa resolve provider controller for kli mailbox",
        runTufa(
          [
            "oobi",
            "resolve",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            `${providerOrigin}/oobi/${providerPre}/controller`,
            "--oobi-alias",
            providerAlias,
          ],
          ctx.env,
          ctx.repoRoot,
        ),
      );

      await requireSuccess(
        "tufa resolve kli mailbox oobi",
        runTufa(
          [
            "oobi",
            "resolve",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            mailboxUrl,
            "--oobi-alias",
            kliAlias,
          ],
          ctx.env,
          ctx.repoRoot,
        ),
      );

      const words = ["able", "baker", "charlie"].join(" ");
      const challengeSend = await requireSuccess(
        "tufa challenge respond to kli mailbox",
        runTufa(
          [
            "challenge",
            "respond",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            bobAlias,
            "--recipient",
            alicePre,
            "--words",
            JSON.stringify(words.split(" ")),
          ],
          ctx.env,
          ctx.repoRoot,
        ),
      );
      assertStringIncludes(challengeSend.stdout, "Sent EXN message");

      const challengeVerify = await requireSuccess(
        "kli challenge verify",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "challenge",
            "verify",
            "--version",
            "1.0",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--signer",
            bobPre,
            "--words",
            words,
          ],
          ctx.env,
          20_000,
        ),
      );
      assertStringIncludes(challengeVerify.stdout, "successfully responded");
    });
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: providerName,
      base,
      headDirPath: tufaHeadDir,
      bran: passcode,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const mailboxer = yield* openMailboxerForHabery(hby);
      assertEquals(
        hby.db.ends.get([alicePre, EndpointRoles.mailbox, providerPre])
          ?.allowed,
        true,
      );
      assertEquals(
        mailboxer.getTopicMsgs(mailboxTopicKey(alicePre, "/challenge")).length,
        1,
      );
      yield* mailboxer.close();
    } finally {
      yield* hby.close();
    }
  });
});

/**
 * Proves the reverse mailbox interop direction:
 * - Tufa authorizes a real KERIpy/HIO mailbox host
 * - Tufa advertises mailbox OOBIs that another controller resolves
 * - mailbox-forwarded `/challenge` traffic lands in KERIpy mailbox storage and
 *   is later polled back into Tufa verification flow
 */
Deno.test("Interop: tufa mailbox add works against the real KERIpy mailbox host", async () => {
  const ctx = await createInteropContext();
  const base = `interop-mailbox-tufa-${crypto.randomUUID().slice(0, 8)}`;
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const tufaHeadDir = `${ctx.home}/tufa-head`;
  const providerPort = randomPort();
  const bobPort = randomPort();
  const providerOrigin = `http://127.0.0.1:${providerPort}`;
  const bobOrigin = `http://127.0.0.1:${bobPort}`;
  const providerName = `kli-mbx-${crypto.randomUUID().slice(0, 8)}`;
  const providerAlias = "relay";
  const aliceName = `tufa-alice-${crypto.randomUUID().slice(0, 8)}`;
  const aliceAlias = "alice";
  const bobName = `tufa-bob-${crypto.randomUUID().slice(0, 8)}`;
  const bobAlias = "bob";

  const providerInit = await requireSuccess(
    "kli provider init",
    runCmd(ctx.kliCommand, [
      "init",
      "--version",
      "1.0",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ], ctx.env),
  );
  assertEquals(providerInit.code, 0);

  const providerIncept = await requireSuccess(
    "kli provider incept",
    runCmd(ctx.kliCommand, [
      "incept",
      "--version",
      "1.0",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--icount",
      "1",
      "--isith",
      "1",
      "--ncount",
      "1",
      "--nsith",
      "1",
      "--toad",
      "0",
    ], ctx.env),
  );
  const providerPre = extractPrefix(providerIncept.stdout);
  // This interop case exercises full mailbox delivery against a real KERIpy
  // host, not just mailbox-admin routing. KERIpy still expects mailbox
  // transport at the rooted provider URL, so keep this fixture rooted.
  const providerUrl = providerOrigin;

  await requireSuccess(
    "kli provider location add",
    runCmd(ctx.kliCommand, [
      "location",
      "add",
      "--version",
      "1.0",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--url",
      providerUrl,
    ], ctx.env),
  );
  await requireSuccess(
    "kli provider controller end role",
    runCmd(ctx.kliCommand, [
      "ends",
      "add",
      "--version",
      "1.0",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--role",
      "controller",
      "--eid",
      providerPre,
    ], ctx.env),
  );
  await requireSuccess(
    "kli provider mailbox end role",
    runCmd(ctx.kliCommand, [
      "ends",
      "add",
      "--version",
      "1.0",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--role",
      "mailbox",
      "--eid",
      providerPre,
    ], ctx.env),
  );

  const aliceInit = await requireSuccess(
    "tufa alice init",
    runTufa(
      [
        "init",
        "--name",
        aliceName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  assertEquals(aliceInit.code, 0);

  const aliceIncept = await requireSuccess(
    "tufa alice incept",
    runTufa(
      [
        "incept",
        "--name",
        aliceName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        aliceAlias,
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
      ctx.repoRoot,
    ),
  );
  const alicePre = extractPrefix(aliceIncept.stdout);

  const bobInit = await requireSuccess(
    "tufa bob init",
    runTufa(
      [
        "init",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  assertEquals(bobInit.code, 0);

  const bobIncept = await requireSuccess(
    "tufa bob incept",
    runTufa(
      [
        "incept",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
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
      ctx.repoRoot,
    ),
  );
  const bobPre = extractPrefix(bobIncept.stdout);
  const bobUrl = bobOrigin;

  await requireSuccess(
    "tufa bob location add",
    runTufa(
      [
        "loc",
        "add",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
        "--url",
        bobUrl,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    "tufa bob controller end role",
    runTufa(
      [
        "ends",
        "add",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
        "--role",
        "controller",
        "--eid",
        bobPre,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );

  const providerHost = spawnChild(
    ctx.kliCommand,
    [
      "mailbox",
      "start",
      "--protocol-version",
      "1.0",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--http",
      String(providerPort),
    ],
    ctx.env,
  );
  await writeAgentConfig(
    tufaHeadDir,
    "bob-agent",
    bobAlias,
    bobPort,
  );
  const bobAgent = spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "agent",
      "--name",
      bobName,
      "--base",
      base,
      "--head-dir",
      tufaHeadDir,
      "--passcode",
      passcode,
      "--port",
      String(bobPort),
      "--config-dir",
      tufaHeadDir,
      "--config-file",
      "bob-agent",
    ],
    ctx.env,
    ctx.repoRoot,
  );

  await withStartedChild(providerHost, providerPort, async () => {
    await withStartedChild(bobAgent, bobPort, async () => {
      await requireSuccess(
        "tufa resolve keripy provider controller",
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            `${providerOrigin}/oobi/${providerPre}/controller`,
            "--oobi-alias",
            providerAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );

      const mailboxAdd = await requireSuccess(
        "tufa mailbox add against real keripy host",
        runTufaWithTimeout(
          [
            "mailbox",
            "add",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            aliceAlias,
            "--mailbox",
            providerAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      assertStringIncludes(mailboxAdd.stdout, `added ${providerPre}`);

      const mailboxList = await requireSuccess(
        "tufa mailbox list",
        runTufaWithTimeout(
          [
            "mailbox",
            "list",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            aliceAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      assertStringIncludes(mailboxList.stdout, providerPre);
      assertStringIncludes(mailboxList.stdout, providerUrl);

      await requireSuccess(
        "tufa resolve bob controller",
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            `${bobOrigin}/oobi/${bobPre}/controller`,
            "--oobi-alias",
            bobAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );

      const mailboxOobi = await requireSuccess(
        "tufa mailbox oobi generate",
        runTufaWithTimeout(
          [
            "oobi",
            "generate",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            aliceAlias,
            "--role",
            "mailbox",
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      const mailboxUrl = extractLastNonEmptyLine(mailboxOobi.stdout);
      assertStringIncludes(mailboxUrl, `${providerOrigin}/oobi/`);
      assertStringIncludes(mailboxUrl, alicePre);
      assertStringIncludes(mailboxUrl, providerPre);

      await requireSuccess(
        "tufa bob resolve provider controller",
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            `${providerOrigin}/oobi/${providerPre}/controller`,
            "--oobi-alias",
            providerAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );

      await requireSuccess(
        "tufa bob resolve alice mailbox oobi",
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            mailboxUrl,
            "--oobi-alias",
            aliceAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );

      const firstWords = ["hotel", "india", "juliet"];
      const firstSend = await requireSuccess(
        "tufa challenge respond via real keripy mailbox host",
        runTufaWithTimeout(
          [
            "challenge",
            "respond",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            bobAlias,
            "--recipient",
            alicePre,
            "--words",
            JSON.stringify(firstWords),
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      assertStringIncludes(firstSend.stdout, "Sent EXN message");

      const firstVerify = await requireSuccess(
        "tufa challenge verify via real keripy mailbox host",
        runTufaWithTimeout(
          [
            "challenge",
            "verify",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--signer",
            bobPre,
            "--words",
            JSON.stringify(firstWords),
            "--timeout",
            "5",
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      assertStringIncludes(firstVerify.stdout, bobPre);
    });
  });
});
