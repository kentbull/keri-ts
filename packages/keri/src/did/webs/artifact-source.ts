/** Guarded DID artifact capture; the existing reply owner funds demand-driven message reconstruction. */
import {
  Diger,
  Ilks,
  NumberPrimitive,
  Prefixer,
  ResourceAdmissionError,
  ResourceLimitError,
  SerderKERI,
} from "cesr-ts";
import type { ResourceReservation } from "cesr-ts";
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import { loadStoredReply } from "../../app/stored-replies.ts";
import { attachmentCounterQb64b, resolveAttachmentGvrsn } from "../../core/attachment-countering.ts";
import { DatabaseOperationError, ValidationError } from "../../core/errors.ts";
import { Roles } from "../../core/roles.ts";
import { dgKey } from "../../db/core/keys.ts";
import { CapturedKelReplay } from "../../db/kel-replay.ts";
import { Reger } from "../../db/reger.ts";
import type { CapturedTelReplay } from "../../db/tel-replay.ts";
import { serializeCredential } from "../../vdr/credentialing.ts";
import { Tevery } from "../../vdr/eventing.ts";
import {
  aliasCredentialByteFloor,
  type AliasIdLimits,
  CapturedAliasIds,
  consumeAliasCredential,
} from "./alias-credentials.ts";

/** Finite local capture work/metadata policies, independent of protocol validity. */
export interface DidArtifactLimits extends AliasIdLimits {
  maxDescriptors?: number;
  maxDescriptorBytes?: number;
  maxDepth?: number;
}

type Part =
  | { kind: "kel"; replay: CapturedKelReplay }
  | { kind: "reply"; said: string; table: "lans" | "eans"; keys: readonly string[] }
  | {
    kind: "credential";
    said: string;
    registry: string;
    prefix: string;
    ordinal: string;
    digest: string;
    management: CapturedTelReplay | null;
    transactions: CapturedTelReplay;
  };

/** A known accepted winner replaced captured material; retry requires a new caller-owned capture. */
export class DidArtifactStateChangedError extends Error {
  readonly kind = "changed";
  constructor(said: string) {
    super(`Captured DID endpoint reply ${said} was replaced during output`);
    this.name = "DidArtifactStateChangedError";
  }
}

