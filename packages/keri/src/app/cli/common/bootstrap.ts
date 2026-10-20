/** CLI-only presentation of the finite bootstrap operation's typed result. */
import { ValidationError } from "../../../core/errors.ts";
import type { BootstrapResult } from "../../bootstrapping.ts";

/** Refuse unsuccessful bootstrap before command effects or success output continue. */
export function assertBootstrapComplete(result: BootstrapResult): void {
  switch (result.kind) {
    case "complete":
      return;
    case "failed":
      throw new ValidationError(
        `Bootstrap failed: ${result.failures.map(({ url, state }) => `${url} (${state})`).join(", ")}`,
      );
    case "timeout":
      throw new ValidationError(`Bootstrap deadline reached with pending evidence: ${result.pending.join(", ")}`);
  }
}
