/** Finite introduction/authentication composition shared by environment creation and inception. */
import { type Operation, scoped, spawn } from "effection";
import type { Baser } from "../db/basing.ts";
import { Authenticator, hasWellKnownAuth } from "./authenticating.ts";
import type { Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import { Oobiery, oobiTerminalState } from "./oobiery.ts";
import { createProtocolProcessor } from "./protocol-processing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/** Expected remote outcomes; infrastructure and cleanup failures still propagate. */
export type BootstrapResult =
  | { kind: "complete" }
  | { kind: "failed"; failures: { url: string; state: string }[] }
  | { kind: "timeout"; pending: string[] };

/** In-memory selection mirrors the two durable work families, including overlapping URLs. */
interface BootstrapWork {
  oobis: Set<string>;
  woobi: Set<string>;
}

/**
 * Resolve this command's pending introductions and well-known authentication.
 *
 * The command is the sole OOBI/authentication worker owner for its borrowed Habery.
 * Select existing oobis/coobi/moobi and woobi/mfa rows, then include children and
 * introductions queued by processing them. Old terminal rows alone select no work.
 * Surviving coobi/mfa/moobi rows resume through their ordinary component owners.
 * A queued attempt takes precedence over any older terminal/authorization row.
 * The actual table family selects its terminal evidence: a well-known URL may
 * be an ordinary introduction, a separate authentication, or both.
 *
 * Like KERIpy init, compose Oobiery and Authenticator directly. Resolution means
 * that Oobiery processed the response, not that all its protocol evidence was
 * accepted. KEL/reply escrow processing lets evidence arriving in separate
 * responses unlock introductions and authentication's required controller state.
 * Escrow contents never determine bootstrap completion. Later operations must
 * check the accepted evidence they actually require.
 *
 * @param hby Borrowed identities/configuration/Baser; kept open through cleanup.
 * @param http Borrowed request implementation used by OOBIs and authentication.
 * @param options Finite positive elapsed deadline, default 30 seconds.
 * @returns Selected terminal success, refusal or deadline after all children/I/O join.
 * @throws Invariant, parser, storage, transport and cleanup failures propagate unchanged.
 */
export function resolveBootstrap(
  hby: Habery,
  http: HttpClient,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Operation<BootstrapResult> {
  return scoped(function* bootstrapScope() {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("Bootstrap timeout must be finite and positive");
    }
    const selected: BootstrapWork = { oobis: new Set(), woobi: new Set() };
    collectPendingUrls(hby.db, selected);
    if (selected.oobis.size === 0 && selected.woobi.size === 0) return { kind: "complete" };

    const protocol = createProtocolProcessor(hby);
    const oobiery = new Oobiery(hby, protocol, protocol.rvy, http, protocol.cues);
    oobiery.registerReplyRoutes();
    const authenticator = new Authenticator(hby, http);
    yield* spawn(() => oobiery.oobiDo());
    yield* spawn(() => authenticator.authDo());
    yield* spawn(function*() {
      while (true) {
        protocol.processKelReplyEscrowsOnce();
        yield* runtimeTurn();
      }
    });
    const deadline = performance.now() + timeoutMs;
    while (true) {
      collectPendingUrls(hby.db, selected);
      const result = inspectBootstrap(hby.db, selected);
      if (result) return result;
      if (performance.now() >= deadline) {
        const pending: string[] = [];
        for (const kind of ["oobis", "woobi"] as const) {
          for (const url of selected[kind]) if (!bootstrapUrlComplete(hby.db, url, kind)) pending.push(url);
        }
        return {
          kind: "timeout",
          pending: [...new Set(pending)],
        };
      }
      yield* runtimeTurn();
    }
  });
}

/** Select actual queued/in-flight records; Oobiery owns multi-OOBI child completion. */
function collectPendingUrls(db: Baser, selected: BootstrapWork): void {
  for (const store of [db.oobis, db.coobi, db.moobi]) {
    for (const [keys] of store.getTopItemIter()) if (keys[0]) selected.oobis.add(keys[0]);
  }
  for (const store of [db.woobi, db.mfa]) {
    for (const [keys] of store.getTopItemIter()) if (keys[0]) selected.woobi.add(keys[0]);
  }
}

/** Require current terminal evidence; a saved authorization cannot mask a queued retry. */
function bootstrapUrlComplete(db: Baser, url: string, kind: "oobis" | "woobi"): boolean {
  if (oobiTerminalState(db, url, kind).status !== "resolved") return false;
  return kind === "oobis" || hasWellKnownAuth(db, url);
}

/** Decide only from selected URLs; absence of queue rows alone never establishes success. */
function inspectBootstrap(db: Baser, selected: BootstrapWork): BootstrapResult | null {
  const failures: { url: string; state: string }[] = [];
  let pending = false;
  for (const kind of ["oobis", "woobi"] as const) {
    for (const url of selected[kind]) {
      const terminal = oobiTerminalState(db, url, kind);
      if (terminal.status === "failed") failures.push({ url, state: terminal.record?.state ?? "failed" });
      else if (!bootstrapUrlComplete(db, url, kind)) pending = true;
    }
  }
  if (failures.length) return { kind: "failed", failures };
  return pending ? null : { kind: "complete" };
}
