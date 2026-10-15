/** Demand-driven parser staging; protocol dispatch and durable effects belong to Reactor. */
import type { ParseOptions } from "cesr-ts";
import { type FrameChannel, toEffectionFrames } from "cesr-ts/effection";
import type { Operation } from "npm:effection@^3.6.0";

/** Bind actual ESSR staging to parser scopes without accounting or source slots. */
export class FrameIntake {
  constructor(private readonly payloadSink: ParseOptions["payloadSink"]) {}

  /** Own one parser channel through the adapter's cancellation and joined cleanup scope. */
  frames(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: ParseOptions = {},
  ): Operation<FrameChannel> {
    return toEffectionFrames(source, {
      ...options,
      payloadSink: options.payloadSink ?? this.payloadSink,
    });
  }
}
