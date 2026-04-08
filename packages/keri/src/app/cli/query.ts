import { action, type Operation, spawn } from "npm:effection@^3.6.0";
import type { CueEmission } from "../../core/cues.ts";
import { ValidationError } from "../../core/errors.ts";
import { Roles } from "../../core/roles.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
  runtimeHasPendingWork,
  runtimeTurn,
} from "../agent-runtime.ts";
import { buildCesrRequest, splitCesrStream } from "../cesr-http.ts";
import type { CueSink } from "../cue-runtime.ts";
import type { Hab, Habery } from "../habbing.ts";
import { fetchResponseHandle } from "../httping.ts";
import { flattenRoleUrls } from "../mailboxing.ts";
import { printExternal } from "./common/displaying.ts";
import { setupHby } from "./common/existing.ts";

interface QueryArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
  prefix?: string;
  anchor?: string;
}

const QueryTimeoutMs = 10_000;

function loadAnchor(path: string): Record<string, unknown> {
  const text = Deno.readTextFileSync(path);
  const anchor = JSON.parse(text);
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    throw new ValidationError("Anchor file must contain a JSON object.");
  }
  return anchor as Record<string, unknown>;
}

function resolveQueryDestinationUrl(
  hab: Hab,
  queriedPre: string,
  destination: string,
): string | null {
  const ends = hab.endsFor(queriedPre);
  for (const role of [Roles.controller, Roles.agent, Roles.witness]) {
    const endpoint = flattenRoleUrls(ends[role]).find((entry) => entry.eid === destination);
    if (endpoint) {
      return endpoint.url;
    }
  }
  return null;
}

function controllerCatchupUrl(
  hab: Hab,
  queriedPre: string,
): string | null {
  const ends = hab.endsFor(queriedPre);
  const controller = flattenRoleUrls(ends[Roles.controller])[0]
    ?? flattenRoleUrls(ends[Roles.agent])[0];
  if (!controller) {
    return null;
  }

  const url = new URL(controller.url);
  url.pathname = `/oobi/${queriedPre}/controller`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function queryTransportSink(
  runtime: AgentRuntime,
  hby: Habery,
  hab: Hab,
): CueSink {
  return {
    *send(emission: CueEmission): Operation<void> {
      if (emission.kind !== "wire" || emission.cue.kin !== "query") {
        return;
      }
      const destination = emission.cue.src;
      const queriedPre = emission.cue.pre;
      const message = emission.msgs[0];
      if (!destination || !queriedPre || !message) {
        return;
      }

      const url = resolveQueryDestinationUrl(hab, queriedPre, destination);
      if (!url) {
        throw new ValidationError(
          `No endpoint URL found for query destination ${destination}.`,
        );
      }
      yield* postQueryMessage(runtime, url, message, hby.cesrBodyMode, destination);
    },
  };
}

function* readResponseBytes(response: Response): Operation<Uint8Array> {
  const buffer = yield* action<ArrayBuffer>((resolve, reject) => {
    response.arrayBuffer()
      .then(resolve)
      .catch((error) => reject(error instanceof Error ? error : new Error(String(error))));
    return () => {};
  });
  return new Uint8Array(buffer);
}

function* postQueryMessage(
  runtime: AgentRuntime,
  url: string,
  body: Uint8Array,
  bodyMode: "header" | "body",
  destination?: string,
): Operation<void> {
  const requests = bodyMode === "header" ? splitCesrStream(body) : [body];
  for (const currentBody of requests) {
    const request = buildCesrRequest(currentBody, {
      bodyMode,
      destination,
    });
    const { response } = yield* fetchResponseHandle(url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
    });
    if (!response.ok) {
      throw new ValidationError(
        `Query delivery to ${url} failed with HTTP ${response.status}.`,
      );
    }
    const bytes = yield* readResponseBytes(response);
    if (bytes.length > 0) {
      ingestKeriBytes(runtime, bytes);
    }
  }
}

/** Implements `tufa query`. */
export function* queryCommand(args: Record<string, unknown>): Operation<void> {
  const queryArgs: QueryArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    prefix: args.prefix as string | undefined,
    anchor: args.anchor as string | undefined,
  };

  if (!queryArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!queryArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  if (!queryArgs.prefix) {
    throw new ValidationError("Prefix is required and cannot be empty");
  }

  const doer = yield* spawn(function*() {
    const hby = yield* setupHby(
      queryArgs.name!,
      queryArgs.base ?? "",
      queryArgs.passcode,
      false,
      queryArgs.headDirPath,
      {
        compat: queryArgs.compat ?? false,
        readonly: false,
        skipConfig: true,
        skipSignator: true,
      },
    );
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    try {
      const hab = hby.habByName(queryArgs.alias!);
      if (!hab) {
        throw new ValidationError(`Alias ${queryArgs.alias!} is invalid`);
      }
      const sink = queryTransportSink(runtime, hby, hab);

      let watchDone = () => false;
      if (queryArgs.anchor) {
        const anchor = loadAnchor(queryArgs.anchor);
        console.log(`Checking for anchor ${JSON.stringify(anchor)}...`);
        const querier = runtime.querying.watchAnchor(queryArgs.prefix!, anchor, {
          hab,
        });
        watchDone = () => querier.done;
      } else {
        console.log("Checking for updates...");
        const noticer = runtime.querying.watchKeyState(queryArgs.prefix!, { hab });
        watchDone = () => noticer.done;
      }

      const deadline = Date.now() + QueryTimeoutMs;
      while (!watchDone() && Date.now() < deadline) {
        yield* processRuntimeTurn(runtime, { hab, pollMailbox: true, sink });
        if (!watchDone()) {
          yield* runtimeTurn();
        }
      }

      if (!watchDone() && !queryArgs.anchor) {
        const catchupUrl = controllerCatchupUrl(hab, queryArgs.prefix!);
        if (catchupUrl) {
          runtime.oobiery.resolve(catchupUrl);
          const catchupDeadline = Date.now() + 5_000;
          while (!watchDone() && Date.now() < catchupDeadline) {
            yield* processRuntimeTurn(runtime, { hab, pollMailbox: true, sink });
            if (!runtimeHasPendingWork(runtime)) {
              break;
            }
            yield* runtimeTurn();
          }
        }
      }

      console.log("");
      printExternal(hby, queryArgs.prefix!);
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });

  yield* doer;
}
