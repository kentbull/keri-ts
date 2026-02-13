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

export class ShortageError extends ParserError {
  constructor(
    public readonly needed: number,
    public readonly available: number,
    offset?: number,
  ) {
    super(`Need ${needed} bytes but only ${available} available`, offset);
  }
}

export class ColdStartError extends ParserError {}
export class VersionError extends ParserError {}
export class UnknownCodeError extends ParserError {}
export class GroupSizeError extends ParserError {}
export class DeserializeError extends ParserError {}
