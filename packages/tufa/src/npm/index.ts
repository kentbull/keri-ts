/**
 * Minimal npm module surface for the `tufa` application package.
 *
 * The primary supported interface is the `tufa` binary. These exports exist so
 * tests and advanced callers can invoke the CLI runtime programmatically.
 */
export {
  CliExitError,
  reportCliFailure,
  tufa,
} from "../cli/cli.ts";
