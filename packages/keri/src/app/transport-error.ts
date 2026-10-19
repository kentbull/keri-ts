/** A failure observed at a concrete network I/O boundary, retaining its original cause. */
export class TransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransportError";
  }
}
