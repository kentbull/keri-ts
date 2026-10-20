/** Finite introduction/authentication composition shared by environment creation and inception. */
import { call, type Operation, race, resource, sleep, spawn } from "effection";
import type { Baser } from "../db/basing.ts";
import { Authenticator, hasWellKnownAuth } from "./authenticating.ts";
import type { Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import { isWellKnownOobiUrl, Oobiery, oobiTerminalState, parseOobiUrl } from "./oobiery.ts";
import { createProtocolProcessor } from "./protocol-processing.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import { WitnessInquisitor } from "./witness-inquisitor.ts";

/** Expected remote outcomes; infrastructure and cleanup failures still propagate. */
export type BootstrapResult =
  | { kind: "complete" }
  | { kind: "failed"; failures: { url: string; state: string }[] }
  | { kind: "timeout"; pending: string[] };

/**
 * Resolve this command's pending introductions and well-known authentication.
 *
 * The command is the sole OOBI/authentication worker owner for its borrowed Habery.
 * Select existing oobis/coobi/moobi and woobi/mfa rows, then include children and
 * introductions queued by processing them. Old terminal rows alone select no work.
 * Surviving coobi/mfa/moobi rows resume through their ordinary component owners.
 * A queued attempt takes precedence over any older terminal/authorization row.
 *
 * Like KERIpy init, compose Oobiery and Authenticator directly. Minimal KEL/reply
 * intake, escrow recovery and query delivery share Baser; there are no credential,
 * mailbox, delegation or Poster workers. Authentication waits for its accepted
 * controller KEL. Query recovery can use existing local signers/endpoints; absent
 * prerequisite evidence remains pending until the deadline, never successful.
 *
 * @param hby Borrowed identities/configuration/Baser; kept open through cleanup.
 * @param http Borrowed request implementation used by OOBIs, authentication and queries.
 * @param clock Borrowed clock for actual query transport deadlines.
 * @param options Finite positive elapsed deadline, default 30 seconds.
 * @returns Selected terminal success, refusal or deadline after all children/I/O join.
 * @throws Invariant, parser, storage, transport and cleanup failures propagate unchanged.
 */
export function resolveBootstrap(
  hby: Habery,
  http: HttpClient,
  clock: RuntimeClock,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Operation<BootstrapResult> {
  return call(function*() {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("Bootstrap timeout must be finite and positive");
    }
    const selected = new Set<string>();
    collectPendingUrls(hby.db, selected);
    if (selected.size === 0) return { kind: "complete" };

    const protocol = createProtocolProcessor(hby);
    const oobiery = new Oobiery(hby, protocol, protocol.rvy, http, protocol.cues);
    oobiery.registerReplyRoutes();
    const authenticator = new Authenticator(hby, http);
    const querying = yield* resource<WitnessInquisitor>(function*(provide) {
      const querying = new WitnessInquisitor(hby, protocol, http, clock);
      try {
        yield* provide(querying);
      } finally {
        yield* querying.close();
      }
    });

    return yield* race([
      call(function*(): Operation<BootstrapResult> {
        yield* spawn(() => oobiery.oobiDo());
        yield* spawn(() => authenticator.authDo());
        yield* spawn(() => protocol.escrowDo());
        yield* spawn(() => querying.deliverDo());
        while (true) {
          collectPendingUrls(hby.db, selected);
          const subjects = selectedSubjects(hby.db, selected);
          const kelPending = relevantKelEscrows(hby.db, subjects);
          const replyPending = relevantReplyEscrows(hby.db, subjects);
          // This composition exclusively consumes its own live cue Deck. Only
          // evidence-recovery queries are output: static OOBI servers need no
          // unsolicited receipt/replay publication to establish local acceptance.
          while (!protocol.cues.empty) {
            const cue = protocol.cues.pull()!;
            if (cue.kin === "query" && cue.pre && subjects.has(cue.pre)) querying.enqueueCue(cue);
          }
          const result = inspectBootstrap(hby.db, selected);
          if (result?.kind === "failed") return result;
          // Accepted prerequisites retire redundant unsigned requests too. A new
          // environment may have no signer; another OOBI can supply the same KEL.
          if (result?.kind === "complete" && !kelPending && !replyPending) return result;
          yield* runtimeTurn();
        }
      }),
      call(function*(): Operation<BootstrapResult> {
        yield* sleep(timeoutMs);
        collectPendingUrls(hby.db, selected);
        const pending = [...selected].filter(url => !bootstrapUrlComplete(hby.db, url));
        // A terminal fetch may still depend on reply proofs/query recovery.
        return { kind: "timeout", pending: pending.length ? pending : [...selected] };
      }),
    ]);
  });
}

/** Include durable queued/in-flight work and every child of a selected multi-OOBI. */
function collectPendingUrls(db: Baser, selected: Set<string>): void {
  for (const store of [db.oobis, db.coobi, db.moobi, db.woobi, db.mfa]) {
    for (const [keys] of store.getTopItemIter()) if (keys[0]) selected.add(keys[0]);
  }
  for (const url of selected) {
    const record = db.moobi.get(url) ?? db.roobi.get(url) ?? db.eoobi.get(url);
    for (const child of record?.urls ?? []) selected.add(child);
  }
}

/** Follow the selected controller/endpoint identities rather than all reply escrows. */
function selectedSubjects(db: Baser, selected: ReadonlySet<string>): Set<string> {
  const subjects = new Set<string>();
  for (const url of selected) {
    const parsed = parseOobiUrl(url);
    const record = db.oobis.get(url) ?? db.coobi.get(url) ?? db.moobi.get(url) ?? db.roobi.get(url);
    for (const pre of [record?.cid, record?.eid, parsed.cid, parsed.eid]) if (pre) subjects.add(pre);
  }
  return subjects;
}

/** Retain selected KEL evidence until its actual signature/witness/delegation/order dependencies settle. */
function relevantKelEscrows(db: Baser, subjects: Set<string>): boolean {
  let pending = false;
  for (const store of [db.pses, db.pwes, db.pdes, db.ooes]) {
    for (const [keys, , said] of store.getTopItemIter()) {
      if (!subjects.has(keys[0])) continue;
      pending = true;
      const data = db.getEvtSerder(keys[0], said)?.ked;
      if (typeof data?.di === "string") subjects.add(data.di);
      if (Array.isArray(data?.b)) for (const wit of data.b) if (typeof wit === "string") subjects.add(wit);
    }
  }
  return pending;
}

/**
 * Keep relevant reply proofs pending and admit their missing signer recovery.
 * Routes name the subject in ordinary signed attributes; ssgs supplies signer
 * dependencies even before their establishment event is available. Unrelated
 * historical reply escrows cannot determine this invocation's completion.
 */
function relevantReplyEscrows(db: Baser, subjects: Set<string>): boolean {
  let pending = false;
  for (const [, diger] of db.rpes.getTopItemIter()) {
    const reply = db.rpys.get(diger.qb64);
    const data = reply?.ked?.a;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    let subject: unknown;
    if ("cid" in data) subject = data.cid;
    else if ("eid" in data) subject = data.eid;
    else if ("i" in data) subject = data.i;
    if (typeof subject !== "string" || !subjects.has(subject)) continue;
    pending = true;
    for (const [keys] of db.ssgs.getTopItemIter([diger.qb64], { topive: true })) {
      if (keys[1]) subjects.add(keys[1]);
    }
  }
  return pending;
}

/** Require current terminal evidence; a saved authorization cannot mask a queued retry. */
function bootstrapUrlComplete(db: Baser, url: string): boolean {
  if (oobiTerminalState(db, url).status !== "resolved") return false;
  if (isWellKnownOobiUrl(url)) {
    const cid = parseOobiUrl(url).cid;
    return !!cid && !!db.getKever(cid) && hasWellKnownAuth(db, url);
  }
  const record = db.roobi.get(url);
  return !record?.cid || !!db.getKever(record.cid);
}

/** Decide only from selected URLs; absence of queue rows alone never establishes success. */
function inspectBootstrap(db: Baser, selected: ReadonlySet<string>): BootstrapResult | null {
  const failures: { url: string; state: string }[] = [];
  let pending = false;
  for (const url of selected) {
    const terminal = oobiTerminalState(db, url);
    if (terminal.status === "failed") failures.push({ url, state: terminal.record?.state ?? "failed" });
    else if (!bootstrapUrlComplete(db, url)) pending = true;
  }
  if (failures.length) return { kind: "failed", failures };
  return pending ? null : { kind: "complete" };
}
