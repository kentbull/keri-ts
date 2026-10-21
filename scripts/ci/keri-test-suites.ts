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
      "test/unit/app/runtime/abortable.test.ts",
      "test/unit/app/transport/byte-source.test.ts",
      "test/unit/app/transport/cesr-egress.test.ts",
      "test/unit/app/delivery/replay-source.test.ts",
      "test/unit/app/delivery/reply-streams.test.ts",
      "test/unit/app/witness/witness-transport.test.ts",
      "test/unit/app/transport/httping.test.ts",
      "test/unit/app/transport/http-client.test.ts",
      "test/unit/interop/keripy-runtime.test.ts",
      "test/unit/app/mailbox/mailbox-sse.test.ts",
      "test/unit/app/queries/query-delivery.test.ts",
      "test/unit/app/transport/cesr-http.test.ts",
      "test/unit/app/identity/challenge/challenge-generate.test.ts",
      "test/unit/app/cli/cli-context.test.ts",
      "test/unit/app/identity/configing.test.ts",
      "test/unit/app/runtime/cue-runtime.test.ts",
      "test/unit/app/delivery/poster-queue.test.ts",
      "test/unit/app/exchanges/exchange-messaging.test.ts",
      "test/unit/app/exchanges/exchanging.test.ts",
      "test/unit/app/exchanges/exchanging-proofs.test.ts",
      "test/unit/app/exchanges/exchanging-payload.test.ts",
      "test/unit/app/exchanges/exchanging-nests.test.ts",
      "test/unit/app/exchanges/essr.test.ts",
      "test/unit/app/bootstrap/oobi-local-state.test.ts",
      "test/unit/app/multisig/group-members.test.ts",
      "test/unit/app/multisig/grouping.test.ts",
      "test/unit/app/multisig/grouping-nests.test.ts",
      "test/unit/app/credentials/tel-publishing.test.ts",
      "test/unit/app/credentials/credential-import.test.ts",
      "test/unit/app/ipex/ipex-credentialing.test.ts",
      "test/unit/app/ipex/ipexing.test.ts",
      "test/unit/app/ipex/ipex-v2.test.ts",
      "test/unit/app/ipex/ipex-di2i.test.ts",
      "test/unit/app/ipex/ipex-not.test.ts",
      "test/unit/app/protocol/nested-frame-boundary.test.ts",
      "test/unit/app/protocol/message-admission.test.ts",
      "test/unit/app/cli/notifications-cli.test.ts",
      "test/unit/app/cli/init-credentials.test.ts",
      "test/unit/app/cli/init-terminal.test.ts",
      "test/unit/app/cli/oobi-clean-cli.test.ts",
      "test/unit/app/notifications/notifying.test.ts",
      "test/unit/app/identity/organizing.test.ts",
      "test/unit/app/protocol/parsering-essr.test.ts",
      "test/unit/app/protocol/parsering-vdr.test.ts",
      "test/unit/app/cli/parsing.test.ts",
      "test/unit/app/protocol/mailbox-admin.test.ts",
      "test/unit/app/protocol/oobi.test.ts",
      "test/unit/app/queries/query-replies.test.ts",
      "test/unit/app/queries/query-transport.test.ts",
      "test/unit/app/queries/querying.test.ts",
      "test/unit/app/protocol/reactor.test.ts",
      "test/unit/app/protocol/reactor-turn.test.ts",
      "test/unit/app/runtime/runtime-responder.test.ts",
      "test/unit/app/runtime/runtime-store-ownership.test.ts",
      "test/unit/app/cli/sign-verify.test.ts",
      "test/unit/app/credentials/verifying.test.ts",
      "test/unit/app/witness/witness-auth.test.ts",
      "test/unit/did/keri.test.ts",
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
  "interop-reference-profiles": {
    files: [
      "test/integration/app/interop-reference-profile.test.ts",
      "test/integration/app/interop-mixed-group-cli.test.ts",
      "test/integration/app/interop-group-tel-api.test.ts",
      "test/integration/app/interop-messengers.test.ts",
    ],
  },
  "interop-essr-exchange": {
    files: ["test/integration/app/interop-essr-exchange.test.ts"],
  },
  "interop-essr-storage": {
    // Actual pinned-main Baser only; legacy protocol traffic belongs to interop-essr-exchange.
    files: ["test/integration/app/interop-essr-storage.test.ts"],
  },
  "interop-acdc-deep": {
    // Cold files share a mutable pinned KERIpy venv; run them in separate sequential processes.
    files: [
      "test/integration/app/interop-acdc-mixed-chain-i2i.test.ts",
      "test/integration/app/interop-acdc-mixed-chain-ni2i.test.ts",
    ],
  },
  "interop-ipex-disclosure": {
    files: [
      "test/integration/app/interop-ipex-disclosure.test.ts",
      "test/integration/app/interop-native-registry.test.ts",
      "test/integration/app/interop-ipex-progressive.test.ts",
      "test/integration/app/interop-ipex-edge-refusals.test.ts",
      "test/integration/app/interop-ipex-conversation-refusals.test.ts",
      "test/integration/app/interop-ipex-presentation.test.ts",
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
      "test/unit/app/identity/challenge/challenge-direct-runtime.test.ts",
      "test/unit/app/delivery/forwarding.test.ts",
      "test/unit/app/mailbox/mailbox-director-lifecycle.test.ts",
      "test/unit/app/mailbox/mailbox-poller-runtime.test.ts",
      "test/unit/app/mailbox/mailbox-runtime.test.ts",
      "test/unit/app/bootstrap/schema-oobi.test.ts",
    ],
  },
  "runtime-slow": {
    files: [
      "test/unit/app/identity/challenge/challenge-mailbox-runtime.test.ts",
      "test/unit/app/bootstrap/oobi-runtime.test.ts",
      "test/unit/app/queries/query-runtime.test.ts",
      "test/unit/app/mailbox/mailbox-runtime-slow.test.ts",
      "test/unit/app/bootstrap/oobi-mailbox-runtime.test.ts",
      "test/unit/app/witness/witness-runtime.test.ts",
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
      "test/unit/acdc/regeventing.test.ts",
      "test/unit/core/deck.test.ts",
      "test/unit/core/eventing.test.ts",
      "test/unit/core/kevery-receipt.test.ts",
      "test/unit/core/kram-policy.test.ts",
      "test/unit/core/logger.test.ts",
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
      "test/integration/app/ipex-group-cli.test.ts",
      "test/unit/app/cli/cli.test.ts",
      "test/unit/app/multisig/group-signing.test.ts",
      "test/unit/app/identity/habbing.test.ts",
      "test/unit/app/identity/habery-acquisition.test.ts",
      "test/unit/app/cli/incept.test.ts",
    ],
  },
  "app-stateful-b": {
    files: [
      "test/unit/app/cli/compat-list-aid.test.ts",
      "test/unit/app/cli/export.test.ts",
      "test/unit/app/cli/list-aid.test.ts",
    ],
  },
  "app-fast-isolated": {
    files: [
      "test/unit/app/multisig/endpoint-roleing.test.ts",
    ],
  },
  "core-fast-b": {
    jobs: 2,
    files: [
      "test/unit/core/dispatch.test.ts",
      "test/unit/core/kever.test.ts",
      "test/unit/core/kevery-query.test.ts",
      "test/unit/core/kram-auth.test.ts",
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
      "test/unit/db/keeping-aeid.test.ts",
      "test/unit/db/koming.test.ts",
      "test/unit/db/mailboxing.test.ts",
      "test/unit/db/reger.test.ts",
      "test/unit/db/registry-evidence.test.ts",
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
      "test/integration/app/interop-oobi-store.test.ts",
      "test/integration/app/interop-oobi-bootstrap.test.ts",
    ],
  },
  "interop-mailbox": {
    files: [
      "test/integration/app/interop-mailbox-kli-tufa.test.ts",
    ],
  },
  "interop-kram": {
    files: [
      "test/integration/app/interop-kram-mailbox.test.ts",
      "test/integration/app/interop-ipex-presentation-mailbox.test.ts",
      "test/integration/app/interop-ipex-mailbox.test.ts",
      "test/integration/app/interop-ipex-mailbox-pairwise.test.ts",
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
export const interop = [
  "interop-reference-profiles",
  "interop-essr-storage",
  "interop-essr-exchange",
  "interop-parity",
  "interop-keystore-parity",
  "interop-keystore-storage",
  "interop-oobi-bootstrap",
  "interop-acdc-extended",
  "interop-acdc-deep",
  "interop-ipex-disclosure",
  "interop-delegation",
  "interop-witness-main",
  "interop-witness-cli",
  "interop-mailbox",
  "interop-kram",
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
