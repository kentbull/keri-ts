/**
 * Lane 15d, "KERIpy member added by rotation". Partly written, not yet run.
 *
 * Real: the start state. A 2-member group of the browser and Tufa member A (threshold 2) on the shared mailbox and
 * witness, with a registry and one credential issued to a single-signature Tufa holder, reusing the 15c steps.
 *
 * Scaffold: everything that needs a KERIpy (`kli`) peer. The lane's control server runs only `tufa`; driving `kli`
 * needs new harness, listed in {@link KERIPY_MEMBER_MISSING}. The three scaffold steps fail on purpose with that list,
 * so a run cannot pass while the KERIpy half does not exist. The intended steps are:
 *   7  a KERIpy member is provisioned (init, incept with the witness, authorize the keri-ts mailbox);
 *   8  the browser proposes `groups.rotate(group, { smids: [A, browser, kli], isith: "2", nsith: "2" })`, A and kli
 *      approve (`tufa multisig join`, `kli multisig join --group group --auto`), and A's join prints the `root_copy`
 *      line for the newcomer (`transmitted: true`);
 *   9  the newcomer holds the re-sealed registry root (`kli vc registry root receive --listen`, or its `kli` state) and
 *      takes part in the next group event (`groups.interact` from the browser, `kli multisig join` approving).
 */

import { INCEPTION, inceptionStep, issuanceSteps, OOBIS, RECORDED, setupSteps } from "./group-scenario.ts";
import type { Step } from "./scenario.ts";

/** What a KERIpy peer needs before steps 7 to 9 can run. */
export const KERIPY_MEMBER_MISSING: readonly string[] = [
  "a control server for `kli` beside the Tufa one (a Python HTTP service in the KERIpy image over the keri-interop-keripy and keri-interop-venvs volumes, run through scripts/ci/run-keripy-cli.py with its own HOME), started and published by browser-wallet-servers.sh",
  "a KERIpy profile that can join a v2 group: the lane's witness is the `main` profile, whose Poster forwards a v2 member's proposal in a v1 /fwd that its v2 witness cannot store (the mixed-group interop tests run v2 groups only on the default and candidate profiles)",
  "a verified path for a KERIpy member to use the keri-ts mailbox host: its poller does not submit its KEL, so the host must learn the KEL by OOBI first, and `kli` mailbox add against a keri-ts provider is not exercised anywhere",
  "browser-side OOBI resolution of the newcomer and a rotation step that passes the new member list (`groups.rotate` already takes `smids`; no page step does)",
  "the newcomer-side evidence read: `kli vc registry root receive --listen` output or a `kli` state dump, through the new control server",
];

/** Fail the scaffold step with the list of what is missing. */
function scaffold(what: string): never {
  throw new Error(`SCAFFOLD, not implemented: ${what}\nMissing:\n- ${KERIPY_MEMBER_MISSING.join("\n- ")}`);
}

const PROVISIONED = "7 KERIpy member provisioned on the shared mailbox (scaffold)";
const ROTATED = "8 group rotation adds the KERIpy member (scaffold)";

export const steps: Step[] = [
  ...setupSteps,
  inceptionStep([OOBIS], (f) => [f.a.pre, f.member], "2"),
  ...issuanceSteps({ withB: false, reload: false }),
  { name: PROVISIONED, needs: [RECORDED], run: () => scaffold("KERIpy member provisioning") },
  { name: ROTATED, needs: [PROVISIONED], run: () => scaffold("group rotation adding the KERIpy member") },
  {
    name: "9 the newcomer holds the re-sealed root and takes part in the next group event (scaffold)",
    needs: [ROTATED, INCEPTION],
    run: () => scaffold("newcomer root copy and participation"),
  },
];
