/** Runtime embedding surface for Tufa protocol hosts. */
export { runHostKernel } from "./src/host/kernel.ts";
export { createProtocolHandler } from "./src/http/protocol-handler.ts";

export { VerifierAgent, type VerifierAgentOptions, type VerifierAgentProcessResult } from "./src/verifier/agent.ts";
export {
  createVerifierCueBaser,
  VerifierCueBaser,
  type VerifierCueBaserOptions,
  type VerifierCueCounts,
} from "./src/verifier/cue-store.ts";
export type { VerifierBusinessValidator, VerifierBusinessValidatorContext } from "./src/verifier/policy.ts";
export type { VerifierWebhookBody } from "./src/verifier/webhook.ts";
