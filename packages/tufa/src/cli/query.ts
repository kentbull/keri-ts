/** Query command composition and presentation; protocol workflows return only after accepted-state completion. */
import { SealEvent } from "cesr-ts";
import { call, type Operation, race, sleep, spawn, type Task } from "effection";
import { dgKey } from "keri-ts/db";
import {
  AnchorQuerier,
  type Hab,
  type Habery,
  KeyStateNoticer,
  preferredUrl,
  Roles,
  runAgentRuntime,
  ValidationError,
} from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "./support/context.ts";

/** Preserve the existing primary/fallback windows until the direct-HTTP behavior cut. */
const QueryTimeoutMs = 10_000;

/** Validate the exact event-seal shape before opening stores or starting workers. */
function loadAnchor(path: string): ReturnType<typeof SealEvent.toSad> {
  const anchor: unknown = JSON.parse(Deno.readTextFileSync(path));
  if (!SealEvent.isSad(anchor)) {
    throw new ValidationError("Anchor file must contain only string i, s and d event-seal fields.");
  }
  SealEvent.fromSad(anchor);
  return anchor;
}

/** Observe a running concrete workflow without cancelling it when this observation times out. */
function queryCompletedWithin(query: Task<void>, ms: number): Operation<boolean> {
  return race([
    call(function*() {
      yield* query;
      return true;
    }),
    call(function*() {
      yield* sleep(ms);
      return false;
    }),
  ]);
}

/** Existing controller-OOBI fallback; removed with direct HTTP query behavior in the next behavior cut. */
function controllerCatchupUrl(hab: Hab, pre: string): string | null {
  const ends = hab.endsFor(pre);
  for (const role of [Roles.controller, Roles.agent]) {
    for (const locations of Object.values(ends[role] ?? {})) {
      const selected = preferredUrl(locations);
      if (!selected) continue;
      const url = new URL(selected);
      url.pathname = `/oobi/${pre}/controller`;
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  }
  return null;
}

/** Capture the KLI-style accepted-state display while the database is open. */
function externalStateLines(hby: Habery, pre: string): string[] {
  const kever = hby.db.getKever(pre);
  if (!kever) throw new ValidationError(`No known key state for prefix ${pre}.`);
  const estSaid = kever.lastEst.d || kever.said;
  const receipts = estSaid ? hby.db.wigs.get(dgKey(pre, estSaid)).length : 0;
  const lines = ["", `Identifier: ${pre}`, `Seq No:\t${kever.sner.num.toString()}`];
  if (kever.delegated) lines.push("Delegated Identifier", `    Delegator:  ${kever.delpre ?? ""}`, "");
  lines.push(
    "",
    "Witnesses:",
    `Count:\t\t${kever.wits.length}`,
    `Receipts:\t${receipts}`,
    `Threshold:\t${kever.toader.num.toString()}`,
    "",
    "Public Keys:\t",
    ...kever.verfers.map((key, index) => `\t${index + 1}. ${key.qb64}`),
    "",
  );
  return lines;
}

/** Compose reception and a concrete query workflow, join workers, then display the captured local view. */
export function* queryCommand(args: Record<string, unknown>): Operation<void> {
  const name = args.name as string | undefined;
  const alias = args.alias as string | undefined;
  const prefix = args.prefix as string | undefined;
  if (!name) throw new ValidationError("Name is required and cannot be empty");
  if (!alias) throw new ValidationError("Alias is required and cannot be empty");
  if (!prefix) throw new ValidationError("Prefix is required and cannot be empty");
  const anchor = args.anchor ? loadAnchor(args.anchor as string) : undefined;
  const lines = yield* withHabAndAgentRuntime(
    {
      name,
      base: args.base as string | undefined,
      headDirPath: args.headDirPath as string | undefined,
      passcode: args.passcode as string | undefined,
      compat: args.compat as boolean | undefined,
    },
    alias,
    { compat: args.compat as boolean ?? false, readonly: false, skipConfig: true, skipSignator: true },
    function*({ hby, runtime, hab }) {
      const workflow = anchor
        ? new AnchorQuerier(hby.db, runtime.querying, prefix, anchor, { signer: hab.pre })
        : new KeyStateNoticer(hby.db, runtime.querying, prefix, runtime.keyStateUpdates, { signer: hab.pre });
      console.log(anchor ? `Checking for anchor ${JSON.stringify(anchor)}...` : "Checking for updates...");
      const observing = yield* spawn(() => workflow.queryDo());
      const worker = yield* spawn(() => runAgentRuntime(runtime, { hab }));
      try {
        const complete = yield* queryCompletedWithin(observing, QueryTimeoutMs);
        if (!complete && !anchor) {
          const url = controllerCatchupUrl(hab, prefix);
          if (url) {
            runtime.oobiery.resolve(url);
            yield* queryCompletedWithin(observing, 5_000);
          }
        }
      } finally {
        yield* observing.halt();
        yield* worker.halt();
      }
      return externalStateLines(hby, prefix);
    },
  );
  for (const line of lines) console.log(line);
}
