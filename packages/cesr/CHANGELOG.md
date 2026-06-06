# cesr-ts

## 0.7.0

### Minor Changes

- 7c5fa42: BREAKING CLI CHANGE: replace the CESR package's executable surface with the
  package-level `tephra` CLI. The annotation workflow is now `tephra annotate`,
  validation is available as `tephra validate`, and parser benchmarking is
  available as `tephra bench`.

### Patch Changes

- 87940ec: Move CESR build, version, and table-generation support into checked shared
  scripts instead of inline release logic.

## 0.6.0

### Minor Changes

- Fix CESR non-native fallback payload handling and normalize parser/runtime surfaces used by KERI delegation interop flows.

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

- Working on the release management system
