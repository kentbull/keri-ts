/** Offline, exact-key maintenance of the existing pending-OOBI table. */
import { call, type Operation } from "effection";
import { DatabaseOperationError, ValidationError } from "../../core/errors.ts";
import { openOobiStore } from "../../db/oobi-store.ts";
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
  const keys = yield* loadKeys(args.keyFile);
  const apply = args.apply === true;
  const store = yield* openOobiStore({
    name: args.name,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    compat: args.compat === true,
    readonly: !apply,
  });
  const entries = keys.map((key) => ({ key, present: store.get(key) !== null }));
  const missing = entries.filter((entry) => !entry.present).map((entry) => entry.key);
  const deleted: string[] = [];
  try {
    if (missing.length > 0) {
      throw new ValidationError(`Pending OOBI keys not found: ${JSON.stringify(missing)}`);
    }
    if (apply) {
      for (const key of keys) {
        try {
          if (!store.rem(key)) throw new DatabaseOperationError(`Pending OOBI removal returned false for ${key}`);
        } catch (cause) {
          throw new DatabaseOperationError(
            `OOBI cleanup stopped after deleting ${deleted.length} of ${keys.length} selected entries`,
            { cause },
          );
        }
        deleted.push(key);
      }
    }
  } finally {
    writeJsonLine({
      path: store.path,
      mode: apply ? "apply" : "preview",
      selectedCount: keys.length,
      entries,
      missing,
      deletedCount: deleted.length,
      deleted,
      remaining: keys.slice(deleted.length),
    });
  }
}