/** One private metadata owner; release must follow iterator closure, including an unpulled response. */
class DidArtifactSource implements Iterable<Uint8Array> {
  private parts: readonly Part[] = [];
  private credit?: ResourceReservation;
  private acquired = false;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly aid: string,
    private readonly limits: DidArtifactLimits,
    private readonly maxDescriptors: number,
    private readonly maxDescriptorBytes: number,
    private readonly maxDepth: number,
  ) {}

  /** Called under Reactor.settle's consume guard after ReplyStreams reserves output credit. */
  [Symbol.iterator](): Iterator<Uint8Array> {
    if (this.acquired) throw new Error("DID artifact source is single-use");
    this.acquired = true;
    const runtime = this.runtime, db = runtime.hby.db, maxBytes = runtime.replyStreams.messageByteLimit;
    const decision = runtime.resources.reserve({ bytes: 4 * this.maxDescriptorBytes + 128 * this.maxDescriptors });
    if (decision.kind === "refuse") {
      throw new ResourceAdmissionError(`DID metadata admission refused: ${decision.reason}`, decision.reason);
    }
    this.credit = decision.reservation;
    const parts: Part[] = [];
    let work = 0, retained = 0;
    const inspect = () => {
      if (++work > this.maxDescriptors) throw new ResourceLimitError("DID artifact capture work limit exceeded");
    };
    const admit = (fields: readonly string[], containers = 1) => {
      inspect();
      const size = 128 * containers + fields.reduce((n, value) => n + 2 * value.length, 0);
      if (size > this.maxDescriptorBytes - retained) {
        throw new ResourceLimitError("DID artifact metadata limit exceeded");
      }
      retained += size;
      return size;
    };
    const reply = (said: string, table: "lans" | "eans", keys: readonly string[]) => {
      admit([said, ...keys], 2);
      parts.push(Object.freeze({ kind: "reply", said, table, keys: Object.freeze([...keys]) }));
    };
    const locations = (eid: string) => {
      for (const [keys, said] of db.lans.getTopItemIter([eid], { topive: true })) {
        inspect();
        reply(said.qb64, "lans", keys);
      }
    };
    const authorization = (cid: string, eid: string, role: string) => {
      const end = db.ends.get([cid, role, eid]);
      if (!(end?.allowed || end?.enabled)) return;
      const said = db.eans.get([cid, role, eid]);
      if (said) reply(said.qb64, "eans", [cid, role, eid]);
    };
    try {
      if (!runtime.hby.habs.has(this.aid)) throw new ValidationError(`No local AID found for ${this.aid}.`);
      const target = db.getKever(this.aid, { refresh: true });
      if (!target) throw new ValidationError(`No accepted key state for ${this.aid}.`);
      const depth = Math.min(
        this.maxDepth,
        this.maxDescriptors,
        Math.max(1, Math.floor(this.maxDescriptorBytes / 256)),
      );
      const kel = db.replay(this.aid, 0, { maxDepth: depth, maxMessageBytes: maxBytes });
      if (kel) {
        admit(kel.ranges.map(([pre]) => pre), 1 + kel.ranges.length);
        // Baser replay is target-first; artifacts have always emitted oldest delegator through target.
        const ranges = [
          ...kel.ranges.filter(([pre]) => pre !== this.aid),
          ...kel.ranges.filter(([pre]) => pre === this.aid),
        ];
        parts.push(Object.freeze({ kind: "kel", replay: new CapturedKelReplay(db, ranges, maxBytes) }));
      }
      for (const eid of target.wits) {
        inspect();
        locations(eid);
        authorization(eid, eid, Roles.controller);
      }
      for (const role of [Roles.agent, Roles.mailbox]) {
        for (const [keys, end] of db.ends.getTopItemIter([this.aid, role], { topive: true })) {
          inspect();
          const eid = keys[2];
          if (!eid || !(end.allowed || end.enabled)) continue;
          locations(eid);
          authorization(this.aid, eid, role);
        }
      }
      const reger = runtime.vdr.reger as Reger | null, tvy = runtime.vdr.tvy;
      if (reger instanceof Reger) {
        if (!(tvy instanceof Tevery)) throw new ValidationError("VDR runtime did not open Tevery.");
        const ids = CapturedAliasIds.capture(runtime, this.aid, this.limits);
        try {
          for (const said of ids) {
            inspect();
            let candidate: { registry: string; prefix: string; ordinal: string; digest: string } | undefined;
            let candidateBytes = 0;
            consumeAliasCredential(runtime, said, ([creder, prefix, ordinal, digest]) => {
              const registry = creder.regid;
              if (!registry || !tvy.tevers.has(registry)) return;
              if (creder.said !== said) throw new DatabaseOperationError("Corrupt indexed credential identity");
              const fields = [said, registry, prefix.qb64, ordinal.qb64, digest.qb64];
              candidateBytes = admit(fields);
              candidate = Object.freeze({ registry, prefix: fields[2], ordinal: fields[3], digest: fields[4] });
            }, maxBytes);
            if (!candidate) continue;
            // No creder survives into tail decoding: its temporary copy credit has already returned.
            const transactions = reger.replay(said, { maxMessageBytes: maxBytes });
            if (!transactions || !activeTail(reger, said, transactions, maxBytes)) {
              retained -= candidateBytes;
              continue;
            }
            const management = reger.replay(candidate.registry, { maxMessageBytes: maxBytes });
            admit([], transactions.ranges.length + (management?.ranges.length ?? 0));
            parts.push(Object.freeze({ kind: "credential", said, ...candidate, management, transactions }));
          }
        } finally {
          ids.release();
        }
      }
      this.parts = Object.freeze(parts);
      return this.messages();
    } catch (error) {
      parts.length = 0;
      this.release();
      throw error;
    }
  }

  /** Each replay reader closes its cursor before yielding; selected reply bodies use captured winning SAIDs. */
  private *messages(): Generator<Uint8Array> {
    const runtime = this.runtime, maxBytes = runtime.replyStreams.messageByteLimit;
    for (const part of this.parts) {
      if (part.kind === "kel") yield* part.replay;
      else if (part.kind === "reply") {
        const bytes = loadStoredReply(runtime.hby.db, part.said, { maxMessageBytes: maxBytes });
        if (!bytes.length) {
          const winner = runtime.hby.db[part.table].get(part.keys);
          if (winner && winner.qb64 !== part.said) throw new DidArtifactStateChangedError(part.said);
          throw new DatabaseOperationError("Missing captured DID endpoint body without replacement provenance");
        }
        yield bytes;
      } else {
        if (part.management) yield* part.management;
        yield* part.transactions;
        let bytes: Uint8Array | undefined;
        consumeAliasCredential(runtime, part.said, ([creder]) => {
          if (creder.said !== part.said || creder.regid !== part.registry) {
            throw new DatabaseOperationError("Captured credential changed");
          }
          const prefix = new Prefixer({ qb64: part.prefix }), ordinal = new NumberPrimitive({ qb64: part.ordinal });
          const digest = new Diger({ qb64: part.digest }), genus = resolveAttachmentGvrsn(creder);
          const sealBytes = prefix.fullSize + (genus.major === 1 ? 24 : ordinal.fullSize) + digest.fullSize;
          const counter = attachmentCounterQb64b("SealSourceTriples", genus.major >= 2 ? sealBytes / 4 : 1, genus);
          if (creder.raw.length + sealBytes + counter.length > maxBytes) {
            throw new ResourceLimitError("DID credential exceeds wire ceiling");
          }
          bytes = serializeCredential(creder, prefix, ordinal, digest);
        }, maxBytes);
        yield bytes!;
      }
    }
  }

  /** Existing reply disposer calls this after source.return(), including cancellation before first pull. */
  release(): void {
    this.parts = [];
    this.credit?.release();
    this.credit = undefined;
  }
}

