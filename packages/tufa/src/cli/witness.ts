/**
 * Tufa witness operator commands.
 *
 * The witness role is a combined witness+mailbox host backed by one
 * non-transferable local habitat. Startup reconciles self endpoint and role
 * replies before serving, so later OOBI and receipt flows see durable state
 * rather than process-local defaults.
 */
import type { Operation } from "effection";
import {
  type Configer,
  createConfiger,
  Receiptor,
  ValidationError,
  WitnessReceiptor,
} from "keri-ts/runtime";
import { configFileCandidates, validateIsoDatetime } from "../operator/host-planning.ts";
import { reconcileWitnessHostStartup, resolveWitnessHostStartup } from "../operator/witness-startup.ts";
import { runWitnessHost } from "../roles/witness.ts";
import { withExistingHab } from "./support/context.ts";
import { ensureHby } from "./support/existing.ts";
import { writeTextLines } from "./support/rendering.ts";
import { resolveWitnessAuths } from "./support/witness-auth.ts";

interface WitnessBaseArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
}

interface WitnessStartArgs extends WitnessBaseArgs {
  configDir?: string;
  configFile?: string;
  url?: string;
  tcpUrl?: string;
  datetime?: string;
  http?: number;
  tcp?: number;
  listenHost?: string;
}

interface WitnessSubmitArgs extends WitnessBaseArgs {
  force?: boolean;
  endpoint?: boolean;
  authenticate?: boolean;
  code?: string[];
  codeTime?: string;
}

/** Start one combined witness+mailbox host after identity reconciliation. */
export function* witnessStartCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs = parseWitnessStartArgs(args);
  const startConfig = yield* loadWitnessStartConfig(commandArgs);
  const ensured = yield* ensureHby(
    commandArgs.name!,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      cf: startConfig,
      skipConfig: !startConfig,
      skipSignator: false,
    },
  );
  const hby = ensured.hby;

  try {
    const startup = resolveWitnessHostStartup(
      hby,
      commandArgs,
      startConfig?.get<Record<string, unknown>>() ?? null,
    );
    yield* reconcileWitnessHostStartup(hby, startup);

    writeTextLines([
      `Witness Prefix  ${startup.hab.pre}`,
      `HTTP URL        ${startup.startup.httpUrl}`,
      `TCP URL         ${startup.startup.tcpUrl}`,
      `Mailbox Admin   ${startup.mailboxAdminUrl}`,
      `Witness OOBI    ${startup.witnessOobi}`,
      `Mailbox OOBI    ${startup.mailboxOobi}`,
      `HTTP Listen     ${startup.httpListenHost}:${startup.httpPort}`,
      `TCP Listen      ${startup.tcpListenHost}:${startup.tcpPort}`,
      `Keystore        ${ensured.created ? "created" : "reused"}`,
      `Witness AID     ${startup.aidCreated ? "created" : "reused"}`,
    ]);

    yield* runWitnessHost(hby, {
      serviceHab: startup.hab,
      httpPort: startup.httpPort,
      httpListenHost: startup.httpListenHost,
      tcpPort: startup.tcpPort,
      tcpListenHost: startup.tcpListenHost,
    });
  } finally {
    yield* hby.close();
  }
}

/** Submit the current local event to witnesses and converge the receipt set. */
export function* witnessSubmitCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: WitnessSubmitArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    force: args.force as boolean | undefined,
    endpoint: args.endpoint as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
  };

  yield* withExistingHab(
    commandArgs,
    commandArgs.alias,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: true,
    },
    function*({ hby, hab }) {
      const auths = resolveWitnessAuths(
        hab.kever?.wits ?? [],
        commandArgs.code ?? [],
        {
          codeTime: commandArgs.codeTime,
          promptMissing: commandArgs.authenticate ?? false,
          normalizeCodeTime: validateIsoDatetime,
        },
      );
      if (commandArgs.endpoint) {
        const receiptor = new Receiptor(hby);
        yield* receiptor.receipt(hab.pre, { sn: hab.kever?.sn, auths });
      } else {
        const witDoer = new WitnessReceiptor(hby, {
          force: commandArgs.force ?? false,
        });
        yield* witDoer.submit(hab.pre, {
          sn: hab.kever?.sn,
          auths,
        });
      }

      console.log(`Prefix  ${hab.pre}`);
      console.log(`Sequence No.  ${hab.kever?.sn ?? ""}`);
    },
  );
}

function parseWitnessStartArgs(
  args: Record<string, unknown>,
): WitnessStartArgs {
  const parsed: WitnessStartArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    configDir: args.configDir as string | undefined,
    configFile: args.configFile as string | undefined,
    url: args.url as string | undefined,
    tcpUrl: args.tcpUrl as string | undefined,
    datetime: args.datetime as string | undefined,
    http: args.http !== undefined ? Number(args.http) : undefined,
    tcp: args.tcp !== undefined ? Number(args.tcp) : undefined,
    listenHost: args.listenHost as string | undefined,
  };
  if (!parsed.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!parsed.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  return parsed;
}

/** Load an explicit witness config file without creating missing config state. */
function* loadWitnessStartConfig(
  args: WitnessStartArgs,
): Operation<Configer | undefined> {
  if (!args.configFile) {
    return undefined;
  }

  try {
    return yield* createConfiger({
      name: args.configFile,
      base: "",
      temp: false,
      headDirPath: args.configDir,
      reopen: true,
      clear: false,
    });
  } catch {
    for (
      const candidate of configFileCandidates(args.configFile, {
        headDirPath: args.headDirPath,
        compat: args.compat ?? false,
        home: Deno.env.get("HOME") ?? undefined,
      })
    ) {
      try {
        return yield* createConfiger({
          name: candidate,
          base: "",
          temp: false,
          reopen: true,
          clear: false,
        });
      } catch {
        continue;
      }
    }
  }

  throw new ValidationError(`Config file '${args.configFile}' was not found.`);
}
