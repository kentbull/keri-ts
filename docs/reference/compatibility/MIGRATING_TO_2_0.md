# Breaking changes for 2.0.0

The release changes library APIs and private storage formats. KERI/ACDC/CESR
protocol interoperability remains required. Older keri-ts API and private-store
compatibility is not provided. This inventory will be completed and checked
against published 1.0.0 before final release qualification.

## ESSR evidence

- `PayloadArchive` and `PreparedPayload` are removed from the database exports.
  Exchange evidence is stored directly in LMDB's KERIpy-shaped `essrs.` table.
- `Baser.openPayloads`, archive recovery/lifecycle integration, `savePlaintext`
  and `getPlaintext` are removed. There is no automatic durable plaintext store.
- `Baser.getEssrs(said)` is synchronous and returns ordered Texters. The table
  uses ordinal keys rather than value-set operations; equal fragments at
  different positions are retained. Use the evidence operations rather than
  applying set semantics to payload bytes.
- Exchange metadata retains `gvrsn` directly, without an archive ownership record.
  Private file-reference, ownership, plaintext and nested-staging tables are gone.
- `PayloadStore.claimStage` is removed with the unused archive transfer mechanism.
  Recipient transient-file APIs are addressed by the following ESSR refactor.
