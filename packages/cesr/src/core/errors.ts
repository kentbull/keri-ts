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
    this.name = new.target.name;
  }
}

/** Input ended before the parser had enough bytes to complete the current unit. */
export class ShortageError extends ParserError {
  constructor(
    public readonly needed: number,
    public readonly available: number,
    offset?: number,
  ) {
    super(`Need ${needed} bytes but only ${available} available`, offset);
  }
}

/** Parser encountered an invalid cold-start selector. */
export class ColdStartError extends ParserError {}
/** Version framing or version-table selection failed. */
export class VersionError extends ParserError {}
/** A CESR code selector was not recognized in the active codex. */
export class UnknownCodeError extends ParserError {}
/** Group/count metadata could not describe a valid parse shape. */
export class GroupSizeError extends ParserError {}
/** Qualified input could not be deserialized into a valid CESR payload. */
export class DeserializeError extends ParserError {}
/** Failure while constructing syntax artifacts from token bytes. */
export class SyntaxParseError extends ParserError {
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
  constructor(
    message: string,
    public override readonly cause?: Error,
    offset?: number,
    context?: string,
  ) {
    super(message, offset, context);
  }
}
