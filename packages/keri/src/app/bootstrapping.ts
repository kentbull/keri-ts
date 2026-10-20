/** Finite configured introduction bootstrap, shared by environment creation and inception. */
import { call, type Operation } from "effection";
import { ValidationError } from "../core/errors.ts";
import type { Baser } from "../db/basing.ts";
import { createAgentRuntime, runAgentRuntimeUntil, runtimeHasPendingWork } from "./agent-runtime.ts";
import { hasWellKnownAuth } from "./authenticating.ts";
import type { Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import { oobiTerminalState } from "./oobiery.ts";
import type { RuntimeClock } from "./runtime-clock.ts";

/**
 * Resolve queued OOBIs and configured well-known authentication before continuing.
 *
 * This ownership cut preserves the existing whole-runtime completion predicate,
 * global failed-OOBI check and 30-second deadline. The approved bootstrap plan's
 * next cut replaces them with explicit Oobiery/Authenticator composition and
 * selected-work completion. KERIpy init composes those concrete owners directly.
 *
 * @param hby Borrowed identity/configuration and Baser; kept open through cleanup.
 * @param http Borrowed request implementation, shared with the calling workflow.
 * @param clock Borrowed transport/escrow clock; the current runtime deadline uses wall time.
 * @throws Remote resolution/authentication refusal, worker, deadline and cleanup
 * failures propagate. This operation closes its own runtime, never the Habery.
 */
export function resolveBootstrap(hby: Habery, http: HttpClient, clock: RuntimeClock): Operation<void> {
  return call(function*() {
    if (hby.db.oobis.cnt() === 0 && hby.db.woobi.cnt() === 0) return;
    const runtime = yield* createAgentRuntime(hby, http, clock);
    try {
      yield* runAgentRuntimeUntil(runtime, () => !runtimeHasPendingWork(runtime), {
        timeoutMs: 30_000,
        pollMailbox: false,
      });
      if (hby.db.eoobi.cnt() > 0) throw new ValidationError("Bootstrap OOBI resolution failed.");
      const urls = Array.isArray(hby.config.wurls)
        ? hby.config.wurls.filter((entry): entry is string => typeof entry === "string")
        : [];
      assertWellKnownAuth(hby.db, urls);
    } finally {
      yield* runtime.close();
    }
  });
}

/** Inspect successful authorization and existing terminal detail without acquiring runtime services. */
function assertWellKnownAuth(db: Baser, urls: readonly string[]): void {
  const failed = urls.filter(url => !hasWellKnownAuth(db, url));
  if (!failed.length) return;
  const details = failed.map(url => {
    const terminal = oobiTerminalState(db, url);
    return `${url} (${terminal.record?.state ?? terminal.status})`;
  }).join(", ");
  throw new ValidationError(`Bootstrap well-known auth failed: ${details}`);
}
