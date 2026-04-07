import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { EndpointRoles, isEndpointRole } from "../../core/roles.ts";
import {
  createAgentRuntime,
  enqueueOobi,
  processRuntimeUntil,
  runtimeOobiConverged,
  runtimeOobiTerminalState,
} from "../agent-runtime.ts";
import { setupHby } from "./common/existing.ts";

/** Parsed arguments for `tufa oobi generate`. */
interface OobiGenerateArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  role?: string;
  compat?: boolean;
}

/** Parsed arguments for `tufa oobi resolve`. */
interface OobiResolveArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  url?: string;
  oobiAlias?: string;
  compat?: boolean;
}

/**
 * Choose one preferred URL from a scheme-keyed location map.
 *
 * Current preference order is `https`, then `http`, then the first remaining
 * stored scheme.
 */
function preferredUrl(urls: Record<string, string>): string | null {
  return urls.https ?? urls.http ?? Object.values(urls)[0] ?? null;
}

/**
 * Implement `tufa oobi generate` from locally accepted endpoint/location state.
 *
 * Source of truth:
 * - controller URLs come from `locs.`
 * - mailbox/agent URLs come from `ends.` + `locs.`
 * - witness URLs come from the current key-state witness set plus `locs.`
 *
 * The command is intentionally readonly; it does not attempt to heal or fetch
 * missing state.
 */
export function* oobiGenerateCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: OobiGenerateArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    role: args.role as string | undefined,
    compat: args.compat as boolean | undefined,
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  if (!commandArgs.role || !isEndpointRole(commandArgs.role)) {
    throw new ValidationError(
      `Unsupported OOBI role ${String(commandArgs.role)}`,
    );
  }

  const hby = yield* setupHby(
    commandArgs.name,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: true,
      skipConfig: false,
      skipSignator: true,
    },
  );

  try {
    const hab = hby.habByName(commandArgs.alias);
    if (!hab) {
      throw new ValidationError(
        `No local AID found for alias ${commandArgs.alias}`,
      );
    }

    const urls: string[] = [];
    switch (commandArgs.role) {
      case EndpointRoles.controller: {
        const url = preferredUrl(hab.fetchUrls(hab.pre));
        if (!url) {
          throw new ValidationError(
            `No controller endpoint URL is stored for ${hab.pre}`,
          );
        }
        urls.push(`${url.replace(/\/$/, "")}/oobi/${hab.pre}/controller`);
        break;
      }
      case EndpointRoles.agent:
      case EndpointRoles.mailbox: {
        const ends = hab.endsFor(hab.pre)[commandArgs.role] ?? {};
        for (const [eid, surls] of Object.entries(ends)) {
          const url = preferredUrl(surls);
          if (url) {
            urls.push(
              `${url.replace(/\/$/, "")}/oobi/${hab.pre}/${commandArgs.role}/${eid}`,
            );
          }
        }
        if (urls.length === 0) {
          throw new ValidationError(
            `No ${commandArgs.role} endpoint URL is stored for ${hab.pre}`,
          );
        }
        break;
      }
      case EndpointRoles.witness: {
        const state = hby.db.getState(hab.pre);
        for (const witness of state?.b ?? []) {
          const url = preferredUrl(hab.fetchUrls(witness));
          if (url) {
            urls.push(
              `${url.replace(/\/$/, "")}/oobi/${hab.pre}/witness/${witness}`,
            );
          }
        }
        if (urls.length === 0) {
          throw new ValidationError(
            `No witness endpoint URLs are stored for ${hab.pre}`,
          );
        }
        break;
      }
    }

    for (const url of urls) {
      console.log(url);
    }
  } finally {
    yield* hby.close();
  }
}

/**
 * Implement `tufa oobi resolve` using a command-local shared runtime host.
 *
 * The command queues one OOBI job, runs one runtime turn, and succeeds only if
 * the URL lands in `roobi.`. Any reply/event material fetched from the OOBI is
 * forced through the same parser/routing path used by the long-lived host.
 */
export function* oobiResolveCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: OobiResolveArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    url: args.url as string | undefined,
    oobiAlias: args.oobiAlias as string | undefined,
    compat: args.compat as boolean | undefined,
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.url) {
    throw new ValidationError("OOBI URL is required and cannot be empty");
  }

  const hby = yield* setupHby(
    commandArgs.name,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: false,
    },
  );

  try {
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    enqueueOobi(runtime, {
      url: commandArgs.url,
      alias: commandArgs.oobiAlias,
    });
    yield* processRuntimeUntil(
      runtime,
      () => runtimeOobiConverged(runtime, commandArgs.url!),
      { maxTurns: 128 },
    );

    const terminal = runtimeOobiTerminalState(runtime, commandArgs.url);
    if (terminal.status === "failed") {
      throw new ValidationError(
        `OOBI ${commandArgs.url} failed: ${terminal.record?.state ?? "failed"}`,
      );
    }
    if (terminal.status !== "resolved") {
      throw new ValidationError(`OOBI ${commandArgs.url} did not resolve.`);
    }
    console.log(commandArgs.url);
  } finally {
    yield* hby.close();
  }
}
