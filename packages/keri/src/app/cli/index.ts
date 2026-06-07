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
export { dumpEvts } from "./db-dump.ts";
export { delegateConfirmCommand } from "./delegate.ts";
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
  ipexSpurnCommand,
} from "./ipex.ts";
export { listCommand } from "./list.ts";
export { locAddCommand } from "./loc.ts";
export { notificationsListCommand, notificationsMarkReadCommand, notificationsRemoveCommand } from "./notifications.ts";
export { oobiGenerateCommand, oobiRequestCommand, oobiResolveCommand } from "./oobi.ts";
export { queryCommand } from "./query.ts";
export { rotateCommand } from "./rotate.ts";
export { signCommand } from "./sign.ts";
export { verifyCommand } from "./verify.ts";
export { verifierRunCommand } from "./verifier.ts";
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
