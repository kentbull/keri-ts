/**
 * Tufa composition/presentation for the KERIpy-style query workflows.
 *
 * Call the library query workflows (`keri-ts/runtime`), which run a concrete
 * state/anchor wait alongside ordinary runtime workers and independent reply
 * intake. One ten-second elapsed deadline covers the query;
 * timeout is command failure, not permission to print stale state as success.
 * Capture the accepted-state display while Baser is open, join workers and close
 * owned resources, then print it. KERI's query library has no CLI formatting or
 * hidden OOBI recovery path; prerequisite discovery is a separate operation.
 */
import { SealEvent } from "cesr-ts";
import type { Operation } from "effection";
import { parseBooleanOption, parseStringOption } from "keri-ts/cli";
import { dgKey } from "keri-ts/db";
import { type Habery, queryAnchor, queryKeyState, requireQueryRequester, ValidationError } from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";

/** Validate the exact event-seal shape before opening stores or starting workers. */
function loadAnchor(path: string): ReturnType<typeof SealEvent.toSad> {
  const anchor: unknown = JSON.parse(Deno.readTextFileSync(path));
  if (!SealEvent.isSad(anchor)) {
    throw new ValidationError("Anchor file must contain only string i, s and d event-seal fields.");
  }
  SealEvent.fromSad(anchor);
  return anchor;
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

/**
 * Query current key state, or an exact event seal from --anchor, for --prefix.
 * --alias selects a member/single-controller requester, not an uncoordinated
 * group contribution; it is not the queried subject. Wire the
 * command-owned cue Deck before workers can emit a reply, and return final display
 * only after the shared resource owner closes. A close failure therefore prevents
 * final success output even if the accepted-state predicate already passed.
 *
 * @param args Commander-mapped command values; required name/alias/prefix and
 * anchor syntax are checked before opening stores.
 * @throws Invalid input, unmet deadline, worker/processing and cleanup failures
 * propagate to the CLI's normal nonzero-exit handling.
 */
export function* queryCommand(args: Record<string, unknown>): Operation<void> {
  const name = parseStringOption(args.name, "name");
  const alias = parseStringOption(args.alias, "alias");
  const prefix = parseStringOption(args.prefix, "prefix");
  if (!name) throw new ValidationError("Name is required and cannot be empty");
  if (!alias) throw new ValidationError("Alias is required and cannot be empty");
  if (!prefix) throw new ValidationError("Prefix is required and cannot be empty");
  const anchorPath = parseStringOption(args.anchor, "anchor");
  const compat = parseBooleanOption(args.compat, "compat");
  const base = parseStringOption(args.base, "base");
  const headDirPath = parseStringOption(args.headDirPath, "headDirPath");
  const passcode = parseStringOption(args.passcode, "passcode");
  if (anchorPath === "") throw new ValidationError("Anchor path cannot be empty");
  const anchor = anchorPath === undefined ? undefined : loadAnchor(anchorPath);
  const lines = yield* withHabAndAgentRuntime(
    {
      name,
      base,
      headDirPath,
      passcode,
      compat,
    },
    alias,
    { compat: compat ?? false, readonly: false, skipConfig: true, skipSignator: true },
    function*({ hby, runtime, hab }) {
      requireQueryRequester(hby, hab);
      console.log(anchor ? `Checking for anchor ${JSON.stringify(anchor)}...` : "Checking for updates...");
      const outcome = yield* (anchor
        ? queryAnchor(runtime, { hab, prefix, anchor })
        : queryKeyState(runtime, { hab, prefix }));
      if (outcome.status === "timed-out") {
        throw new ValidationError(`Query timed out before accepted evidence satisfied ${prefix}.`);
      }
      return externalStateLines(hby, prefix);
    },
  );
  for (const line of lines) console.log(line);
}
