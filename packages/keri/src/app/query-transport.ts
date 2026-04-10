import { action, type Operation } from "npm:effection@^3.6.0";
import type { CueEmission } from "../core/cues.ts";
import { ValidationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { ingestKeriBytes } from "./agent-runtime.ts";
import { buildCesrRequest, splitCesrStream } from "./cesr-http.ts";
import type { CueSink } from "./cue-runtime.ts";
import type { Hab, Habery } from "./habbing.ts";
import { fetchResponseHandle } from "./httping.ts";
import { flattenRoleUrls } from "./mailboxing.ts";

/**
 * Resolve the actual transport URL for one query destination AID.
 *
 * Transport policy:
 * - prefer direct controller/agent/witness URLs when the chosen destination
 *   matches an advertised end role
 * - in mailbox-only topologies, allow queries addressed to the controller AID
 *   to ride the first mailbox endpoint URL
 */
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

  if (destination === queriedPre) {
    return flattenRoleUrls(ends[Roles.mailbox])[0]?.url ?? null;
  }

  return null;
}

/** Read one HTTP response body fully so parser ingress can consume it. */
function* readResponseBytes(response: Response): Operation<Uint8Array> {
  const buffer = yield* action<ArrayBuffer>((resolve, reject) => {
    response.arrayBuffer()
      .then(resolve)
      .catch((error) => reject(error instanceof Error ? error : new Error(String(error))));
    return () => {};
  });
  return new Uint8Array(buffer);
}

/**
 * Post one outbound query message and ingest any immediate CESR reply bytes.
 */
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

/**
 * Create the cue sink that actually posts outbound `qry` messages.
 *
 * Ownership split:
 * - `QueryCoordinator` decides *that* a query should be emitted and who it
 *   should target
 * - this sink decides *how* to deliver the already-chosen wire message
 */
export function queryTransportSink(
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
