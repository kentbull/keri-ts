# CESR test ownership

`deno task test:cesr` discovers the complete package test tree recursively. Small
benchmark API/corpus cases, large-input regression boundaries, and real parser
cancellation tests stay in this functional suite. Throughput/RSS size sweeps belong
to the separately selected benchmark qualification; these tests make no performance
claim.

| Owner                                                            | Contract                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit/primitives/`                                               | Class semantics, direct text/binary readers, cryptographic and disclosure behavior                                                                                        |
| `unit/parser/`                                                   | Stream lifecycle, frame/enclosure boundaries and order, attachments/count units/hydration/ESSR, genus scope, partitions, external vectors, cursor and Effection ownership |
| `unit/serder/`                                                   | KERI/ACDC construction, native and non-native serialization, version detection                                                                                            |
| `unit/tables/`                                                   | Counter registries, supported versions, generated codex subsets, dispatch coverage, vocabulary                                                                            |
| `unit/annotate.test.ts`, `unit/cli.test.ts`                      | Annotation round trips and CLI routing                                                                                                                                    |
| `unit/benchmark-corpus.test.ts`, `unit/parser-benchmark.test.ts` | Fast corpus construction and benchmark API checks                                                                                                                         |
| `unit/large-input.test.ts`, `unit/payload.test.ts`               | Large conversion regressions and payload ownership/admission                                                                                                              |

Fixture bytes and their historical KERIpy provenance remain under `fixtures/`.
The shared `fixtures/parser-test-helpers.ts` also serves KERI annotation interop.
Its mutation assertion checks error-class names only, not accepted-frame
correctness, rejection completeness, or memory/time bounds. The test-only native
segment renderer was removed; the fixture breakdown used by map builders remains.

## Consolidation record

A smaller registration count is not a coverage objective. The following twelve
registrations were removed after preserving unique production assertions:

| Previous test                                                                | Retained coverage or removal reason                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `primitives/counter.test.ts`: baseline SHA equals a repeated literal         | Removed metadata tautology; canonical v1/v2 external wire vectors and provenance remain                                                                                              |
| `counter-version-registry.test.ts`: both registries have only minor key zero | Supported-minor acceptance/rejection and real codex dispatch remain in `tables/counter-registry.test.ts` and `tables/dispatch-coverage.test.ts`                                      |
| `serder-native.test.ts`: explanatory fixture segment summary                 | Removed test-only renderer assertion; `serder/native.test.ts` still verifies exact native SAD/bytes in both domains. The breakdown builder remains available to map fixtures         |
| `primitives-native.test.ts`: Verser/Ilker/Labeler smoke                      | Their class owners retain direct semantic parsing and independent vectors                                                                                                            |
| `primitives-native.test.ts`: Mapper smoke                                    | `primitives/mapper.test.ts` retains populated map fields, native bodies, nested values and syntax failures                                                                           |
| `primitives-native.test.ts`: Aggor smoke                                     | The valid populated verifier/digest list moved into `primitives/aggor.test.ts`, retaining group kind/items and exact qualified-wire assertions                                       |
| `qb2.test.ts`: Matter smoke                                                  | `primitives/matter.test.ts` directly compares `parseMatterFromText` and `parseMatterFromBinary` across canonical vectors                                                             |
| `qb2.test.ts`: Counter/Indexer smoke                                         | `primitives/counter.test.ts` already compares both public readers across v1/v2 vectors; `primitives/indexer.test.ts` now directly compares both readers across its canonical vectors |
| `qb2.test.ts`: binary attachment smoke                                       | `parser/count-units.test.ts` preserves text/binary controller signatures and stronger v1-item/v2-length assertions                                                                   |
| `parser.test.ts`: two native bodies split at the body boundary               | `parser/chunk-completion.test.ts` checks that the following body completes an open attachment set before EOF                                                                         |
| `parser-flush.test.ts`: first pending-frame flush                            | `parser/flush.test.ts` checks body kind/ilk, one EOF emission, and repeated iterator completion                                                                                      |
| `parser-flush.test.ts`: first truncated-attachment flush                     | `parser/flush.test.ts` preserves no premature frame, exact ShortageError, and a finished iterator after rejection                                                                    |

The duplicate SHA assertion in `primitives/registry.test.ts` was also removed;
its parsing and registry-family assertions remain.

Protocol cases from the former hardening suites remain: enclosure/domain parity moved to
`parser/enclosure-parity.test.ts`; wrapper selector cases to
`parser/wrapper-version.test.ts`; heterogeneous ordering to
`parser/mixed-stream.test.ts`; terminal shortages to `parser/flush.test.ts`;
invalid enclosure/native-prefix cases to `parser/enclosure-errors.test.ts`;
seeded partitions and the limited
mutation crash check to `parser/partitions.test.ts`; independent external vectors
to `parser/external-corpus.test.ts`; codex sentinels to
`tables/counter-registry.test.ts`; annotation semantics to `unit/annotate.test.ts`.

MapBody error names identify malformed/truncated native version prefixes, where
those inputs actually fail. Mapper syntax assertions remain with Mapper. Test
names omit retired parser modes and historical phase/priority labels.

The isolated cleanup ran the same recursive suite before and after: 437 passes
before, 425 after, no failures; Deno reported 11 seconds for each. These single runs
are coverage evidence, not a reliable performance comparison or CI speedup claim.

## Progressive migration

Parser tests consume async input or the finite `parseBytes` collector. They assert
EOF, enclosure boundaries, and thrown parser errors directly. Feed/flush/reset
and one-frame-per-feed compatibility registrations are removed. Independent
KERIpy vectors, v1/v2 genus selection, text/binary partitioning, and malformed
wire rejection retain their original protocol assertions.

`parser/progressive.test.ts` retains already-delivered enclosed siblings before
a later truncation. `parser/chunk-completion.test.ts` verifies that chunk
exhaustion does not complete an open attachment set, and that a following body
or declared enclosure does complete it without waiting for source EOF.
