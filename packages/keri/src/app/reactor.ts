/** Input-owned buffered parsing; shared protocol work belongs to ProtocolProcessor. */
import { type Operation } from "npm:effection@^3.6.0";
import type { Kevery } from "../core/eventing.ts";
import { chunkBytes } from "./byte-source.ts";
import { type IngressOptions, processMessages } from "./message-source.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";

/**
 * Own direct input and its buffered parser for one composed protocol domain.
 *
 * Like KERIpy's direct-mode input owners, this component consumes bytes and drives
 * protocol handlers. It borrows the shared processor and owns an independent Kevery;
 * accepted Kever state remains in the common Baser cache. Escrow scheduling, route
 * registration and application handler installation belong to composition.
 */
export class Reactor {
  /** Input-specific Kevery (kvy); its accepted-state cache is shared through Baser. */
  readonly kvy: Kevery;

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
   * Consume one complete record through the same buffered parser source and dispatch path as network input.
   *
   * @param bytes Resident complete record; each parser chunk is copied during consumption.
   * @param options Dispatch policy and optional upstream cancellation.
   */
  *processBytes(bytes: Uint8Array, options: IngressOptions = {}): Operation<void> {
    // Copy already resident input in fixed-size chunks for the parser source.
    yield* this.process((signal) => chunkBytes(bytes, { signal }), options);
  }
}
