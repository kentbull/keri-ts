/** Decoded-body credit shared by a root and descendants; supplied bytes stay immutable through decode. */
export interface DecodedBodyBudget {
  decodedBytes: number;
  onDecodeFailure?: (error: unknown) => void;
  admitStage?: (bytes: number) => void;
}

/** Decoder provenance only: Serdery owns admission; standalone/store hydration remains unadmitted. */
export interface BodyDecodeContext {
  onDecodeFailure?: (error: unknown) => void;
  msgpackBoundaryFailure?: boolean;
  cborBoundaryFailure?: boolean;
}
