/** Collect accepted historical witness receipts and fan them out before reporting event completion. */
import {
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  Ilks,
  parseBytes,
  type Siger,
  type Versionage,
  Vrsn_1_0,
} from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import type { Kevery } from "../../core/kel/eventing.ts";
import { receipt as receiptEvent } from "../../core/protocol-eventing.ts";
import { messagize } from "../../core/protocol-serialization.ts";
import { dgKey } from "../../db/core/keys.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "../identity/habbing.ts";
import { type ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { chunkBytes } from "../transport/byte-source.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { processMessages } from "../transport/message-source.ts";
import {
  getWitnessReceiptEndpoint,
  pollWitnessReceipt,
  postWitnessReceiptEndpoint,
  sendWitnessMessage,
  witnessHttpUrl,
  witnessTcpUrl,
} from "./receipt-client.ts";
import { buildDetachedReceiptMessage } from "./receipt-messages.ts";

/** Supported witness-auth payloads keyed by witness AID. */
export type WitnessAuthMap = Record<string, string>;

/** Result of one full witness receipt orchestration pass. */
export interface WitnessReceiptRunResult {
  readonly witnesses: readonly string[];
  readonly statuses: Readonly<Record<string, number>>;
}

/** Build one `loc/scheme` replay bundle for witness introductions. */
function* witnessSchemeReplies(
  hab: Hab,
  eids: readonly string[],
  gvrsn: Versionage,
): Operation<Uint8Array> {
  const replies = eids
    .map((eid) => hab.loadLocScheme(eid))
    .filter((msg) => msg.length > 0);
  const raw = concatBytes(...replies);
  if (!raw.length || gvrsn.major === 1) return raw;
  const messages = yield* call(() =>
    Promise.all(parseBytes(raw).map(frame => collectPayload(framePayload(frame, { gvrsn }))))
  );
  return concatBytes(...messages);
}

/**
 * Controller-side synchronous witness receipt orchestration.
 *
 * Responsibilities:
 * - publish through HTTP receipt endpoints (generic submission opts into TCP reply intake)
 * - catch up newly added witnesses before receipting
 * - persist returned receipts locally through the protocol processor
 * - fan witness receipts out to the complementary witnesses
 */
export class Receiptor {
  /** Borrowed accepted state and local signer collection. */
  readonly hby: Habery;
  /** Shared receipt verification, cue publication and escrow processing. */
  readonly protocol: ProtocolProcessor;
  /** Input-owned Kevery (kvy) for request-owned receipt GET/POST evidence. */
  private readonly kvy: Kevery;
  /** Borrowed HTTP and clock services used by actual receipt operations. */
  readonly http: HttpClient;
  /** Borrowed clock for this owner's actual network deadlines. */
  readonly clock: RuntimeClock;
  /** Explicit attachment framing for the configured witness endpoints; independent of KEL body version. */
  readonly gvrsn: Versionage;

  /**
   * Bind configured intake over the same Habery; acquire no stores or background workers.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param protocol Borrowed same-database protocol owner for receipt intake.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
   * @param options Explicit witness attachment genus; the historical v1 default is independent of KEL body version.
   */
  constructor(
    hby: Habery,
    protocol: ProtocolProcessor,
    http: HttpClient,
    clock: RuntimeClock,
    { gvrsn = Vrsn_1_0 }: { gvrsn?: Versionage } = {},
  ) {
    const kvy = protocol.makeKevery();
    if (kvy.db !== hby.db) throw new RangeError("Receiptor protocol must use the same database");
    this.hby = hby;
    this.protocol = protocol;
    this.kvy = kvy;
    this.http = http;
    this.clock = clock;
    this.gvrsn = gvrsn;
  }
  /** Submit the latest or specified event to all witnesses and gather receipts. */
  *receipt(pre: string, { sn, auths = {}, allowTcp = false }: {
    sn?: number;
    auths?: WitnessAuthMap;
    /** Generic WitnessReceiptor permits TCP; explicit receipt endpoints remain HTTP-only. */
    allowTcp?: boolean;
  } = {}): Operation<WitnessReceiptRunResult> {
    return yield* call(() => this.receiptOnce(pre, { sn, auths }, allowTcp));
  }
  /**
   * One scoped attempt joins actual receipt HTTP/TCP work before returning.
   *
   * @param pre Local event subject AID.
   * @param options Optional event sequence and witness Authorization map.
   * @param allowTcp Whether missing HTTP receipt routes may use TCP message delivery.
   * @returns Receipt-attempt result based on verified local witness proof.
   */
  private *receiptOnce(pre: string, { sn, auths }: {
    sn?: number;
    auths: WitnessAuthMap;
  }, allowTcp: boolean): Operation<WitnessReceiptRunResult> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${pre}.`);
    }
    const eventSn = sn ?? kever.sn;
    const { serder, message } = acceptedEventReplayMessage(
      this.hby,
      pre,
      eventSn,
      this.gvrsn,
    );
    const witnesses = this.hby.db.acceptedEventWitnesses(serder)!;
    if (witnesses.length === 0) {
      return { witnesses: [], statuses: {} };
    }

    if (serder.ilk === Ilks.rot || serder.ilk === Ilks.drt) {
      for (const witness of serder.adds) {
        yield* this.catchup(pre, witness);
      }
    }
    const receiptGroups = new Map<string, readonly Siger[]>();
    const statuses: Record<string, number> = {};
    const said = serder.said;
    if (!said) {
      throw new ValidationError(
        "Local event must expose a SAID before witness receipting.",
      );
    }

    for (const witness of witnesses) {
      if (kever.delegated) {
        for (const dmsg of this.hby.db.cloneDelegation(kever, this.gvrsn)) {
          yield* sendWitnessMessage(hab, witness, this.selected(dmsg), this.http, this.clock, this.protocol);
        }
      }

      if (allowTcp && !witnessHttpUrl(hab, witness) && witnessTcpUrl(hab, witness)) {
        yield* sendWitnessMessage(hab, witness, this.selected(message), this.http, this.clock, this.protocol);
        statuses[witness] = 200;
      } else {
        // A single receipt attempt owns its response until parsing and collection finish.
        let response = yield* call(() =>
          postWitnessReceiptEndpoint(
            hab,
            witness,
            message,
            this.http,
            auths[witness],
            this.gvrsn,
          )
        );
        if (response.kind === "escrow") {
          response = yield* pollWitnessReceipt(
            hab,
            witness,
            pre,
            eventSn,
            said,
            this.http,
            this.gvrsn,
          );
        }
        statuses[witness] = response.status;
        if (response.kind !== "accepted") {
          const detail = response.kind === "reject" ? response.message : "receipt remained escrowed";
          throw new ValidationError(
            `Witness ${witness} failed to receipt ${pre}:${eventSn.toString(16)}: ${detail}`,
          );
        }
        yield* processMessages((signal) => chunkBytes(response.body, { signal }), this.protocol, this.kvy, {
          local: false,
        });
        yield* this.protocol.processEscrowsOnce();
      }
      // HTTP status and socket drain are transport facts; only accepted witness proof counts.
      const index = witnesses.indexOf(witness);
      const wigers = this.hby.db.wigs.get(dgKey(pre, said)).filter((siger) => siger.index === index);
      if (wigers.length === 0) {
        throw new ValidationError(`Witness ${witness} did not receipt ${pre}:${eventSn.toString(16)}.`);
      }
      receiptGroups.set(witness, wigers);
    }

    for (const witness of witnesses) {
      const otherWigers = [...receiptGroups.entries()]
        .flatMap(([current, wigers]) => current === witness ? [] : [...wigers]);
      if (otherWigers.length === 0) {
        continue;
      }

      const introWitnesses = witnesses.filter((current) => current !== witness && receiptGroups.has(current));
      const parts: Uint8Array[] = [];
      if (
        serder.ilk === Ilks.icp
        || serder.ilk === Ilks.dip
        || ((serder.ilk === Ilks.rot || serder.ilk === Ilks.drt)
          && serder.adds.includes(witness))
      ) {
        const schemes = yield* witnessSchemeReplies(hab, introWitnesses, this.gvrsn);
        if (schemes.length > 0) {
          parts.push(schemes);
        }
      }
      parts.push(
        this.gvrsn.major === 1
          ? buildDetachedReceiptMessage(
            receiptEvent(pre, eventSn, said),
            { wigers: otherWigers },
          )
          : messagize(receiptEvent(pre, eventSn, said), {
            wigers: otherWigers,
            gvrsn: this.gvrsn,
            pipelined: true,
            genusify: true,
          }),
      );
      yield* sendWitnessMessage(hab, witness, concatBytes(...parts), this.http, this.clock, this.protocol);
    }

    return { witnesses, statuses };
  }
  /**
   * Query a stored witness receipt and apply it to local state when found.
   *
   * @param pre Event subject AID.
   * @param options Optional sequence/SAID selection; defaults follow current accepted state.
   * @returns Whether matching verified witness receipt state was obtained.
   */
  *get(pre: string, { sn, said }: {
    sn?: number;
    said?: string;
  } = {}): Operation<boolean> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${pre}.`);
    }
    const eventSn = sn ?? kever.sn;
    const knownSaid = this.hby.db.kels.getLast(pre, eventSn);
    const known = knownSaid ? this.hby.db.getEvtSerder(pre, knownSaid) : null;
    const witnesses = known ? this.hby.db.acceptedEventWitnesses(known)! : kever.wits;
    const witness = [...witnesses].sort()[0];
    if (!witness) {
      return false;
    }

    const response = yield* call(() =>
      getWitnessReceiptEndpoint(hab, witness, { pre, sn: eventSn, said }, this.http, this.gvrsn)
    );
    if (response.kind !== "accepted") {
      return false;
    }

    yield* processMessages((signal) => chunkBytes(response.body, { signal }), this.protocol, this.kvy, {
      local: false,
    });
    yield* this.protocol.processEscrowsOnce();
    const expectedSaid = this.hby.db.kels.getLast(pre, eventSn);
    const accepted = expectedSaid ? this.hby.db.getEvtSerder(pre, expectedSaid) : null;
    const index = accepted ? this.hby.db.acceptedEventWitnesses(accepted)?.indexOf(witness) : -1;
    return !!expectedSaid && (said === undefined || said === expectedSaid)
      && this.hby.db.wigs.get(dgKey(pre, expectedSaid)).some((siger) => siger.index === index);
  }

  /**
   * Catch one witness up through the same protocol processor used for receipt intake.
   *
   * @param pre Local KEL subject to replay.
   * @param witness Witness AID to catch up.
   */
  *catchup(pre: string, witness: string): Operation<void> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (kever?.delegated) {
      for (const msg of this.hby.db.cloneDelegation(kever, this.gvrsn)) {
        yield* sendWitnessMessage(hab, witness, this.selected(msg), this.http, this.clock, this.protocol);
      }
    }
    for (const msg of this.hby.db.clonePreIter(pre, 0, this.gvrsn)) {
      yield* sendWitnessMessage(hab, witness, this.selected(msg), this.http, this.clock, this.protocol);
    }
  }
  /** Complete streams select their framing before the body; detached receipt headers retain their existing enclosure. */
  private selected(message: Uint8Array): Uint8Array {
    return this.gvrsn.major === 1 ? message : concatBytes(Counter.makeGVC(this.gvrsn), message);
  }
}