/** Validate the accepted credential tail without vcState's whole-TEL digest collection. */
function activeTail(reger: Reger, said: string, captured: CapturedTelReplay, maxBytes: number): boolean {
  const end = captured.ranges[0][1], digest = reger.tels.getOn(said, end);
  if (!digest) throw new DatabaseOperationError("Missing captured credential TEL tail");
  const raw = reger.getValBounded(reger.tvts.sdb, dgKey(said, digest.qb64), maxBytes);
  if (!raw) throw new ValidationError(`Missing credential TEL event ${said}.${digest.qb64}.`);
  const event = new SerderKERI({ raw });
  if (event.pre !== said || event.said !== digest.qb64 || event.sn !== end) {
    throw new DatabaseOperationError("Corrupt credential TEL tail identity");
  }
  const anchor = reger.ancs.getBounded(dgKey(said, digest.qb64), 512);
  if (!anchor) throw new ValidationError(`Missing credential TEL anchor ${said}.${digest.qb64}.`);
  if (anchor.length !== 2) throw new DatabaseOperationError("Corrupt credential TEL anchor tuple");
  if ((event.ilk === Ilks.iss || event.ilk === Ilks.bis) && end === 0) return true;
  if ((event.ilk === Ilks.rev || event.ilk === Ilks.brv) && end === 1) return false;
  throw new DatabaseOperationError("Corrupt accepted credential TEL lifecycle");
}

/** Internal caller must open inside Reactor.settle's consume callback; acquisition captures under its guard. */
export function openDidArtifactCesr(
  runtime: AgentRuntime,
  aid: string,
  limits: DidArtifactLimits = {},
): ReadableStream<Uint8Array> {
  const { maxDescriptors = 4096, maxDescriptorBytes = 64 * 1024, maxDepth = 32, maxIds, maxMetadataBytes, maxIdBytes } =
    limits;
  const charge = 4 * maxDescriptorBytes + 128 * maxDescriptors;
  for (const limit of [maxDescriptors, maxDescriptorBytes, maxDepth, charge]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid DID artifact capture limit");
  }
  if (typeof aid !== "string" || !aid) throw new RangeError("Invalid DID artifact AID");
  if (2 * aid.length > maxDescriptorBytes) throw new ResourceLimitError("DID artifact AID exceeds metadata limit");
  const ids = { maxIds, maxMetadataBytes, maxIdBytes };
  const floor = runtime.replyStreams.preparationByteFloor + charge + CapturedAliasIds.byteFloor(ids)
    + aliasCredentialByteFloor(runtime.replyStreams.messageByteLimit);
  if (!Number.isSafeInteger(floor)) throw new RangeError("DID artifact floor exceeds supported range");
  if (floor > runtime.resources.limits.bytes) {
    throw new ResourceAdmissionError("DID artifact configured byte floor cannot fit", "limit");
  }
  const source = new DidArtifactSource(runtime, aid, ids, maxDescriptors, maxDescriptorBytes, maxDepth);
  return runtime.replyStreams.open(source, () => source.release());
}
