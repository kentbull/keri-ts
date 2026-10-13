/** Explicit file ownership: every KERI test belongs to exactly one suite. */
export interface TestSuite {
  /** Files relative to packages/keri; never per-test name filters. */
  files: readonly string[];
  /** Proven file-level parallelism; omitted suites retain separate child processes. */
  jobs?: number;
  /** Explicit opt-in values for manual endurance cases. */
  env?: Record<string, string>;
}

/** Keep native/global-state isolation; batch only suites already run with two workers. */
export const suites: Record<string, TestSuite> = {
  "app-fast-parallel": {
    jobs: 2,
    files: [
      "test/integration/app/db-dump.test.ts",
      "test/unit/app/abortable.test.ts",
      "test/unit/app/byte-source.test.ts",
      "test/unit/app/cesr-egress.test.ts",
      "test/unit/app/replay-source.test.ts",
      "test/unit/app/reply-streams.test.ts",
      "test/unit/app/witness-transport.test.ts",
      "test/unit/app/httping.test.ts",
      "test/unit/app/mailbox-sse.test.ts",
      "test/unit/app/query-deliveries.test.ts",
      "test/unit/app/cesr-http.test.ts",
      "test/unit/app/challenge-generate.test.ts",
      "test/unit/app/cli-context.test.ts",
      "test/unit/app/configing.test.ts",
      "test/unit/app/cue-runtime.test.ts",
      "test/unit/app/exchanging.test.ts",
      "test/unit/app/exchanging-payload.test.ts",
      "test/unit/app/exchanging-nests.test.ts",
      "test/unit/app/essr.test.ts",
      "test/unit/app/oobi-local-state.test.ts",
      "test/unit/app/group-members.test.ts",
      "test/unit/app/grouping.test.ts",
      "test/unit/app/grouping-nests.test.ts",
      "test/unit/app/ipex-credentialing.test.ts",
      "test/unit/app/ipexing.test.ts",
      "test/unit/app/nested-frame-boundary.test.ts",
      "test/unit/app/notifications-cli.test.ts",
      "test/unit/app/notifying.test.ts",
      "test/unit/app/parsering-essr.test.ts",
      "test/unit/app/parsering-vdr.test.ts",
      "test/unit/app/parsing.test.ts",
      "test/unit/app/protocol/mailbox-admin.test.ts",
      "test/unit/app/protocol/oobi.test.ts",
      "test/unit/app/query-replies.test.ts",
      "test/unit/app/query-transport.test.ts",
      "test/unit/app/querying.test.ts",
      "test/unit/app/reactor.test.ts",
      "test/unit/app/reactor-turn.test.ts",
      "test/unit/app/runtime-responder.test.ts",
      "test/unit/app/sign-verify.test.ts",
      "test/unit/app/verifier-agent.test.ts",
      "test/unit/app/verifying.test.ts",
      "test/unit/app/witness-auth.test.ts",
      "test/unit/did/webs.test.ts",
    ],
  },
  "interop-parity": {
    files: [
      "test/integration/app/interop-acdc-kli-tufa.test.ts",
      "test/integration/app/interop-annotate-kli-tufa.test.ts",
      "test/integration/app/interop-kli-tufa.test.ts",
      "test/integration/app/interop-saidify-kli-tufa.test.ts",
    ],
  },
  "interop-acdc-deep": {
    jobs: 2,
    files: [
      "test/integration/app/interop-acdc-mixed-chain-i2i.test.ts",
      "test/integration/app/interop-acdc-mixed-chain-ni2i.test.ts",
    ],
  },
  "interop-acdc-extended": {
    files: [
      "test/integration/app/interop-acdc-tufa-kli-holder.test.ts",
    ],
  },
  "interop-delegation": {
    files: [
      "test/integration/app/interop-delegation-group-kli-tufa.test.ts",
      "test/integration/app/interop-delegation-kli-tufa.test.ts",
    ],
  },
  "interop-did-webs": {
    files: [
      "test/integration/app/interop-did-webs-resolver-matrix.test.ts",
    ],
  },
  "interop-witness-main": {
    files: [
      "test/integration/app/interop-witness-kli-tufa.test.ts",
    ],
  },
  "runtime-medium": {
    files: [
      "test/integration/app/sign-query-rotate-cli.test.ts",
      "test/integration/app/tufa-delegation-group.test.ts",
      "test/unit/app/challenge-direct-runtime.test.ts",
      "test/unit/app/forwarding.test.ts",
      "test/unit/app/mailbox-admission.test.ts",
      "test/unit/app/mailbox-director-lifecycle.test.ts",
      "test/unit/app/mailbox-poller-runtime.test.ts",
      "test/unit/app/mailbox-runtime.test.ts",
      "test/unit/app/schema-oobi.test.ts",
    ],
  },
  "runtime-slow": {
    files: [
      "test/unit/app/challenge-mailbox-runtime.test.ts",
      "test/unit/app/oobi-runtime.test.ts",
      "test/unit/app/query-runtime.test.ts",
      "test/unit/app/mailbox-runtime-slow.test.ts",
      "test/unit/app/oobi-mailbox-runtime.test.ts",
      "test/unit/app/witness-runtime.test.ts",
    ],
  },
  "interop-witness-cli": {
    files: [
      "test/integration/app/witness-cli.test.ts",
    ],
  },
  "core-fast-a": {
    jobs: 2,
    files: [
      "test/unit/acdc/messaging.test.ts",
      "test/unit/core/deck.test.ts",
      "test/unit/core/eventing.test.ts",
      "test/unit/core/kevery-receipt.test.ts",
      "test/unit/core/messages.test.ts",
      "test/unit/core/protocol-eventing.test.ts",
      "test/unit/core/protocol-serialization.test.ts",
      "test/unit/core/protocol-vdr-eventing.test.ts",
      "test/unit/core/records.test.ts",
      "test/unit/core/roles.test.ts",
      "test/unit/core/scheming.test.ts",
    ],
  },
  "app-stateful-a": {
    files: [
      "test/unit/app/cli.test.ts",
      "test/unit/app/group-signing.test.ts",
      "test/unit/app/habbing.test.ts",
      "test/unit/app/habery-acquisition.test.ts",
      "test/unit/app/incept.test.ts",
    ],
  },
  "app-stateful-b": {
    files: [
      "test/unit/app/compat-list-aid.test.ts",
      "test/unit/app/export.test.ts",
      "test/unit/app/list-aid.test.ts",
    ],
  },
  "app-fast-isolated": {
    files: [
      "test/unit/app/endpoint-roleing.test.ts",
    ],
  },
  "core-fast-b": {
    jobs: 2,
    files: [
      "test/unit/core/dispatch.test.ts",
      "test/unit/core/kever.test.ts",
      "test/unit/core/kevery-query.test.ts",
      "test/unit/core/routing.test.ts",
      "test/unit/core/witnesses.test.ts",
    ],
  },
  "db-fast": {
    jobs: 2,
    files: [
      "test/unit/db/basing.test.ts",
      "test/unit/db/core/keys.test.ts",
      "test/unit/db/core/lmdber-core-parity.test.ts",
      "test/unit/db/core/lmdber-dup.test.ts",
      "test/unit/db/core/lmdber-helpers.test.ts",
      "test/unit/db/core/lmdber-ioset.test.ts",
      "test/unit/db/core/lmdber-lifecycle.test.ts",
      "test/unit/db/core/lmdber-map-size.test.ts",
      "test/unit/db/core/lmdber-on.test.ts",
      "test/unit/db/core/lmdber-plain.test.ts",
      "test/unit/db/core/path-manager.test.ts",
      "test/unit/db/escrowing.test.ts",
      "test/unit/db/keeping.test.ts",
      "test/unit/db/koming.test.ts",
      "test/unit/db/mailboxing.test.ts",
      "test/unit/db/payload-archive.test.ts",
      "test/unit/db/payload-store.test.ts",
      "test/unit/db/reger.test.ts",
      "test/unit/db/subing.test.ts",
      "test/unit/vdr/credentialing.test.ts",
      "test/unit/vdr/eventing.test.ts",
    ],
  },
  "interop-keystore-parity": {
    files: [
      "test/integration/app/interop-keystore-parity.test.ts",
    ],
  },
  "interop-keystore-storage": {
    files: [
      "test/integration/app/interop-keystore-storage.test.ts",
    ],
  },
  "interop-oobi-bootstrap": {
    files: [
      "test/integration/app/interop-oobi-bootstrap.test.ts",
    ],
  },
  "interop-acdc-verifier": {
    files: [
      "test/integration/app/acdc-verifier-workflow.test.ts",
    ],
  },
  "interop-mailbox": {
    files: [
      "test/integration/app/interop-mailbox-kli-tufa.test.ts",
    ],
  },
  "manual-delegation": {
    env: { KERI_LONG_MULTISIG_DELEGATION: "1" },
    files: [
      "test/manual/multisig-delegation.test.ts",
    ],
  },
  "manual-witness-soak": {
    files: [
      "test/manual/witness-soak.test.ts",
    ],
  },
};

