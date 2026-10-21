/** A failure observed at a concrete network I/O boundary, retaining its original cause. */
export class TransportError extends Error {
  /**
   * Preserve a concrete I/O failure for transport owners to classify.
   * Protocol refusals and arbitrary parser/storage failures must not be wrapped here.
   *
   * @param message Description of the actual failing network boundary.
   * @param options Native Error options, normally containing the original I/O cause.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransportError";
  }
}
