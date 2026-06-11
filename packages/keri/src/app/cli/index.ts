/**
 * CLI module - public API
 *
 * This transitional module now exposes only the remaining non-host command
 * helpers that still live under `keri-ts`.
 */
export { aidCommand } from "./aid.ts";
export { annotateCommand } from "./annotate.ts";
export { benchmarkCommand } from "./benchmark.ts";
export { challengeGenerateCommand, challengeRespondCommand, challengeVerifyCommand } from "./challenge.ts";
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
} from "./common/context.ts";
export { type EnsuredHabery, ensureHby, setupHby } from "./common/existing.ts";
export { dumpEvts } from "./db-dump.ts";
export { delegateConfirmCommand } from "./delegate.ts";
export { dkrResolveCommand, dwsBindCommand, dwsGenerateCommand, dwsResolveCommand } from "./did.ts";
export { endsAddCommand } from "./ends.ts";
export { exchangeSendCommand } from "./exchange.ts";
export { exportCommand } from "./export.ts";
export { inceptCommand } from "./incept.ts";
export { initCommand } from "./init.ts";
export { interactCommand } from "./interact.ts";
export {
  ipexAdmitCommand,
  ipexAgreeCommand,
  ipexApplyCommand,
  ipexGrantCommand,
  ipexJoinCommand,
  ipexListCommand,
  ipexOfferCommand,
  ipexPollCommand,
  ipexSpurnCommand,
} from "./ipex.ts";
export { listCommand } from "./list.ts";
export { locAddCommand } from "./loc.ts";
export {
  multisigInceptCommand,
  multisigInteractCommand,
  multisigJoinCommand,
  multisigRotateCommand,
  multisigRpyCommand,
} from "./multisig.ts";
export { notificationsListCommand, notificationsMarkReadCommand, notificationsRemoveCommand } from "./notifications.ts";
export { oobiGenerateCommand, oobiRequestCommand, oobiResolveCommand } from "./oobi.ts";
export { queryCommand } from "./query.ts";
export { rotateCommand } from "./rotate.ts";
export { saidifyCommand } from "./saidify.ts";
export { signCommand } from "./sign.ts";
export {
  vcCreateCommand,
  vcExportCommand,
  vcImportCommand,
  vcListCommand,
  vcRegistryInceptCommand,
  vcRegistryListCommand,
  vcRegistryStatusCommand,
  vcRevokeCommand,
  vcSchemaImportCommand,
} from "./vc.ts";
export { verifierRunCommand } from "./verifier.ts";
export { verifyCommand } from "./verify.ts";
