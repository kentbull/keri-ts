/**
 * The `root_copy` JSON lines the CLI prints for automatic registry root copies.
 *
 * The library reports typed `RootCopyResult`s; the display shape, the Tufa recovery
 * command and the error text belong to the command layer. The interop stories read
 * these lines, so field names and their order are a contract.
 */
import type { RootCopyResult, RootExamination } from "../../app/credentials/root-replicating.ts";

/** The operator command that resends a copy automatic replication did not send. */
export const RootCopyRecoveryCommand = "tufa vc registry root send";

/**
 * One automatic copy's outcome. `exchange` is the prepared copy's SAID; `transmitted`
 * means handed to the mailbox, not received. A copy not sent carries the error and the
 * recovery command.
 */
export interface RootCopyLine {
  phase: "root_copy";
  gid: string;
  registry: string;
  sender: string;
  recipient: string;
  exchange?: string;
  transmitted: boolean;
  error?: string;
  recovery?: string;
}

/** A re-seal that could not even select its recipients. */
export interface RootResealLine {
  phase: "root_copy";
  gid: string;
  rotation: string;
  transmitted: false;
  error: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Map one typed copy result to its `root_copy` line. */
export function rootCopyLine(result: RootCopyResult): RootCopyLine {
  const line: RootCopyLine = {
    phase: "root_copy",
    gid: result.group,
    registry: result.registry,
    sender: result.sender,
    recipient: result.recipient,
    transmitted: false,
  };
  if (result.exchange !== undefined) line.exchange = result.exchange;
  if (result.kin === "sent") return { ...line, transmitted: true };
  return { ...line, error: errorText(result.error), recovery: RootCopyRecoveryCommand };
}

/** Map an unexaminable rotation to its `root_copy` line. */
export function rootResealLine(examination: RootExamination): RootResealLine {
  return {
    phase: "root_copy",
    gid: examination.group,
    rotation: examination.rotation,
    transmitted: false,
    error: examination.error.message,
  };
}
