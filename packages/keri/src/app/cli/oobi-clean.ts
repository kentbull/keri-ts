/** Offline, exact-key maintenance of the existing pending-OOBI table. */
import { call, type Operation } from "effection";
import { DatabaseOperationError, ValidationError } from "../../core/errors.ts";
import { baserDefaults } from "../../db/baser-defaults.ts";
import { createBaser } from "../../db/basing.ts";
import { PathManager } from "../../db/core/path-manager.ts";
import { parseBooleanOption, parseStringOption } from "./common/parsing.ts";
import { writeJsonLine } from "./common/rendering.ts";

/** Read a nonempty JSON list, preserving exact keys and first-seen order. */
function* loadKeys(path: string): Operation<string[]> {
  let value: unknown;
  try {
    value = JSON.parse(yield* call(() => Deno.readTextFile(path)));
  } catch (cause) {
    throw new ValidationError(`Unable to read the JSON key file: ${path}`, { cause });
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("Key file must contain a nonempty JSON array of exact string keys");
  }
  const keys = new Set<string>();
  for (const [index, key] of value.entries()) {
    if (typeof key !== "string" || key.length === 0) {
      throw new ValidationError(`Key file entry ${index} must be a nonempty string`);
    }
    // UTF-8 encoding replaces lone surrogates; never select a different stored
    // key by silently repairing an ill-formed JSON string.
    if (/[\uD800-\uDFFF]/u.test(key)) {
      throw new ValidationError(`Key file entry ${index} must be a well-formed Unicode string`);
    }
    keys.add(key);
  }
  return [...keys];
}

/**
 * Preview by default; apply only after every requested pending key is present.
 * Publish the actual completed/remaining selection even on a deletion failure.
 * The operator stops and backs up the service before invoking this command.
 */
export function* oobiCleanCommand(args: Record<string, unknown>): Operation<void> {
  if (typeof args.name !== "string" || args.name.trim().length === 0) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (typeof args.keyFile !== "string" || args.keyFile.length === 0) {
    throw new ValidationError("A JSON --key-file is required");
  }
  const name = args.name;
  const apply = parseBooleanOption(args.apply, "apply") ?? false;
  const options = {
    name,
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    compat: parseBooleanOption(args.compat, "compat") ?? false,
  };
  const keys = yield* loadKeys(args.keyFile);
  // Resolve through ordinary path preparation before Baser can create data.mdb.
  // Empty directories are ordinary startup effects; missing databases still fail.
  const paths = new PathManager(options, baserDefaults(options.compat));
  paths.name = name;
  yield* paths.reopen();
  const path = paths.path!;
  yield* paths.close();
  if (!(yield* paths.statFileOp(`${path}/data.mdb`)).isFile) {
    throw new DatabaseOperationError(`Existing database not found at ${path}`);
  }
  let report: {
    path: string;
    mode: string;
    selectedCount: number;
    entries: { key: string; present: boolean }[];
    missing: string[];
    deletedCount: number;
    deleted: string[];
    remaining: string[];
  } | undefined;
  try {
    // This boundary joins resource shutdown before reporting command completion.
    yield* call(function*() {
      const db = yield* createBaser(options);
      let operationFailure: { error: unknown } | undefined;
      try {
        const entries = keys.map((key) => ({ key, present: db.oobis.get(key) !== null }));
        const missing = entries.filter((entry) => !entry.present).map((entry) => entry.key);
        const deleted: string[] = [];
        report = {
          path,
          mode: apply ? "apply" : "preview",
          selectedCount: keys.length,
          entries,
          missing,
          deletedCount: 0,
          deleted,
          remaining: [...keys],
        };
        if (missing.length > 0) {
          throw new ValidationError(`Pending OOBI keys not found: ${JSON.stringify(missing)}`);
        }
        if (apply) {
          for (const key of keys) {
            try {
              if (!db.oobis.rem(key)) {
                throw new DatabaseOperationError(`Pending OOBI removal returned false for ${key}`);
              }
            } catch (cause) {
              throw new DatabaseOperationError(
                `OOBI cleanup stopped after deleting ${deleted.length} of ${keys.length} selected entries`,
                { cause },
              );
            }
            deleted.push(key);
            report.deletedCount = deleted.length;
            report.remaining = keys.slice(deleted.length);
          }
        }
      } catch (error) {
        operationFailure = { error };
        throw error;
      } finally {
        try {
          yield* db.close();
        } catch (error) {
          if (operationFailure) {
            // deno-lint-ignore no-unsafe-finally -- Preserve completed row failure and shutdown failure.
            throw new AggregateError([operationFailure.error, error], "OOBI cleanup and database close failed", {
              cause: operationFailure.error,
            });
          }
          // deno-lint-ignore no-unsafe-finally -- Final command success requires closure.
          throw error;
        }
      }
    });
  } catch (error) {
    if (report) writeJsonLine({ ...report, status: "failed" });
    throw error;
  }
  if (report) writeJsonLine({ ...report, status: "complete" });
}
