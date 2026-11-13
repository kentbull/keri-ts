import type { KramTimeRefusal } from "./mailbox/kram-time.ts";

/**
 * Base application error for `keri-ts` app/db infrastructure.
 *
 * Use subclasses for the failure domain, messages for diagnostics, and standard
 * Error.cause only for an actual underlying failure. Foreign thrown values stay
 * opaque; domain processing never inspects them for instructions.
 */
export class AppError extends Error {
  /**
   * Every class names itself with a literal. `new.target.name` and `constructor.name` are not used: they are
   * mangled by a minifier, and the dnt transform of `new.target` needs a polyfill the browser entries do not load.
   */
  override readonly name: string = "AppError";
}

/** Invalid caller input or state transition at an application boundary. */
export class ValidationError extends AppError {
  override readonly name: string = "ValidationError";
}

/**
 * A caller asked to treat a KRAM refusal as a failure. Carries the refused message SAID and the refusal decision;
 * the message names the reason and, when the refusal has one, the last instant the message was acceptable.
 */
export class KramRefusedError extends ValidationError {
  override readonly name: string = "KramRefusedError";

  constructor(readonly said: string, readonly refusal: KramTimeRefusal) {
    super(
      `KRAM refused message ${said}: ${refusal.reason}`
        + (refusal.deadline ? ` (acceptable until ${refusal.deadline})` : ""),
    );
  }
}

/** Filesystem or path-resolution failure from path-managed resources. */
export class PathError extends AppError {
  override readonly name: string = "PathError";
}

/**
 * An Unblind was asked of a presentation whose exchange already has its terminal response (an Admit or a Spurn). The
 * discloser consented to answer queries about a live presentation; the response ends that authority, so the
 * Unblind must be requested before the response is made.
 */
export class PresentationClosedError extends ValidationError {
  override readonly name: string = "PresentationClosedError";
}

/** Rejected path name because it violates relative-name constraints. */
export class InvalidPathNameError extends ValidationError {
  override readonly name: string = "InvalidPathNameError";
}

/** Base error for LMDB or higher-level database operations. */
export class DatabaseError extends AppError {
  override readonly name: string = "DatabaseError";
}

/** Database-dependent operation attempted before the resource was opened. */
export class DatabaseNotOpenError extends DatabaseError {
  override readonly name: string = "DatabaseNotOpenError";
}

/** Key encoding/shape failure while reading or writing database state. */
export class DatabaseKeyError extends DatabaseError {
  override readonly name: string = "DatabaseKeyError";
}

/** Operational LMDB/path failure during a database lifecycle step. */
export class DatabaseOperationError extends DatabaseError {
  override readonly name: string = "DatabaseOperationError";
}
