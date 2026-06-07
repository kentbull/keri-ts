# keri-ts

## 0.8.0

### Minor Changes

- 6286759: Release the ACDC/TEL/IPEX implementation as v0.8.0 across Tufa, CESR, and
  KERI packages, including the end-to-end issuer, holder, verifier, KERIpy
  interop, credential-chain, revocation, and saidification workflows.

### Patch Changes

- b7fb4e0: Add registry-backed VC and IPEX CLI operations for schema import, registry
  management, credential create/list/export/import/revoke, and single-sig
  grant/admit artifact workflows.
- fd9dabd: Add registry and credential issuance orchestration for registry-backed ACDCs,
  including `Regery`, `Registry`, `Registrar`, `Credentialer`, credential
  serialization helpers, and a verifier-index-backed credential wallet surface.
- 9bd9030: Fix ACDC credential presentation proof serialization for KLI-issued
  credentials, add a separate Sally-style `tufa hook demo` webhook target, and
  cover KLI issuer -> Tufa holder -> Tufa verifier interop through the public
  CLI workflow.
- b0db7b1: Add KLI-holder and mixed KLI/Tufa credential-chain interop support, including
  bounded `tufa ipex poll` mailbox processing, KERIpy-compatible forwarded ACDC
  support payload handling, bidirectional revocation propagation, and I2I/NI2I
  mixed-chain verifier gates with a KERIpy IPEX message-length preflight for the
  known local `serializeMessage` quadlet-alignment bug.
- 1f82a5d: Add KERIpy-shaped multisig EXN coordination for registry inception, issue,
  revoke, replies, and wrapped IPEX proposals, including runtime registration,
  lead election, and `ipex join --auto` approval support.
- 053c1fa: Add KERIpy-parity ACDC v2 messaging builders for registry, map, attribute,
  aggregate, and section messages, and align CESR-native mapper/string and direct
  native-serder hydration behavior with KERIpy vectors.
- b9abf12: Add the ACDC/VDR foundation: credential mailbox routing, IPEX route handlers,
  schema data OOBI resolution and hosting, parser VDR dispatch seams, and the
  KERIpy-shaped Reger storage owner.
- 580bf65: Add a Sally-like verifier agent with durable verifier cue storage, grant-driven
  presentation processing, revocation webhook handling, schema-validator config
  support, and the `tufa verifier run` command.
- f52dd7e: Add the registry-backed TEL and ACDC verifier core with KERIpy-compatible TEL
  state transitions, verifier save indexes, missing registry/schema/chain
  escrows, chain operator defaults, and schema payload validation.
- 205a9e9: Persist verifier revocation acknowledgements separately from issuance
  acknowledgements and rescan saved TEL state so `tufa verifier run --once`
  emits revocation webhooks correctly after credential imports in prior CLI
  processes.
- 9bd9030: Add a KLI-compatible `tufa saidify` command for in-place JSON SAD
  saidification, including schema `$id` support and KLI output parity coverage.

## 0.7.0

### Minor Changes

- Align KERI and Tufa with the 0.7.0 release train after the CESR CLI break so generated npm artifacts depend on the 0.7.0 package line.

### Patch Changes

- 87940ec: Move KERI npm build, LMDB setup discovery, version generation, and
  installed-artifact checks into checked shared scripts.
- 87940ec: Harden the `keri-ts` npm artifact by deriving DNT export targets from the
  generated package output and smoke-checking packed and installed package paths.
- 87940ec: Honor temp keeper derivation during habitat inception and add KERI test lane
  timing output for easier test-speed regression tracking.
- 1c4fb92: Add injectable runtime clock, HTTP, and mailbox polling seams so runtime tests
  can exercise protocol behavior without repeated real sockets and sleeps. Convert
  mailbox poller, mailbox admin, and witness runtime coverage to cheaper
  fixtures while preserving representative live transport tests.

## 0.6.0

### Minor Changes

- Complete delegation communication support for interop release readiness, including notification-backed delegation flows, mailbox/reply processing fixes, and npm artifact build validation needed for staged publication.

## 0.5.0

### Minor Changes

- b5a93cb: Finished init and incept support

## 0.4.0

### Minor Changes

- DB layer impl buildout with tests and --loglevel for logs

## 0.3.1

### Patch Changes

- Colored CESR!

## 0.3.0

### Minor Changes

- Finish CESR 1.0/2.0 feature parity with KERIpy and add tests

## 0.2.3

### Patch Changes

- Added new version release strategy and drift check to keep it in sync with
  cesr-ts
