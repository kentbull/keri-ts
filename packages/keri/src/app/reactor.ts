/** Input-owned buffered parsing and queued ingress; shared protocol work belongs to ProtocolProcessor. */
import { type Operation } from "npm:effection@^3.6.0";
import { Deck } from "../core/deck.ts";
import type { Kevery } from "../core/eventing.ts";
import { chunkBytes } from "./byte-source.ts";
import { type IngressOptions, processMessages } from "./message-source.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/**
 * Own queued/direct input and its buffered parser for one composed protocol domain.
 *
 * Like KERIpy's direct-mode input owners, this component consumes bytes and drives
 * protocol handlers. It borrows the shared processor and owns an independent Kevery;
 * accepted Kever state remains in the common Baser cache. Escrow scheduling, route
 * registration and application handler installation belong to composition.
 */
export class Reactor {
  /** Input-specific Kevery (kvy); its accepted-state cache is shared through Baser. */
  readonly kvy: Kevery;
  /** Complete copied records awaiting this input owner's sole queue consumer. */
  private readonly ingress = new Deck<Uint8Array>();

  /**
   * Bind the actual shared protocol owner; create no runtime, transport or persistent stores.
   *
   * @param protocol Borrowed shared protocol domain; this input creates its own Kevery over that domain.
   */
  constructor(
    /** Borrowed protocol mutations/publication owner, never a transport or callback scheduler. */
    readonly protocol: ProtocolProcessor,
  ) {
    this.kvy = protocol.makeKevery();
  }

  /** Whether the complete-record queue still has input to process. */
  get hasIngress(): boolean {
    return !this.ingress.empty;
  }
  /**
   * Own this input and finish dispatch before reading its next complete frame.
   *
   * @param source Creates cancellation-aware input bytes; this operation owns parsing and source cleanup.
   * @param options Dispatch policy and optional upstream cancellation.
   * @throws Source/parser, dispatch and cleanup failures propagate.
   */
  process(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: IngressOptions = {},
  ): Operation<void> {
    return processMessages(source, this.protocol, this.kvy, options);
  }
  /**
   * Queue one complete CESR/KERI record for later parsing.
   *
   * This is the transient ingress seam used by both local synthetic messages
   * and remotely fetched OOBI artifacts.
   *
   * @param bytes Complete resident record copied into the input queue; processing happens later.
   */
  ingest(bytes: Uint8Array): void {
    // Preserve the queued record independently of subsequent producer mutation.
    this.ingress.push(bytes.slice());
  }

  /** Discard ordinary queued records; active input operations own their own lifetime. */
  clearIngress(): void {
    this.ingress.clear();
  }

  /**
   * Consume one complete record through the same buffered parser source and dispatch path as network input.
   *
   * @param bytes Resident complete record; each parser chunk is copied during consumption.
   * @param options Dispatch policy and optional upstream cancellation.
   */
  *processBytes(bytes: Uint8Array, options: IngressOptions = {}): Operation<void> {
    // Copy already resident input in fixed-size chunks for the parser source.
    yield* this.process((signal) => chunkBytes(bytes, { signal }), options);
  }
  /**
   * Drain queued records through buffered parsing and shared dispatch.
   * Each record is removed before processing and is not reinserted after failure.
   * The loop runs until the queue is empty, including records appended during dispatch;
   * this is not an initial-length snapshot or a network delivery operation.
   */
  *processOnce(): Operation<void> {
    while (!this.ingress.empty) yield* this.processBytes(this.ingress.pull()!);
  }

  /**
   * Continuous message doer for command hosts that keep the runtime alive.
   *
   * This is the Effection equivalent of a KERIpy `msgDo`: drain ingress, yield
   * to the scheduler, and repeat indefinitely.
   */
  *msgDo(): Operation<never> {
    while (true) {
      yield* this.processOnce();
      yield* runtimeTurn();
    }
  }
}
