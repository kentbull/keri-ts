/**
 * Base application error for `keri-ts` app/db infrastructure.
 *
 * Use subclasses to communicate the failure domain while optionally attaching
 * structured maintainer-facing context for logging or debugging.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Invalid caller input or state transition at an application boundary. */
export class ValidationError extends AppError {}

/** Reply/event material that is structurally valid but not yet verifiable. */
export class UnverifiedReplyError extends ValidationError {}

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
