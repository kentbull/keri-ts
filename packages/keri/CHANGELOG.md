# keri-ts

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
