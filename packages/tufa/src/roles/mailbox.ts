import type { Operation } from "npm:effection@^3.6.0";
import type { Habery } from "../../../keri/runtime.ts";
import {
  type IndirectHostOptions,
  runIndirectHost,
} from "../host/indirect-host.ts";

/** Package-internal long-lived mailbox-host settings. */
export interface MailboxHostOptions extends IndirectHostOptions {}

/**
 * Run one mailbox HTTP host over the shared indirect-mode kernel.
 *
 * Mailbox hosting currently uses the shared indirect HTTP path without extra
 * companion listeners, but keeping this wrapper explicit makes role ownership
 * visible and keeps mailbox host callers out of the generic host module.
 */
export function* runMailboxHost(
  hby: Habery,
  options: MailboxHostOptions,
): Operation<void> {
  yield* runIndirectHost(hby, options);
}
