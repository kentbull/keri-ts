/** Lazy OOBI output borrows its Hab/keeper/database; metadata capture begins only on iterator acquisition. */
import { DatabaseOperationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import { dgKey } from "../db/core/keys.ts";
import type { KelReplayRange } from "../db/kel-replay.ts";
import type { Hab } from "./habbing.ts";
import { loadStoredReply } from "./stored-replies.ts";

type Part =
  | { kind: "kel"; pre: string; ranges: readonly KelReplayRange[]; delegated: boolean }
  | { kind: "stored"; said: string }
  | { kind: "loc"; eid: string; scheme: string; url: string }
  | { kind: "auth"; eid: string; role: string };

/**
 * Capture primitive descriptors, then emit finite messages in the established OOBI order.
 * Selector inputs are borrowed and must stay immutable until acquisition under the caller's owner.
 * Captured identities stop at FEL horizons; proofs/signing keys remain consumption-time state.
 */
export function oobiReplyMessages(
  hab: Hab,
  cid: string,
  role: string | undefined,
  eids: readonly string[],
  scheme: string,
  requireReady: boolean,
): Iterable<Uint8Array> {
  return {
    [Symbol.iterator]() {
      const count = eids.length;
      const selected: string[] = [];
      for (let index = 0; index < count; index++) selected.push(eids[index]);
      return (function*() {
        const parts: Part[] = [], cloned = new Set<string>();
        const clone = (pre: string) => {
          if (!pre || cloned.has(pre)) return;
          const kever = hab.db.getKever(pre);
          const delegated = kever?.delegated ?? false;
          if (delegated && !hab.db.aess.get(dgKey(pre, kever!.lastEst.d || kever!.said))) return;
          const captured = hab.db.replay(pre);
          if (!captured) return;
          const ranges = [
            ...captured.ranges.filter(([aid]) => aid !== pre),
            ...captured.ranges.filter(([aid]) => aid === pre),
          ];
          parts.push({ kind: "kel", pre, ranges, delegated });
          cloned.add(pre);
        };
        const locations = (eid: string, fresh: boolean) => {
          const keys = scheme ? [eid, scheme] : [eid];
          if (fresh) {
            for (const [path, loc] of hab.db.locs.getTopItemIter(keys, { topive: !scheme })) {
              if (!path[1] || !loc.url) continue;
              if (typeof loc.url !== "string") throw new DatabaseOperationError("Corrupt OOBI location URL");
              parts.push({ kind: "loc", eid, scheme: path[1], url: loc.url });
            }
          } else {
            for (const [, said] of hab.db.lans.getTopItemIter(keys, { topive: !scheme })) {
              parts.push({ kind: "stored", said: said.qb64 });
            }
          }
        };
        const target = hab.db.getKever(cid);
        if (requireReady && target?.delegated && !hab.db.aess.get(dgKey(cid, target.lastEst.d || target.said))) {
          return;
        }
        clone(cid);
        if (requireReady && target?.delegated && !parts.some((part) => part.kind === "kel" && part.pre === cid)) {
          return;
        }
        if (role === Roles.witness) {
          for (const eid of target?.wits ?? []) {
            if (selected.length && !selected.includes(eid)) continue;
            clone(eid);
            locations(eid, eid === hab.pre);
            if (cid === hab.pre) parts.push({ kind: "auth", eid, role: Roles.witness });
          }
        }
        for (const [keys, end] of hab.db.ends.getTopItemIter([cid], { topive: true })) {
          const currentRole = keys[1], eid = keys[2];
          if (
            !currentRole || !eid || !(end.allowed || end.enabled) || (role && currentRole !== role)
            || (selected.length && !selected.includes(eid))
          ) continue;
          clone(eid);
          locations(eid, false);
          const said = hab.db.eans.get([cid, currentRole, eid]);
          if (said) parts.push({ kind: "stored", said: said.qb64 });
        }
        // Metadata cursors have all closed before any event/body preparation or yield.
        for (const part of parts) {
          if (part.kind === "kel") {
            let chainContent = false;
            for (const range of part.ranges) {
              if (range[0] === part.pre && part.delegated && !chainContent) break;
              for (const bytes of hab.db.replayRange(range)) {
                if (range[0] !== part.pre) chainContent = true;
                yield bytes;
              }
            }
            if (requireReady && part.pre === cid && part.delegated && !chainContent) return;
          } else if (part.kind === "stored") {
            yield loadStoredReply(hab.db, part.said);
          } else {
            yield part.kind === "loc"
              ? hab.makeLocScheme(part.url, part.eid, part.scheme)
              : hab.makeEndRole(part.eid, part.role, true);
          }
        }
      })();
    },
  };
}
