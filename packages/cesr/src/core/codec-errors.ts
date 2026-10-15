import type { Kind } from "../tables/versions.ts";
import { DeserializeError } from "./errors.ts";

const syntaxFailures = new WeakMap<DeserializeError, Kind>();

/** Mark only locally created intrinsic syntax failures; same-class external errors remain foreign. */
export function codecSyntaxFailure(kind: Kind, message: string): DeserializeError {
  const error = new DeserializeError(message);
  syntaxFailures.set(error, kind);
  return error;
}

/** The body parser needs one provenance contract, without knowing each decoder's private failure tracking. */
export function isCodecSyntaxFailure(error: unknown, kind: Kind): boolean {
  return error instanceof DeserializeError && syntaxFailures.get(error) === kind;
}
