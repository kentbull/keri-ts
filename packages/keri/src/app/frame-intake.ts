/** Demand-driven source/parser lifetime; protocol dispatch and durable effects belong to Reactor. */
import { type ParseOptions, ResourceAdmissionError, type ResourcePolicy } from "cesr-ts";
import { type FrameChannel, toEffectionFrames } from "cesr-ts/effection";
import { type Operation, resource } from "npm:effection@^3.6.0";

/** Per-source bounds/cancellation; mutable admission belongs to this intake owner. */
export type FrameInputOptions = Omit<ParseOptions, "resources">;

/** One source slot remains occupied through pending reads, parser cleanup and joined source return. */
export class FrameIntake {
  private sources = 0;

  /** Borrow shared admission and the storage staging capability; construct no parser or source yet. */
  constructor(
    private readonly resources: ResourcePolicy,
    private readonly payloadSink: ParseOptions["payloadSink"],
    private readonly maxSources = 8,
  ) {
    if (!Number.isSafeInteger(maxSources) || maxSources < 1) throw new RangeError("Invalid source concurrency limit");
  }

  /** Own one admitted parser channel until the caller's scope ends, including input cancellation. */
  frames(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: FrameInputOptions = {},
  ): Operation<FrameChannel> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return resource<FrameChannel>(function*(provide) {
      // Capture policy once; later caller mutations must not exceed the reserved input allowance.
      const limits = {
        ...options,
        maxChunkBytes: options.maxChunkBytes ?? 1024 ** 2,
        maxBufferedBytes: options.maxBufferedBytes ?? 8 * 1024 ** 2,
      };
      for (const limit of [limits.maxChunkBytes, limits.maxBufferedBytes]) {
        if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid ingress input limit");
      }
      if (limits.maxChunkBytes > limits.maxBufferedBytes) throw new RangeError("Chunk limit exceeds buffer limit");
      // One producer allocation may coexist with the retained cursor queue while next() completes.
      const inputBytes = limits.maxChunkBytes + limits.maxBufferedBytes;
      if (!Number.isSafeInteger(inputBytes)) throw new RangeError("Ingress input reservation exceeds safe range");
      // The admission lease predates the parser resource, so parser cleanup completes before release.
      yield* resource<void>(function*(hold) {
        if (self.sources >= self.maxSources) {
          const error = new ResourceAdmissionError("Too many active ingress sources", "busy");
          options.onAdmissionRefusal?.(error);
          throw error;
        }
        const credit = self.resources.reserve({ streams: 1, bytes: inputBytes });
        if (credit.kind === "refuse") {
          const error = new ResourceAdmissionError(
            `Ingress ${credit.resource} admission refused: ${credit.reason}`,
            credit.reason,
          );
          options.onAdmissionRefusal?.(error);
          throw error;
        }
        self.sources++;
        try {
          yield* hold();
        } finally {
          self.sources--;
          credit.reservation.release();
        }
      });
      const channel = yield* toEffectionFrames(source, {
        ...limits,
        resources: self.resources,
        // Acquire storage lazily: ordinary frames do not open the payload archive.
        payloadSink: options.payloadSink
          ?? self.payloadSink,
      });
      yield* provide(channel);
    });
  }
}
