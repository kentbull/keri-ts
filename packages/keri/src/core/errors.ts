/**
 * Base application error for `keri-ts` app/db infrastructure.
 *
 * Use subclasses for the failure domain, messages for diagnostics, and standard
 * Error.cause only for an actual underlying failure. Foreign thrown values stay
 * opaque; domain processing never inspects them for instructions.
 */
export class AppError extends Error {
  constructor(
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid caller input or state transition at an application boundary. */
export class ValidationError extends AppError {}

/** Filesystem or path-resolution failure from path-managed resources. */
export class PathError extends AppError {}

/** Rejected path name because it violates relative-name constraints. */
export class InvalidPathNameError extends ValidationError {}

/** Base error for LMDB or higher-level database operations. */
export class DatabaseError extends AppError {}

/** Database-dependent operation attempted before the resource was opened. */
export class DatabaseNotOpenError extends DatabaseError {}

/** Key encoding/shape failure while reading or writing database state. */
export class DatabaseKeyError extends DatabaseError {}

/** Operational LMDB/path failure during a database lifecycle step. */
export class DatabaseOperationError extends DatabaseError {}
