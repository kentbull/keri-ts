# LMDBer Meaningful Test Plan

## Summary

- No public API changes; this is a test-suite restructuring and deepening plan.
- `lmdber.ts` source docs are now organized by storage family and explicitly
  distinguish KERIpy parity methods from `keri-ts`-only extensions; this test
  plan should follow that same taxonomy.
- Replace the current broad parity file with focused family-based tests and keep
  a much smaller oracle-parity file for known tricky iterator orderings.
- Success criterion: every public `LMDBer` method has a focused behavioral test,
  or is explicitly covered as a thin wrapper inside the related family test.
- Keep helper-export tests (`openLMDB`, `createLMDBer`, `clearDatabaserDir`)
  separate; the real gap is the `LMDBer` class surface.

## Test Structure

- Add `lmdber-lifecycle.test.ts` for `reopen`, `close`, `getVer`, `setVer`,
  `openDB`, and property/lifecycle behavior.
- Add `lmdber-plain.test.ts` for plain K/V and top-branch helpers.
- Add `lmdber-on.test.ts` for `On*` ordinal-key helpers.
- Add `lmdber-ioset.test.ts` for `IoSet*` and `OnIoSet*`.
- Add `lmdber-dup.test.ts` for `Dup*`, `IoDup*`, and `OnIoDup*`.
- Keep the current focused regression floors for dupsort branch behavior, `Dup*`
  lexicographic retrieval, `IoDup*` insertion ordering, and `OnIoSet*` smoke
  coverage, but demote them to baseline regressions rather than primary
  documentation.
- Keep a trimmed `lmdber-core-parity.test.ts` only for KERIpy oracle vectors and
  especially tricky backward/mixed-key scans.

## Function-by-Function Tests

### Lifecycle, Version, And Factories

- `reopen` / `close`: test fresh open stamps version, `close()` clears
  `opened/env`, `reopen()` preserves data on existing path, and readonly reopen
  returns `false` on a missing DB path without leaving a half-open env.
- `getVer` / `setVer`: test default version on new temp DB, overwrite to a
  custom version, and `getVer()` on an open DB with missing/malformed value
  returns `null` instead of throwing.
- `openDB`: test plain vs dupsort behavior through writes, proving the named DB
  config actually changes duplicate semantics.

### Plain K/V And Branch Helpers

- `putVal`: test write-once semantics, second write returns `false`, and
  neighbor keys are unaffected.
- `setVal`: test overwrite semantics and returned `true` on both create and
  replace.
- `getVal`: test missing returns `null`, present returns raw bytes, and closed
  env still throws the existing guard error.
- `delVal`: test plain-key delete, missing-key `false`, and dupsort single-value
  delete when `val` is supplied.
- `cnt` / `cntAll`: test plain DB counts, dupsort counts include duplicates, and
  `cntAll` is just the parity alias.
- `cntTop` / `getTopItemIter` / `delTop`: test empty prefix means whole DB,
  mixed-key iteration stops exactly at branch boundary, dupsort counts
  duplicates, and delete returns `false` when branch is absent.

### Ordinal-Key Family (`On*`)

- `putOnVal`: test write-at-explicit-ordinal and idempotent `false` on second
  write to same `onKey`.
- `pinOnVal`: test overwrite at explicit ordinal and isolation from neighboring
  ordinals.
- `appendOnVal`: test empty branch starts at `0`, append uses highest existing
  ordinal rather than count, lexicographically later foreign keys do not confuse
  tail lookup, and bad args throw.
- `getOnVal` / `getOnItem`: test exact ordinal fetch, missing ordinal returns
  `null`, and tuple shape preserves logical key plus numeric ordinal.
- `remOn`: test single-ordinal delete and missing delete returns `false`.
- `remOnAll`: test delete-from-ordinal-forward, missing branch returns `false`,
  and empty key wipes whole DB because TypeScript explicitly supports that path
  here.
- `cntOnAll`: test non-zero start ordinal and empty-key whole-DB behavior.
- `getOnTopItemIter`: test top-prefix iteration yields decoded `(key,on,val)`
  triples and stops at boundary.
- `getOnAllItemIter`: test per-key scan from a starting ordinal and empty-key
  full scan across multiple prefixes.

### Synthetic Insertion-Ordered Set Family (`IoSet*`)

- `putIoSetVals`: test first-seen order is preserved, duplicate inputs are
  deduped, mixed existing/new input appends only new values, and all-preexisting
  input returns `false`.
- `pinIoSetVals`: test full replacement resets the logical set to only the
  supplied unique values in order.
- `addIoSetVal`: test absent value appends once, existing value returns `false`,
  and after deleting a middle member the next insert uses a new suffix instead
  of recycling holes.
- `getIoSetItemIter`: test `ion` offset skips earlier members and stops when the
  effective key changes.
- `getIoSetLastItem`: test it returns the last logical member, not the
  lexicographically largest value.
- `remIoSet`: test delete-all for one effective key and `false` when key is
  absent.
- `remIoSetVal`: test delete-one-by-value, `false` when value absent, and `null`
  path delegates to whole-key deletion.
- `cntIoSet`: test counts from `ion=0` and from a non-zero `ion`.
- `getTopIoSetItemIter`: test branch iteration strips hidden suffixes and
  preserves logical keys.
- `getIoSetLastItemIterAll` / `getIoSetLastIterAll`: test one last member per
  effective key, ordered by effective key, with both empty and non-empty start
  keys.

### TS-Only Ordinal Synthetic Set Family (`OnIoSet*`)

