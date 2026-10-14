/** Lazy OOBI output borrows its Hab/keeper/database; metadata capture begins only on iterator acquisition. */
import { concatBytes, ResourceLimitError } from "cesr-ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import { dgKey } from "../db/core/keys.ts";
import type { KelReplayRange } from "../db/kel-replay.ts";
import type { Hab } from "./habbing.ts";
import { loadStoredReply } from "./stored-replies.ts";

/** Configurable local preparation ceilings; native metadata/proof/key copies remain separately qualified. */
export interface OobiReplyLimits {
  maxMessageBytes?: number;
  maxProofRows?: number;
  maxDescriptors?: number;
  maxDescriptorBytes?: number;
  maxDepth?: number;
}

type Part =
  | { kind: "kel"; pre: string; ranges: readonly KelReplayRange[]; delegated: boolean }
  | { kind: "stored"; said: string }
  | { kind: "loc"; eid: string; scheme: string; url: string }
  | { kind: "auth"; eid: string; role: string };

/**
 * Capture bounded primitive descriptors, then emit finite messages in the established OOBI order.
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
  limits: OobiReplyLimits = {},
): Iterable<Uint8Array> {
  const maxMessageBytes = limits.maxMessageBytes ?? 8 * 1024 * 1024;
  const maxDescriptors = limits.maxDescriptors ?? 4096;
  const maxDescriptorBytes = limits.maxDescriptorBytes ?? maxMessageBytes;
  const maxDepth = limits.maxDepth ?? 32;
  const maxProofRows = limits.maxProofRows ?? 4096;
  for (const value of [maxMessageBytes, maxDepth]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid OOBI message/delegation limit");
  }
  for (const value of [maxDescriptors, maxDescriptorBytes, maxProofRows]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid OOBI metadata/proof limit");
  }
  if (maxDescriptorBytes > maxMessageBytes) {
    throw new RangeError("OOBI metadata exceeds response preparation allowance");
  }
  const proofLimits = { maxMessageBytes, maxProofRows };
  return {
    [Symbol.iterator]() {
      const count = eids.length;
      if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("Invalid OOBI endpoint filter length");
      if (count > maxDescriptors) throw new ResourceLimitError("OOBI endpoint filter exceeds metadata limit");
      const selected: string[] = [];
      let filterBytes = 2 * (cid.length + (role?.length ?? 0) + scheme.length);
      if (filterBytes > maxDescriptorBytes) throw new ResourceLimitError("OOBI selector exceeds metadata byte limit");
      for (let index = 0; index < count; index++) {
        const eid = eids[index];
        if (typeof eid !== "string") throw new TypeError("OOBI endpoint filter must contain strings");
        filterBytes += 2 * eid.length;
        if (filterBytes > maxDescriptorBytes) throw new ResourceLimitError("OOBI endpoint filter exceeds byte limit");
        selected.push(eid);
      }
      return (function*() {
        const parts: Part[] = [], cloned = new Set<string>();
        let nodes = 0, metadataBytes = filterBytes;
        const inspect = () => {
          if (++nodes > maxDescriptors) throw new ResourceLimitError("OOBI descriptor/work limit exceeded");
        };
        const add = (part: Part, fields: readonly string[], containers = 1) => {
          inspect();
          const bytes = 64 * containers + fields.reduce((sum, field) => sum + 2 * field.length, 0);
          if (bytes > maxDescriptorBytes - metadataBytes) {
            throw new ResourceLimitError("OOBI descriptor byte limit exceeded");
          }
          metadataBytes += bytes;
          parts.push(part);
        };
        const clone = (pre: string) => {
          if (!pre || cloned.has(pre)) return;
          const kever = hab.db.getKever(pre);
          const delegated = kever?.delegated ?? false;
          if (delegated && !hab.db.aess.get(dgKey(pre, kever!.lastEst.d || kever!.said))) return;
          inspect();
          const depth = Math.min(maxDepth, maxDescriptors - nodes);
          if (depth < 1) throw new ResourceLimitError("OOBI replay metadata limit exceeded");
          const captured = hab.db.replay(pre, 0, { maxDepth: depth, maxMessageBytes });
          if (!captured) return;
          const ranges = [
            ...captured.ranges.filter(([aid]) => aid !== pre),
            ...captured.ranges.filter(([aid]) => aid === pre),
          ];
          for (const [aid] of ranges) inspect();
          add({ kind: "kel", pre, ranges, delegated }, ranges.map(([aid]) => aid), 1 + ranges.length);
          cloned.add(pre);
        };
        const locations = (eid: string, fresh: boolean) => {
          const keys = scheme ? [eid, scheme] : [eid];
          if (fresh) {
            for (const [path, loc] of hab.db.locs.getTopItemIter(keys, { topive: !scheme })) {
              inspect();
              if (!path[1] || !loc.url) continue;
              if (typeof loc.url !== "string") throw new DatabaseOperationError("Corrupt OOBI location URL");
              add({ kind: "loc", eid, scheme: path[1], url: loc.url }, [eid, path[1], loc.url]);
            }
          } else {
            for (const [, said] of hab.db.lans.getTopItemIter(keys, { topive: !scheme })) {
              inspect();
              add({ kind: "stored", said: said.qb64 }, [said.qb64]);
            }
          }
        };
        try {
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
              inspect();
              if (selected.length && !selected.includes(eid)) continue;
              clone(eid);
              locations(eid, eid === hab.pre);
              if (cid === hab.pre) add({ kind: "auth", eid, role: Roles.witness }, [eid, Roles.witness]);
            }
          }
          for (const [keys, end] of hab.db.ends.getTopItemIter([cid], { topive: true })) {
            inspect();
            const currentRole = keys[1], eid = keys[2];
            if (
              !currentRole || !eid || !(end.allowed || end.enabled) || (role && currentRole !== role)
              || (selected.length && !selected.includes(eid))
            ) continue;
            clone(eid);
            locations(eid, false);
            const said = hab.db.eans.get([cid, currentRole, eid]);
            if (said) add({ kind: "stored", said: said.qb64 }, [said.qb64]);
          }
          // Metadata cursors have all closed before any event/body preparation or yield.
          for (const part of parts) {
            if (part.kind === "kel") {
              let chainContent = false;
              for (const range of part.ranges) {
                if (range[0] === part.pre && part.delegated && !chainContent) break;
                for (const bytes of hab.db.replayRange(range, maxMessageBytes)) {
                  if (range[0] !== part.pre) chainContent = true;
                  yield bytes;
                }
              }
              if (requireReady && part.pre === cid && part.delegated && !chainContent) return;
            } else if (part.kind === "stored") {
              yield loadStoredReply(hab.db, part.said, proofLimits);
            } else {
              const fields = part.kind === "loc"
                ? [hab.pre, part.eid, part.scheme, part.url]
                : [hab.pre, part.eid, part.role];
              const signers = hab.kever?.verfers.length ?? 0;
              // Conservative flat-field JSON escaping + bounded signature/framing allowance, before construction.
              const preparation = 512 + 256 * signers + fields.reduce((sum, field) => sum + 6 * field.length, 0);
              if (signers > maxProofRows || preparation > maxMessageBytes) {
                throw new ResourceLimitError("Fresh OOBI reply exceeds preparation allowance");
              }
              yield part.kind === "loc"
                ? hab.makeLocScheme(part.url, part.eid, part.scheme)
                : hab.makeEndRole(part.eid, part.role, true);
            }
          }
        } finally {
          parts.length = 0;
          cloned.clear();
        }
      })();
    },
  };
}

/** Collect only explicitly finite caller output, admitting each message before retaining its bytes. */
export function collectOobiReplies(messages: Iterable<Uint8Array>, maxBytes = 8 * 1024 * 1024): Uint8Array {
  const parts: Uint8Array[] = [];
  let size = 0;
  for (const bytes of messages) {
    if (bytes.length > maxBytes - size) throw new ResourceLimitError("Finite OOBI reply exceeds byte limit");
    size += bytes.length;
    parts.push(bytes);
  }
  return concatBytes(...parts);
}
