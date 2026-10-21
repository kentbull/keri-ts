/**
 * CLI module - public API
 *
 * This transitional module now exposes only the remaining non-host command
 * helpers that still live under `keri-ts`.
 */
/** Transitional command consumers share the same strict attachment-genus parser. */
export { parseGvrsn } from "../core/attachment-countering.ts";
export {
  type AgentRuntimeContext,
  type CommandContextDependencies,
  type CommandHaberyOptions,
  type CommandStoreArgs,
  type HabAgentRuntimeContext,
  type HabContext,
  type HaberyContext,
  withAgentRuntime,
  withExistingHab,
  withExistingHabery,
  withHabAndAgentRuntime,
} from "./common/context.ts";
export { type EnsuredHabery, ensureHby, setupHby } from "./common/existing.ts";
export {
  parseBooleanOption,
  parseCountOption,
  parseIntegerOption,
  parseNumberOption,
  parseStringListOption,
  parseStringOption,
} from "./common/parsing.ts";
export { writeJsonLine, writeTextLines } from "./common/rendering.ts";
export { resolveWitnessAuths, type WitnessAuthOptions } from "./common/witness-auth.ts";
export {
  ipexAdmitCommand,
  type IpexAdmitResult,
  ipexAgreeCommand,
  ipexApplyCommand,
  ipexGrantCommand,
  type IpexGrantResult,
  ipexJoinCommand,
  type IpexJoinResult,
  ipexListCommand,
  ipexOfferCommand,
  ipexPollCommand,
  type IpexPollResult,
  type IpexSendResult,
  ipexSpurnCommand,
} from "./credentials/ipex.ts";
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
} from "./credentials/vc.ts";
export { dkrResolveCommand, dwsBindCommand, dwsGenerateCommand, dwsResolveCommand } from "./endpoints/did.ts";
export { type EndRoleResult, endsAddCommand } from "./endpoints/ends.ts";
export { locAddCommand } from "./endpoints/loc.ts";
export { oobiCleanCommand } from "./endpoints/oobi-clean.ts";
export { oobiGenerateCommand, oobiRequestCommand, oobiResolveCommand } from "./endpoints/oobi.ts";
export { aidCommand } from "./identity/aid.ts";
export { challengeGenerateCommand, challengeRespondCommand, challengeVerifyCommand } from "./identity/challenge.ts";
export { delegateConfirmCommand } from "./identity/delegate.ts";
export { exportCommand } from "./identity/export.ts";
export { inceptCommand } from "./identity/incept.ts";
export { initCommand } from "./identity/init.ts";
export { interactCommand } from "./identity/interact.ts";
export { listCommand } from "./identity/list.ts";
export { rotateCommand } from "./identity/rotate.ts";
export { exchangeSendCommand } from "./messaging/exchange.ts";
export {
  type GroupEventResult,
  multisigInceptCommand,
  multisigInteractCommand,
  multisigJoinCommand,
  multisigRotateCommand,
  multisigRpyCommand,
} from "./messaging/multisig.ts";
export {
  notificationsListCommand,
  notificationsMarkReadCommand,
  notificationsRemoveCommand,
} from "./messaging/notifications.ts";
export { annotateCommand } from "./tools/annotate.ts";
export { benchmarkCommand } from "./tools/benchmark.ts";
export { dumpEvts } from "./tools/db-dump.ts";
export { saidifyCommand } from "./tools/saidify.ts";
export { signCommand } from "./tools/sign.ts";
export { verifyCommand } from "./tools/verify.ts";
