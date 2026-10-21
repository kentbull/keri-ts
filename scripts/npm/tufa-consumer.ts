/** Compile-only installed application composition through supported public package declarations. */
import { VerifierAgent, type VerifierCueBaser, createVerifierCueBaser } from "@keri-ts/tufa/runtime";
import type { AgentRuntime } from "keri-ts/runtime";

/** Compose the application without a private protocol import or dependency-discovery container. */
export function verifier(runtime: AgentRuntime, cdb: VerifierCueBaser, hook: string): VerifierAgent {
  if (!runtime.vdr) throw new Error("Legacy credential profile is required");
  return new VerifierAgent(
    runtime.hby, runtime.vdr.reger, cdb, runtime.protocol, runtime.cues, runtime.http,
    () => runtime.clock.now(), {}, { hook },
  );
}

/** Expose the concrete application's storage acquisition type to the installed compiler. */
export const cueStore = createVerifierCueBaser;
