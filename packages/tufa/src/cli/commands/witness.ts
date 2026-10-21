/**
 * Tufa witness operator commands.
 *
 * The witness role is a combined witness+mailbox host backed by one
 * non-transferable local habitat. Startup reconciles self endpoint and role
 * replies before serving, so later OOBI and receipt flows see durable state
 * rather than process-local defaults.
 */
import type { Operation } from "effection";
import { parseBooleanOption, parseIntegerOption, parseStringListOption, parseStringOption } from "keri-ts/cli";
import { systemClock } from "keri-ts/runtime";
import { FetchHttpClient } from "keri-ts/runtime";
import {
  type Configer,
  createConfiger,
  createProtocolProcessor,
  Receiptor,
  ValidationError,
  WitnessReceiptor,
} from "keri-ts/runtime";
import { configFileCandidates, validateIsoDatetime } from "../../operator/host-planning.ts";
import { reconcileWitnessHostStartup, resolveWitnessHostStartup } from "../../operator/witness-startup.ts";
import { runWitnessHost } from "../../roles/witness.ts";
import { withExistingHab } from "../support/context.ts";
import { ensureHby } from "../support/existing.ts";
import { writeTextLines } from "../support/rendering.ts";
import { resolveWitnessAuths } from "../support/witness-auth.ts";

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

/**
 * Submit the current local event to witnesses and converge the receipt set.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* witnessSubmitCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: WitnessSubmitArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    compat: parseBooleanOption(args.compat, "compat"),
    force: parseBooleanOption(args.force, "force"),
    endpoint: parseBooleanOption(args.endpoint, "endpoint"),
    authenticate: parseBooleanOption(args.authenticate, "authenticate"),
    code: parseStringListOption(args.code, "code"),
    codeTime: parseStringOption(args.codeTime, "codeTime"),
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
        const receiptor = new Receiptor(
          hby,
          createProtocolProcessor(hby),
          new FetchHttpClient(),
          systemClock,
        );
        yield* receiptor.receipt(hab.pre, { sn: hab.kever?.sn, auths });
      } else {
        const witDoer = new WitnessReceiptor(
          hby,
          createProtocolProcessor(hby),
          new FetchHttpClient(),
          systemClock,
          {
            force: commandArgs.force ?? false,
          },
        );
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
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    compat: parseBooleanOption(args.compat, "compat"),
    configDir: parseStringOption(args.configDir, "configDir"),
    configFile: parseStringOption(args.configFile, "configFile"),
    url: parseStringOption(args.url, "url"),
    tcpUrl: parseStringOption(args.tcpUrl, "tcpUrl"),
    datetime: parseStringOption(args.datetime, "datetime"),
    http: parseIntegerOption(args.http, "http"),
    tcp: parseIntegerOption(args.tcp, "tcp"),
    listenHost: parseStringOption(args.listenHost, "listenHost"),
  };
  if (!parsed.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!parsed.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  for (const [flag, port] of [["http", parsed.http], ["tcp", parsed.tcp]] as const) {
    if (port !== undefined && (port < 0 || port > 65535)) {
      throw new ValidationError(`${flag} must be between 0 and 65535`);
    }
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
