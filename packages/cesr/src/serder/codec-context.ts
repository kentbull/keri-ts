/** Decoder provenance for body hydration; independent of resource accounting. */
export interface BodyDecodeContext {
  onDecodeFailure?: (error: unknown) => void;
  msgpackBoundaryFailure?: boolean;
  cborBoundaryFailure?: boolean;
}
