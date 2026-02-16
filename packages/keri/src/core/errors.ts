export class AppError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {}

export class PathError extends AppError {}

export class InvalidPathNameError extends ValidationError {}

export class DatabaseError extends AppError {}

export class DatabaseNotOpenError extends DatabaseError {}

export class DatabaseKeyError extends DatabaseError {}

export class DatabaseOperationError extends DatabaseError {}