/** The required KERI CI coverage, reused by the local required-suite command. */
export const required = [
  "db-fast",
  "core-fast-a",
  "core-fast-b",
  "app-fast-parallel",
  "app-fast-isolated",
  "runtime-medium",
  "runtime-slow",
  "app-stateful-a",
  "app-stateful-b",
] as const;

/** Maintained external matrices: full includes DID Webs but excludes endurance sweeps. */
const interop = [
  "interop-parity",
  "interop-keystore-parity",
  "interop-keystore-storage",
  "interop-oobi-bootstrap",
  "interop-acdc-verifier",
  "interop-acdc-extended",
  "interop-acdc-deep",
  "interop-delegation",
  "interop-witness-main",
  "interop-witness-cli",
  "interop-mailbox",
  "interop-did-webs",
] as const;

/** Named sets share concrete suites without duplicating their file ownership. */
export const groups: Record<string, readonly string[]> = {
  ci: required,
  quality: [...required, "interop-parity"],
  fast: ["db-fast", "core-fast-a", "core-fast-b", "app-fast-parallel", "app-fast-isolated", "runtime-medium"],
  "core-fast": ["core-fast-a", "core-fast-b"],
  "app-fast": ["app-fast-parallel", "app-fast-isolated"],
  "interop-witness": ["interop-witness-main", "interop-witness-cli"],
  "extended-interop": interop,
  full: [...required, ...interop],
  qualification: [...required, ...interop, "manual-delegation", "manual-witness-soak"],
};
