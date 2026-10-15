/** Decoded-body credit shared by a root and descendants; supplied bytes stay immutable through decode. */
export interface DecodedBodyBudget {
  decodedBytes: number;
  onDecodeFailure?: (error: unknown) => void;
  admitStage?: (bytes: number) => void;
}
