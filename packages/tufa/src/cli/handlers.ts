/**
 * Tufa-owned lazy command-dispatch registry.
 *
 * Stage 6 ownership rule:
 * - parse-time command registration and run-time dispatch both now live in
 *   `tufa`
 * - non-host commands may still delegate to reusable `keri` operation modules
 *   for now
 *
 * The dispatch map is now derived from registrations performed by the
 * command-definition modules (via registerCommandHandler). This removes the
 * previous hand-maintained duplicate of the entire command tree.
 */
export { createCmdHandlers } from "./command-definitions/shared.ts";
