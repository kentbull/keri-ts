/**
 * Re-export of the canonical CLI lifecycle context helpers.
 *
 * Tufa-owned commands use this shim when they need scoped Habery or runtime
 * lifecycle management while the transitional implementation lives in keri-ts.
 */
export {
  type AgentRuntimeContext,
  type CommandContextDependencies,
  type CommandHaberyOptions,
  type CommandStoreArgs,
  type HabAgentRuntimeContext,
  type HaberyContext,
  withAgentRuntime,
  withExistingHabery,
  withHabAndAgentRuntime,
} from "../../../../keri/src/app/cli/common/context.ts";