- `putOnIoSetVals`: TypeScript-only extension. Test wrapper semantics at one
  ordinal and isolation from another ordinal of the same base key.
- `pinOnIoSetVals`: TypeScript-only extension. Test replacement for one ordinal
  does not mutate siblings.
- `appendOnIoSetVals`: TypeScript-only extension. Test empty branch starts at
  ordinal `0`, later append uses max existing ordinal, duplicate inputs are
  deduped before write, and bad args throw.
- `addOnIoSetVal`: TypeScript-only extension. Test add-one semantics through the
  ordinal wrapper.
- `getOnIoSetItemIter` / `getOnIoSetLastItem`: TypeScript-only extension. Test
  per-ordinal scans and last-item lookup within one ordinal group.
- `remOnIoSetVal` / `remOnAllIoSet`: TypeScript-only extension. Test delete-one
  member at one ordinal, delete-all ordinals from a start point, empty-key
  whole-DB delete path, and missing delete `false`.
- `cntOnIoSet` / `cntOnAllIoSet`: TypeScript-only extension. Test per-ordinal
  count, all-ordinals count from a start ordinal, and empty-key count delegates
  to whole DB.
- `getOnTopIoSetItemIter` / `getOnAllIoSetItemIter`: TypeScript-only extension.
  Test mixed-key boundary handling and full-DB scan when key is empty.
- `getOnAllIoSetLastItemIter`: TypeScript-only extension. Test “last member per
  ordinal” grouping with sparse ordinals, proving it groups by ordinal not by
  every physical entry.
- `getOnAllIoSetItemBackIter` / `getOnAllIoSetLastItemBackIter`: TypeScript-only
  extension. Keep focused reverse-order vectors and add one filter test showing
  `on` is an upper bound, not an exact-match selector.

### Native Dupsort Duplicate Family (`Dup*`)

- `putVals`: test dupsort values come back in lexicographic order, and mixed
  input with one preexisting value returns `false` but still stores the new
  unique values.
- `addVal`: test one-value duplicate insert succeeds once and then returns
  `false`.
- `getVals` / `getValsIter` / `getValLast` / `cntVals`: test lexicographic
  duplicate ordering, iterator order, last-dup lookup, and empty-key zero/empty
  results.
- `delVals`: test delete-all duplicates at a key and `false` when key absent.

### Insertion-Ordered Duplicate Family (`IoDup*`)

- `putIoDupVals`: test stripped values preserve insertion order even when
  lexical order would differ, mixed existing/new input appends after the last
  proem ordinal, and all-preexisting input returns `false`.
- `addIoDupVal`: test idempotent single-value add on insertion-ordered
  duplicates.
- `getIoDupVals` / `getIoDupValsIter` / `getIoDupValLast`: test proem is
  invisible to callers and last means last inserted, not lexicographically last
  raw bytes.
- `delIoDupVals` / `delIoDupVal` / `cntIoDups`: test delete-all, delete-one by
  stripped value, and count after middle deletion.
- `getTopIoDupItemIter`: test branch iteration strips proems and preserves
  duplicate order within each key.

### Ordinal Insertion-Ordered Duplicate Family (`OnIoDup*`)

- `putOnIoDupVals`: TypeScript-only convenience. Test bulk insertion-ordered
  duplicates at a specific ordinal and isolation across ordinals.
- `addOnIoDupVal`: test insertion-ordered duplicates at a specific ordinal and
  isolation across ordinals.
- `appendOnIoDupVal`: test it creates a new ordinal containing one value, rather
  than appending another duplicate onto the current ordinal.
- `getOnIoDupVals` / `getOnIoDupValsIter` / `getOnIoDupLast`: TypeScript-only
  conveniences. Test stripped values, exact-ordinal scans, and last duplicate at
  one ordinal.
- `getOnIoDupLastValIter` / `getOnIoDupLastItemIter`: test one last duplicate
  per ordinal, grouped and stripped.
- `delOnIoDups` / `delOnIoDupVal` / `cntOnIoDups`: test delete-all at one
  ordinal, delete-one stripped value at one ordinal, and count isolation across
  ordinals. `cntOnIoDups` is a TypeScript-only convenience.
- `getOnIoDupItemIterAll` / `getOnIoDupIterAll`: test full scan from a starting
  ordinal with mixed keys, proving stripped values and branch boundaries.
- `getOnIoDupItemBackIter` / `getOnIoDupValBackIter`: keep exact KERIpy oracle
  vectors for whole-DB and filtered scans, because reverse ordering is easy to
  regress and hard to reason about from implementation alone.

## Assumptions And Defaults

- Property getters `name`, `base`, `opened`, `temp`, and `path` only need
  incidental coverage inside lifecycle tests; they do not need standalone specs.
- The current representation sweep should be reduced to a tiny smoke test or
  removed once the focused tests exist; keeping it large is wasted maintenance.
- Where TypeScript currently diverges from KERIpy around empty-key or `null`
  behavior, do not lock that behavior in casually; either decide parity vs
  TypeScript-local semantics first, or mark those cases as explicit
  TODO/parity-decision tests.
- `OnIoSet*` is now an explicitly documented `keri-ts` extension family, and the
  exact-ordinal `putOnIoDupVals` / `getOnIoDupVals*` / `getOnIoDupLast` /
  `cntOnIoDups` helpers should also be treated as TypeScript-local convenience
  surface rather than KERIpy LMDBer parity surface.
- Wrapper methods should usually be covered in their own short tests, but they
  can share fixtures with the underlying family so the suite stays readable.
