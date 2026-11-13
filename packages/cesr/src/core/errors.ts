/**
 * Base parser failure carrying optional offset/context for maintainer
 * diagnostics.
 *
 * Subclasses identify which parser phase rejected the input so callers can
 * decide whether to recover, retry, or fail hard.
 */
export class ParserError extends Error {
  constructor(
    message: string,
    public readonly offset?: number,
    public readonly context?: string,
  ) {
    super(message);
  }
  /** Every class names itself with a literal; see `AppError` in keri-ts for why not `new.target.name`. */
  override readonly name: string = "ParserError";
}

/** Opt-in progressive decoding refusal, excluding caller I/O, policy and cleanup failures. */
export class WireParseError extends ParserError {
  override readonly name: string = "WireParseError";
  constructor(public override readonly cause: ParserError) {
    super(cause.message, cause.offset, cause.context);
  }
}

/** Input ended before the parser had enough bytes to complete the current unit. */
export class ShortageError extends ParserError {
  override readonly name: string = "ShortageError";
  constructor(
    public readonly needed: number,
    public readonly available: number,
    offset?: number,
  ) {
    super(`Need ${needed} bytes but only ${available} available`, offset);
  }
}

/** Parser encountered an invalid cold-start selector. */
export class ColdStartError extends ParserError {
  override readonly name: string = "ColdStartError";
}
/** Version framing or version-table selection failed. */
export class VersionError extends ParserError {
  override readonly name: string = "VersionError";
}
/** A CESR code selector was not recognized in the active codex. */
export class UnknownCodeError extends ParserError {
  override readonly name: string = "UnknownCodeError";
}
/** Group/count metadata could not describe a valid parse shape. */
export class GroupSizeError extends ParserError {
  override readonly name: string = "GroupSizeError";
}
/** Qualified input could not be deserialized into a valid CESR payload. */
export class DeserializeError extends ParserError {
  override readonly name: string = "DeserializeError";
}
/** A CESR payload could not be serialized into a valid protocol representation. */
export class SerializeError extends ParserError {
  override readonly name: string = "SerializeError";
}
/** Failure while constructing syntax artifacts from token bytes. */
export class SyntaxParseError extends ParserError {
  override readonly name: string = "SyntaxParseError";
  constructor(
    message: string,
    public override readonly cause?: Error,
    offset?: number,
    context?: string,
  ) {
    super(message, offset, context);
  }
}
/** Failure while interpreting syntax artifacts into semantic fields. */
export class SemanticInterpretationError extends ParserError {
  override readonly name: string = "SemanticInterpretationError";
  constructor(
    message: string,
    public override readonly cause?: Error,
    offset?: number,
    context?: string,
  ) {
    super(message, offset, context);
  }
}