/**
 * Higher-level full witness submission helper.
 *
 * HTTP uses finite receipt endpoints; TCP uses same-socket local reply intake
 * and requires the requested witness signature to be persisted before fanout.
 */
export class WitnessReceiptor {
  /** Actual receipt-intake/fanout owner over the same shared protocol domain. */
  readonly receiptor: Receiptor;
  /** Borrowed identities and accepted witness cohorts. */
  readonly hby: Habery;
  /** Existing explicit request to publish even when cached receipt completion is available. */
  readonly force: boolean;

  /**
   * Bind actual protocol/I/O dependencies; only the scalar force choice is optional.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param protocol Borrowed same-database protocol owner for receipt intake.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
   * @param options force defaults false; true requests the existing forced witness submission policy.
   */
  constructor(hby: Habery, protocol: ProtocolProcessor, http: HttpClient, clock: RuntimeClock, { force = false }: {
    force?: boolean;
  } = {}) {
    this.hby = hby;
    this.force = force;
    this.receiptor = new Receiptor(hby, protocol, http, clock);
  }
  /** Ensure the current event reaches full witness receipt convergence. */
  *submit(pre: string, { sn, auths = {} }: {
    sn?: number;
    auths?: WitnessAuthMap;
  } = {}): Operation<WitnessReceiptRunResult> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${pre}.`);
    }
    const eventSn = sn ?? kever.sn;
    const { serder } = acceptedEventReplayMessage(this.hby, pre, eventSn);
    const witnesses = this.hby.db.acceptedEventWitnesses(serder)!;
    const currentWitnessCount = this.hby.db.wigs.get(dgKey(pre, serder.said!)).length;
    if (!this.force && currentWitnessCount >= witnesses.length) {
      const statuses = Object.fromEntries(witnesses.map((witness) => [witness, 200]));
      return { witnesses, statuses };
    }
    return yield* this.receiptor.receipt(pre, { sn: eventSn, auths, allowTcp: true });
  }
}
