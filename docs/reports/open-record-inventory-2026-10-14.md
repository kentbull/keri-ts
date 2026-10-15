# Open record and metadata contract inventory

Date: 2026-10-14 (local session date). Source HEAD at scan: `6216130cd22b63ba57b52a8edc0687c54713e857`.
Policy: [ADR-0013](../adr/adr-0013-simple-component-flows.md), especially decision 2.

## Scope and evidence

Scanned **679** repository-owned tracked and non-ignored untracked
TypeScript/JavaScript files, including hidden paths, tests, fixtures, and build
scripts. Excluded dependency/build/vendor directories. Multiline matching found
**577 textual occurrences in 158 files**. Counts are occurrences,
not defects or independent changes; multiple matches on one line count separately.
There are 573 Record forms, three Map forms, and one unknown index signature.
No matching Record<string, any/object> or Map<string, any/object> forms were found.

| Area           | Occurrences | Files |
| -------------- | ----------: | ----: |
| Build scripts  |           3 |     3 |
| Production     |         393 |   108 |
| Tests/fixtures |         181 |    47 |

The file inventory below assigns every matched file a migration disposition and
lists every matched line. The occurrence appendix preserves each matched source
line; multiline forms are normalized in the type column. Focused source review
covered the decision/control-flow consumers, cues, configuration, CLI dispatch,
notification storage, credential/edge/schema boundaries, generated output, and
codec examples. This is a complete lexical inventory for the stated forms plus
an alias/dependency audit, not a proof that all dynamic typing or all casts have
been exhaustively understood. Per-file prescriptions still require current
producer/consumer verification before implementation. Concurrent main-chat work
may move lines; refresh source before edits. No production behavior was changed.

An E classification is an exception candidate requiring justification under the
ADR, not automatic permission to retain every bag in the file. A file can contain
both a reasonable decoding guard and an unreasonable public contract. Do not
mechanically delete Record or rename it JsonObject. Unknown is appropriate before
validation; it is not an excuse to avoid typing data that we produce or understand.

## Findings and implementation order

1. **Decision control flow (highest priority).** Registry/credential TSN read
   `proof.decision.context?.pending` and `decision.context?.escrow` to decide
   escrow/reject/keep/drop. Make those semantics explicit. Remove unused attachment
   context fields; do not blanket-create replacement diagnostic types. Kever's
   typed sourceSealRepairs array is valid plain data, not an open-record defect.
2. **Messages between workers.** Query/reply/TEL cues, pending queries, challenge,
   delegation, OOBI, multisig, IPEX, ESSR and forwarding have known envelope fields.
   Route and payload must agree by construction and validation. A single broad
   optional interface is not an adequate replacement for real alternatives.
3. **State and outputs.** Type Tever cache values, state-record seals, event/receipt
   projections, issue/revoke webhooks, DID verification methods and metadata, and
   credential creation output. These are controlled by this codebase.
4. **Notifications and contacts.** Type built-in payload producers. Investigate
   real external extension/round-trip requirements before preserving an open
   payload in storage. Generic storage is not itself a reason to erase producer
   types. Read persisted JSON through validation, not an unchecked generic claim.
5. **CLI and configuration.** Type command arguments/selection/handlers and actual
   startup configuration. This is a broad source of avoidable bags. Retain lazy
   loading without an any-based module lookup. User-selected credential/SAD keys
   are a separate concern from the CLI's known flags.
6. **Generic codecs, schemas, and user-defined payloads.** Open keys can be essential
   here. Reuse suitable existing recursive/protocol/schema types where reasonable;
   document unavoidable unknown boundaries. Preserve MGPK/CBOR/native values and
   schema extension semantics. Do not create a universal type/schema framework.
7. **Tests and build scripts.** Migrate fixtures/assertions alongside their owning
   contracts. Keep malformed-input tests meaningful. Remove private mutation
   escapes where real-path assertions work; type package export manifests.

Use small cohesive PRs, refactor before changing behavior, and preserve wire and
interop semantics. Reuse existing types; do not create a type per occurrence.
Prioritize semantic defects rather than reducing the lexical count to zero.

## Alias propagation and additional dependent files

- `SadMap` in CESR serder.ts propagates into generic Serder inputs/outputs and
  KERI/ACDC views. Review those uses even without another Record literal.
- `JsonObject` in core/scheming.ts and `Schema` in acdc/scheming.ts are aliases,
  not evidence of a narrowed schema contract.
- `NoticeAttrs` and `SignalAttrs` propagate into
  [app/notifying.ts](../../packages/keri/src/app/notifying.ts), which has no direct
  scan match. Update Notifier add/prepare/get consumers with the owned payload types.
- `CommandArgs` flows through CommandSelection/CommandHandler and lazy dispatch.
  A typed command table must preserve the name-to-args-to-handler relationship.
  The related `Promise<any>` and `any[]` declarations in shared.ts are additional
  escapes outside the counted exact forms and belong in that same fix.
- `ReplyUnverified` and KEL/escrow decisions propagate through their consumers
  even where no context type is redeclared. Existing tests for pending/escrow
  metadata must assert typed semantics, not preserve arbitrary context keys.
- `MapperMap` in CESR mapper.ts, native.ts and compactor.ts is a recursive map of
  explicitly defined values; it is not equivalent to an arbitrary metadata bag.
  Keep it where arbitrary map disclosure is the actual protocol requirement.
- Generic isRecord guards do not establish a domain schema. Keep only necessary
  boundary probing; do not return the same bag as an allegedly validated message.

## File-by-file change inventory

Paths are repository-relative. All line numbers are scan-time locations.

| File and matched lines                                                                                                                                                                                              | Priority/disposition           | Required change or exception decision                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/cesr/scripts/build_npm.ts](../../packages/cesr/scripts/build_npm.ts) — 35                                                                                                                                 | P3 build manifest              | Type the supported package export-map grammar (conditions/subpaths to strings, arrays or null as actually supported) or use an existing manifest type; do not carry arbitrary JS values through package output.                                                                                                                              |
| [packages/cesr/src/core/types.ts](../../packages/cesr/src/core/types.ts) — 28                                                                                                                                       | E codec boundary review        | Generic SAD decoding/addressing legitimately sees unknown labels before protocol validation. Separate generic wire/value representation from validated KERI/ACDC views; audit accepted JSON/MGPK/CBOR/native values before choosing a value type. Do not force everything through MapperMap or JSON if it changes codec semantics.           |
| [packages/cesr/src/primitives/mapper.ts](../../packages/cesr/src/primitives/mapper.ts) — 144                                                                                                                        | E generic traversal review     | Mapper already has recursive MapperValue/MapperMap; use it where the input is proven to meet that model. Pather traverses arbitrary values: keep any necessary unknown map access local to checked traversal and document it. Do not redefine unrelated codec values as MapperValue.                                                         |
| [packages/cesr/src/primitives/pather.ts](../../packages/cesr/src/primitives/pather.ts) — 186                                                                                                                        | E generic traversal review     | Mapper already has recursive MapperValue/MapperMap; use it where the input is proven to meet that model. Pather traverses arbitrary values: keep any necessary unknown map access local to checked traversal and document it. Do not redefine unrelated codec values as MapperValue.                                                         |
| [packages/cesr/src/primitives/saider.ts](../../packages/cesr/src/primitives/saider.ts) — 64, 74, 98, 106, 161                                                                                                       | E codec boundary review        | Generic SAD decoding/addressing legitimately sees unknown labels before protocol validation. Separate generic wire/value representation from validated KERI/ACDC views; audit accepted JSON/MGPK/CBOR/native values before choosing a value type. Do not force everything through MapperMap or JSON if it changes codec semantics.           |
| [packages/cesr/src/primitives/structing.ts](../../packages/cesr/src/primitives/structing.ts) — 280                                                                                                                  | P2 boundary narrowing          | These are local unknown-input checks, not metadata contracts. Use existing fixed-field/threshold variants after validation; retain narrowly scoped dynamic probing only where generic field validation genuinely requires it.                                                                                                                |
| [packages/cesr/src/primitives/tholder.ts](../../packages/cesr/src/primitives/tholder.ts) — 113                                                                                                                      | P2 boundary narrowing          | These are local unknown-input checks, not metadata contracts. Use existing fixed-field/threshold variants after validation; retain narrowly scoped dynamic probing only where generic field validation genuinely requires it.                                                                                                                |
| [packages/cesr/src/serder/msgpack-admission.ts](../../packages/cesr/src/serder/msgpack-admission.ts) — 24, 47                                                                                                       | E codec boundary review        | Root-object validation is not protocol validation. Retain an isolated unknown map only if required by decoded MGPK values; preserve Date/binary/extensions supported by the actual codec. Return a validated protocol type only at the later protocol boundary.                                                                              |
| [packages/cesr/src/serder/serder.ts](../../packages/cesr/src/serder/serder.ts) — 46, 114, 145, 217, 249, 255                                                                                                        | E codec boundary review        | Generic SAD decoding/addressing legitimately sees unknown labels before protocol validation. Separate generic wire/value representation from validated KERI/ACDC views; audit accepted JSON/MGPK/CBOR/native values before choosing a value type. Do not force everything through MapperMap or JSON if it changes codec semantics.           |
| [packages/cesr/test/fixtures/native-serder-test-helpers.ts](../../packages/cesr/test/fixtures/native-serder-test-helpers.ts) — 62                                                                                   | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/cesr/test/unit/cbor.test.ts](../../packages/cesr/test/unit/cbor.test.ts) — 187                                                                                                                            | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/cesr/test/unit/primitives/compactor.test.ts](../../packages/cesr/test/unit/primitives/compactor.test.ts) — 66                                                                                             | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/cesr/test/unit/serder/classes.test.ts](../../packages/cesr/test/unit/serder/classes.test.ts) — 556, 589, 610                                                                                              | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/cesr/test/unit/serder/native.test.ts](../../packages/cesr/test/unit/serder/native.test.ts) — 31                                                                                                           | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/scripts/build_npm.ts](../../packages/keri/scripts/build_npm.ts) — 39                                                                                                                                 | P3 build manifest              | Type the supported package export-map grammar (conditions/subpaths to strings, arrays or null as actually supported) or use an existing manifest type; do not carry arbitrary JS values through package output.                                                                                                                              |
| [packages/keri/src/acdc/messaging.ts](../../packages/keri/src/acdc/messaging.ts) — 438                                                                                                                              | P2 message construction        | Give the locally constructed ACDC message its actual version/ilk shape; keep schema-owned sections separately represented. Do not replace a broad assertion with an equally unchecked narrow assertion.                                                                                                                                      |
| [packages/keri/src/acdc/scheming.ts](../../packages/keri/src/acdc/scheming.ts) — 23                                                                                                                                 | E schema boundary review       | Arbitrary JSON Schema keywords/property names are a credible necessary exception. Prefer supported Ajv/schema types where suitable; preserve dialect/custom-keyword behavior and validate schema data. Keep any unknown-key traversal local and document why a closed model would be unreasonable.                                           |
| [packages/keri/src/app/challenging.ts](../../packages/keri/src/app/challenging.ts) — 68, 97, 192                                                                                                                    | P1 message contracts           | Replace casts/builders for known challenge, delegation, endpoint-role, OOBI introduction, notification, or ESSR fields with route-specific validated payloads. Missing/malformed fields must follow existing remote-input outcomes; no unchecked as-type shortcut.                                                                           |
| [packages/keri/src/app/cli/aid.ts](../../packages/keri/src/app/cli/aid.ts) — 15                                                                                                                                     | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/annotate-color.ts](../../packages/keri/src/app/cli/annotate-color.ts) — 78, 101                                                                                                          | P2 CLI parsing                 | Replace the parsed option bag with actual annotate flags and their value types; dynamic option lookup should preserve the explicit key set.                                                                                                                                                                                                  |
| [packages/keri/src/app/cli/annotate.ts](../../packages/keri/src/app/cli/annotate.ts) — 23                                                                                                                           | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/benchmark.ts](../../packages/keri/src/app/cli/benchmark.ts) — 36                                                                                                                         | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/challenge.ts](../../packages/keri/src/app/cli/challenge.ts) — 56, 70, 134                                                                                                                | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/common/parsing.ts](../../packages/keri/src/app/cli/common/parsing.ts) — 159, 164                                                                                                         | E external EXN boundary review | parseExnDataItems intentionally accepts user-chosen application payload keys. Validate JSON values and isolate this generic EXN entry; decode known routes to their concrete types rather than propagating the bag.                                                                                                                          |
| [packages/keri/src/app/cli/db-dump.ts](../../packages/keri/src/app/cli/db-dump.ts) — 120, 135, 369                                                                                                                  | P2 CLI/reflection              | Type command args and supported database/store access. Keep any indispensable reflective inspection local and documented; do not add a new registration framework merely to remove a cast.                                                                                                                                                   |
| [packages/keri/src/app/cli/delegate.ts](../../packages/keri/src/app/cli/delegate.ts) — 430                                                                                                                          | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/did.ts](../../packages/keri/src/app/cli/did.ts) — 57, 92, 137, 163, 188                                                                                                                  | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/ends.ts](../../packages/keri/src/app/cli/ends.ts) — 36                                                                                                                                   | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/exchange.ts](../../packages/keri/src/app/cli/exchange.ts) — 33                                                                                                                           | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing. Distinguish known command flags from truly user-defined SAD/credential/EXN JSON; validate the latter and isolate any justified open-value boundary. |
| [packages/keri/src/app/cli/export.ts](../../packages/keri/src/app/cli/export.ts) — 21                                                                                                                               | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/incept.ts](../../packages/keri/src/app/cli/incept.ts) — 71                                                                                                                               | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/init.ts](../../packages/keri/src/app/cli/init.ts) — 52                                                                                                                                   | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/interact.ts](../../packages/keri/src/app/cli/interact.ts) — 41                                                                                                                           | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/ipex.ts](../../packages/keri/src/app/cli/ipex.ts) — 76, 100, 121, 126, 131, 227, 255, 274, 310, 384, 406, 550, 555                                                                       | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing. Distinguish known command flags from truly user-defined SAD/credential/EXN JSON; validate the latter and isolate any justified open-value boundary. |
| [packages/keri/src/app/cli/list.ts](../../packages/keri/src/app/cli/list.ts) — 14                                                                                                                                   | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/loc.ts](../../packages/keri/src/app/cli/loc.ts) — 28                                                                                                                                     | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/multisig.ts](../../packages/keri/src/app/cli/multisig.ts) — 143, 237, 302, 367, 462                                                                                                      | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/notifications.ts](../../packages/keri/src/app/cli/notifications.ts) — 77, 113, 133                                                                                                       | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/oobi.ts](../../packages/keri/src/app/cli/oobi.ts) — 73, 172, 232, 286                                                                                                                    | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing. Type the known OOBI exchange payload separately.                                                                                                    |
| [packages/keri/src/app/cli/query.ts](../../packages/keri/src/app/cli/query.ts) — 47, 53, 92                                                                                                                         | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing. Validate anchor input as the actual seal shape.                                                                                                     |
| [packages/keri/src/app/cli/rotate.ts](../../packages/keri/src/app/cli/rotate.ts) — 116                                                                                                                              | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/saidify.ts](../../packages/keri/src/app/cli/saidify.ts) — 11, 28, 63                                                                                                                     | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing. Distinguish known command flags from truly user-defined SAD/credential/EXN JSON; validate the latter and isolate any justified open-value boundary. |
| [packages/keri/src/app/cli/sign.ts](../../packages/keri/src/app/cli/sign.ts) — 38                                                                                                                                   | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/vc.ts](../../packages/keri/src/app/cli/vc.ts) — 78, 90, 105, 115, 123, 159, 178, 194, 205, 246, 257, 335, 349, 363                                                                       | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing. Distinguish known command flags from truly user-defined SAD/credential/EXN JSON; validate the latter and isolate any justified open-value boundary. |
| [packages/keri/src/app/cli/verifier.ts](../../packages/keri/src/app/cli/verifier.ts) — 22, 119                                                                                                                      | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/cli/verify.ts](../../packages/keri/src/app/cli/verify.ts) — 40                                                                                                                               | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/keri/src/app/configing.ts](../../packages/keri/src/app/configing.ts) — 241, 257                                                                                                                           | P2 configuration/contact       | Replace unchecked generic Configer.get<T> claims and known contact fields with parsed configuration/contact shapes. Dynamic habitat/alias keys can map to typed values. Establish whether arbitrary external contact fields must round-trip before retaining an isolated extension boundary.                                                 |
| [packages/keri/src/app/credential-workflows.ts](../../packages/keri/src/app/credential-workflows.ts) — 49, 50, 51, 71, 461                                                                                          | P2 mixed credential boundary   | Type fixed credential envelopes, creation outputs and multisig workflow payloads. Schema-selected attributes can have open keys; use the precise supported SAD/value model after validation. Model supported edge/rule structures and compact/digest alternatives without forbidding valid external schemas.                                 |
| [packages/keri/src/app/delegating.ts](../../packages/keri/src/app/delegating.ts) — 298, 299, 315, 316, 323                                                                                                          | P1 message contracts           | Replace casts/builders for known challenge, delegation, endpoint-role, OOBI introduction, notification, or ESSR fields with route-specific validated payloads. Missing/malformed fields must follow existing remote-input outcomes; no unchecked as-type shortcut.                                                                           |
| [packages/keri/src/app/endpoint-roleing.ts](../../packages/keri/src/app/endpoint-roleing.ts) — 127                                                                                                                  | P1 message contracts           | Replace casts/builders for known challenge, delegation, endpoint-role, OOBI introduction, notification, or ESSR fields with route-specific validated payloads. Missing/malformed fields must follow existing remote-input outcomes; no unchecked as-type shortcut.                                                                           |
| [packages/keri/src/app/essr.ts](../../packages/keri/src/app/essr.ts) — 145                                                                                                                                          | P1 message contracts           | Replace casts/builders for known challenge, delegation, endpoint-role, OOBI introduction, notification, or ESSR fields with route-specific validated payloads. Missing/malformed fields must follow existing remote-input outcomes; no unchecked as-type shortcut.                                                                           |
| [packages/keri/src/app/exchanging.ts](../../packages/keri/src/app/exchanging.ts) — 1402, 1405                                                                                                                       | P2 mixed wire boundary         | Type fixed forwarding envelope fields and known embedded event entries. Generic EXN routing may genuinely accept application-defined payloads: keep that extension at its validated wire boundary and use precise built-in route contracts downstream.                                                                                       |
| [packages/keri/src/app/forwarding.ts](../../packages/keri/src/app/forwarding.ts) — 273, 276, 798, 804, 834, 1532, 1540, 1553, 1802, 1804                                                                            | P2 mixed wire boundary         | Type fixed forwarding envelope fields and known embedded event entries. Generic EXN routing may genuinely accept application-defined payloads: keep that extension at its validated wire boundary and use precise built-in route contracts downstream.                                                                                       |
| [packages/keri/src/app/grouping.ts](../../packages/keri/src/app/grouping.ts) — 122, 281, 306, 543, 544, 558, 597, 658, 666, 670, 677, 682, 702                                                                      | P1 message contracts           | Correlate multisig route with member lists and embedded event names. Use typed supported proposal/embed variants and decode once. Remove stringField/stringArrayField record plumbing from already validated internal messages; retain unknown only at untrusted entry.                                                                      |
| [packages/keri/src/app/habbing.ts](../../packages/keri/src/app/habbing.ts) — 424, 449, 450, 453, 849, 869, 1495, 1496                                                                                               | P2 boundary narrowing          | Type configured habitat sections and known query/reply bodies at the entry boundary. Generic EXN/reply facilities may preserve actual route extensibility, but built-in routes must use concrete payloads.                                                                                                                                   |
| [packages/keri/src/app/ipex-building.ts](../../packages/keri/src/app/ipex-building.ts) — 26, 106, 113                                                                                                               | P1 message contracts           | Type IPEX route envelopes, modifiers, predecessor/message fields and known embeds. Isolate truly schema-defined credential content. Replace repeated nested record casts with the existing or a small concrete decoded representation; preserve v1/v2 and disclosure differences.                                                            |
| [packages/keri/src/app/ipex-credentialing.ts](../../packages/keri/src/app/ipex-credentialing.ts) — 313, 332, 338, 344, 348, 350, 360, 367                                                                           | P1 message contracts           | Type IPEX route envelopes, modifiers, predecessor/message fields and known embeds. Isolate truly schema-defined credential content. Replace repeated nested record casts with the existing or a small concrete decoded representation; preserve v1/v2 and disclosure differences.                                                            |
| [packages/keri/src/app/ipex-graph.ts](../../packages/keri/src/app/ipex-graph.ts) — 22, 39, 200, 231                                                                                                                 | P1 message contracts           | Parse supported edge leaf/group operators into explicit recursive variants before graph evaluation. Dynamic edge labels can map to a precise edge value; they do not require unknown values. Preserve malformed-member rejection and schema dependencies.                                                                                    |
| [packages/keri/src/app/ipex-grouping.ts](../../packages/keri/src/app/ipex-grouping.ts) — 477                                                                                                                        | P1 message contracts           | Correlate multisig route with member lists and embedded event names. Use typed supported proposal/embed variants and decode once. Remove stringField/stringArrayField record plumbing from already validated internal messages; retain unknown only at untrusted entry.                                                                      |
| [packages/keri/src/app/ipex-v2.ts](../../packages/keri/src/app/ipex-v2.ts) — 44, 215, 457                                                                                                                           | P1 message contracts           | Type IPEX route envelopes, modifiers, predecessor/message fields and known embeds. Isolate truly schema-defined credential content. Replace repeated nested record casts with the existing or a small concrete decoded representation; preserve v1/v2 and disclosure differences.                                                            |
| [packages/keri/src/app/ipexing.ts](../../packages/keri/src/app/ipexing.ts) — 340                                                                                                                                    | P1 message contracts           | Type IPEX route envelopes, modifiers, predecessor/message fields and known embeds. Isolate truly schema-defined credential content. Replace repeated nested record casts with the existing or a small concrete decoded representation; preserve v1/v2 and disclosure differences.                                                            |
| [packages/keri/src/app/multisig-workflows.ts](../../packages/keri/src/app/multisig-workflows.ts) — 103, 122, 515, 524, 531, 714, 736, 740, 748, 753, 758                                                            | P1 message contracts           | Correlate multisig route with member lists and embedded event names. Use typed supported proposal/embed variants and decode once. Remove stringField/stringArrayField record plumbing from already validated internal messages; retain unknown only at untrusted entry.                                                                      |
| [packages/keri/src/app/oobiery.ts](../../packages/keri/src/app/oobiery.ts) — 457, 596, 700, 716, 733                                                                                                                | P1 message contracts           | Replace casts/builders for known challenge, delegation, endpoint-role, OOBI introduction, notification, or ESSR fields with route-specific validated payloads. Missing/malformed fields must follow existing remote-input outcomes; no unchecked as-type shortcut.                                                                           |
| [packages/keri/src/app/organizing.ts](../../packages/keri/src/app/organizing.ts) — 8, 41, 57, 125                                                                                                                   | P2 configuration/contact       | Replace unchecked generic Configer.get<T> claims and known contact fields with parsed configuration/contact shapes. Dynamic habitat/alias keys can map to typed values. Establish whether arbitrary external contact fields must round-trip before retaining an isolated extension boundary.                                                 |
| [packages/keri/src/app/querying.ts](../../packages/keri/src/app/querying.ts) — 60, 178, 179, 197, 218, 472, 480, 600                                                                                                | P1 message contracts           | Use route-specific query/reply records and an explicit pending/completed query shape where needed. Eliminate duplicate query/q knowledge when compatibility permits. Type anchor seals; correlate route and payload instead of a bag. Preserve existing producers and cue routing.                                                           |
| [packages/keri/src/app/signaling.ts](../../packages/keri/src/app/signaling.ts) — 15                                                                                                                                 | P2 notifications               | Replace NoticeAttrs/SignalAttrs defaults for built-in producers with explicit route/payload contracts. Preserve generic storage only if an actual external arbitrary payload contract requires it; constrain serializable values and document the exception. Do not cast persisted JSON directly to an assumed generic type.                 |
| [packages/keri/src/app/verifier-agent.ts](../../packages/keri/src/app/verifier-agent.ts) — 50, 448, 461, 498                                                                                                        | P2 output contracts            | Define issue/revoke webhook data correlated with action; known credential/schema/timestamp fields are explicit. Keep schema-defined attributes isolated. Replace runtime tever duck typing after typing the Reger cache.                                                                                                                     |
| [packages/keri/src/app/verifying.ts](../../packages/keri/src/app/verifying.ts) — 95, 419, 439                                                                                                                       | P1 storage contracts           | Replace Map<string, unknown> tevers with the concrete Tever or a genuinely sufficient state-query contract. Validate decoded credential edges into supported edge variants; keep generic object probing confined to the decoder.                                                                                                             |
| [packages/keri/src/core/cues.ts](../../packages/keri/src/core/cues.ts) — 48, 49, 78, 113                                                                                                                            | P1 message contracts           | Use route-specific query/reply records and an explicit pending/completed query shape where needed. Eliminate duplicate query/q knowledge when compatibility permits. Type anchor seals; correlate route and payload instead of a bag. Preserve existing producers and cue routing.                                                           |
| [packages/keri/src/core/errors.ts](../../packages/keri/src/core/errors.ts) — 10                                                                                                                                     | P1 decisions                   | Replace the universal error-context bag with the concrete information actually needed by each error, or remove it. Keep unknown causes as unknown; do not let diagnostics determine protocol outcomes.                                                                                                                                       |
| [packages/keri/src/core/eventing.ts](../../packages/keri/src/core/eventing.ts) — 334, 365, 1381, 1445, 2777, 2778                                                                                                   | P1 message contracts           | Validate query/reply route bodies once, then use explicit query, state, and seal records. Remove repeated casts at consumers and reuse the authoritative domain shapes.                                                                                                                                                                      |
| [packages/keri/src/core/exchange-proofing.ts](../../packages/keri/src/core/exchange-proofing.ts) — 83                                                                                                               | P2 boundary narrowing          | Validate the expected anchor/seal member shape directly before comparing d; use the appropriate domain seal type after the check.                                                                                                                                                                                                            |
| [packages/keri/src/core/kever-decisions.ts](../../packages/keri/src/core/kever-decisions.ts) — 96, 104, 142, 150, 211, 219, 227                                                                                     | P1 decisions                   | Delete unused context parameters/fields. Put required behavioral data on the appropriate discriminated outcome; keep diagnostic details explicit and optional only when actually optional. Preserve typed DelegationSourceRepair data; it is not an open bag.                                                                                |
| [packages/keri/src/core/kever.ts](../../packages/keri/src/core/kever.ts) — 2111, 2120                                                                                                                               | P1 decisions                   | Delete unused context parameters/fields. Put required behavioral data on the appropriate discriminated outcome; keep diagnostic details explicit and optional only when actually optional. Preserve typed DelegationSourceRepair data; it is not an open bag.                                                                                |
| [packages/keri/src/core/protocol-eventing.ts](../../packages/keri/src/core/protocol-eventing.ts) — 166, 373, 491, 582, 599, 621, 637, 658, 675, 697, 713, 747, 748, 796, 797                                        | P2 mixed wire boundary         | Type fixed KEL construction and built-in query/reply route bodies; retain version/ilk distinctions. Generic EXN attributes/modifiers require a documented actual extensibility use, not a bag on every built-in producer.                                                                                                                    |
| [packages/keri/src/core/protocol-exchanging.ts](../../packages/keri/src/core/protocol-exchanging.ts) — 44, 45, 97, 98, 130, 153, 194                                                                                | P2 mixed wire boundary         | Type fixed forwarding envelope fields and known embedded event entries. Generic EXN routing may genuinely accept application-defined payloads: keep that extension at its validated wire boundary and use precise built-in route contracts downstream.                                                                                       |
| [packages/keri/src/core/protocol-serialization.ts](../../packages/keri/src/core/protocol-serialization.ts) — 479, 485, 511                                                                                          | P2 output contracts            | Give loadEvent and its receipt/signature/source-seal projection a concrete result type. These output keys are authored here and need no arbitrary dictionary.                                                                                                                                                                                |
| [packages/keri/src/core/protocol-vdr-eventing.ts](../../packages/keri/src/core/protocol-vdr-eventing.ts) — 48, 52, 414, 420, 470                                                                                    | P1 message contracts           | Use explicit VDR event/state, anchor and registry-seal shapes; validate unknown wire input once. Preserve real event/version alternatives and TEL query fields; remove record casts after discrimination.                                                                                                                                    |
| [packages/keri/src/core/records.ts](../../packages/keri/src/core/records.ts) — 35, 107, 143, 146, 150, 351, 352, 364, 365                                                                                           | P1 storage contracts           | Type VcStateRecord a/ra seals explicitly. Preserve each RawRecord subclass shape in its serialized projection rather than erasing it to Record. Keep any unavoidable reflective normalization local and justified; do not assert an unchecked generic decoder is validated.                                                                  |
| [packages/keri/src/core/routing.ts](../../packages/keri/src/core/routing.ts) — 29, 66, 969, 1034                                                                                                                    | P1 decisions                   | Replace ReplyUnverified context with explicit proof outcome semantics; pending is behavioral. Type endpoint-role/location payloads after validation. Audit context spreading into escrow diagnostics and all reply consumers.                                                                                                                |
| [packages/keri/src/core/scheming.ts](../../packages/keri/src/core/scheming.ts) — 14                                                                                                                                 | E schema boundary review       | Arbitrary JSON Schema keywords/property names are a credible necessary exception. Prefer supported Ajv/schema types where suitable; preserve dialect/custom-keyword behavior and validate schema data. Keep any unknown-key traversal local and document why a closed model would be unreasonable.                                           |
| [packages/keri/src/db/escrowing.ts](../../packages/keri/src/db/escrowing.ts) — 332                                                                                                                                  | P1 storage contracts           | Read persisted state payload through the existing typed state decoder; maintain keep/drop reason semantics and explicit diagnostic fields.                                                                                                                                                                                                   |
| [packages/keri/src/db/noting.ts](../../packages/keri/src/db/noting.ts) — 23                                                                                                                                         | P2 notifications               | Replace NoticeAttrs/SignalAttrs defaults for built-in producers with explicit route/payload contracts. Preserve generic storage only if an actual external arbitrary payload contract requires it; constrain serializable values and document the exception. Do not cast persisted JSON directly to an assumed generic type.                 |
| [packages/keri/src/db/reger.ts](../../packages/keri/src/db/reger.ts) — 101, 113                                                                                                                                     | P1 storage contracts           | Replace Map<string, unknown> tevers with the concrete Tever or a genuinely sufficient state-query contract. Validate decoded credential edges into supported edge variants; keep generic object probing confined to the decoder.                                                                                                             |
| [packages/keri/src/did/webs/designated-aliases.ts](../../packages/keri/src/did/webs/designated-aliases.ts) — 177, 321, 322, 325                                                                                     | P2 output contracts            | Type the fixed designated-alias rule document and known credential attributes; keep only actual external schema content open with validation. Replace JSON-clone assertions that claim a shape without checking it.                                                                                                                          |
| [packages/keri/src/did/webs/dids.ts](../../packages/keri/src/did/webs/dids.ts) — 266                                                                                                                                | P2 output contracts            | Preserve the known document/value shape through DID normalization; separate traversal of genuine external JSON from the typed generated document. Do not erase outputs to an arbitrary object.                                                                                                                                               |
| [packages/keri/src/did/webs/documenting.ts](../../packages/keri/src/did/webs/documenting.ts) — 19, 20, 23, 32, 157, 158, 234, 235                                                                                   | P2 output contracts            | Define actual generated DID document, supported verification-method variants, services, and resolution metadata. Preserve shape through pruneEmpty or build fields conditionally. Document any genuine externally supplied extension separately.                                                                                             |
| [packages/keri/src/did/webs/resolving.ts](../../packages/keri/src/did/webs/resolving.ts) — 182                                                                                                                      | P2 boundary narrowing          | Constrain isRecord to parsing external resolution/schema content and return the actual validated artifact/result shape to consumers. A local guard may remain only where no explicit reasonable input model exists.                                                                                                                          |
| [packages/keri/src/vdr/credential-tsn.ts](../../packages/keri/src/vdr/credential-tsn.ts) — 28, 37                                                                                                                   | P1 decisions                   | Validate incoming registry/credential state into existing state shapes and explicit seals. Replace context.pending/context.escrow control flow with typed outcome fields/variants; preserve escrow migration/keep/drop semantics.                                                                                                            |
| [packages/keri/src/vdr/credentialing.ts](../../packages/keri/src/vdr/credentialing.ts) — 82, 84, 85, 179, 183, 187, 200, 202, 214, 215, 241, 550, 552, 553                                                          | P2 mixed credential boundary   | Type fixed credential envelopes, creation outputs and multisig workflow payloads. Schema-selected attributes can have open keys; use the precise supported SAD/value model after validation. Model supported edge/rule structures and compact/digest alternatives without forbidding valid external schemas.                                 |
| [packages/keri/src/vdr/eventing.ts](../../packages/keri/src/vdr/eventing.ts) — 141, 228, 236, 243, 244, 849, 1032                                                                                                   | P1 message contracts           | Use explicit VDR event/state, anchor and registry-seal shapes; validate unknown wire input once. Preserve real event/version alternatives and TEL query fields; remove record casts after discrimination.                                                                                                                                    |
| [packages/keri/src/vdr/registry-tsn.ts](../../packages/keri/src/vdr/registry-tsn.ts) — 30                                                                                                                           | P1 decisions                   | Validate incoming registry/credential state into existing state shapes and explicit seals. Replace context.pending/context.escrow control flow with typed outcome fields/variants; preserve escrow migration/keep/drop semantics.                                                                                                            |
| [packages/keri/src/vdr/tsn-query.ts](../../packages/keri/src/vdr/tsn-query.ts) — 23, 29                                                                                                                             | P1 message contracts           | Validate query/reply route bodies once, then use explicit query, state, and seal records. Remove repeated casts at consumers and reuse the authoritative domain shapes.                                                                                                                                                                      |
| [packages/keri/test/integration/app/acdc-verifier-workflow.test.ts](../../packages/keri/test/integration/app/acdc-verifier-workflow.test.ts) — 49, 58, 73, 144, 149, 259, 264, 265, 297, 301, 314                   | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/integration/app/db-dump.test.ts](../../packages/keri/test/integration/app/db-dump.test.ts) — 22                                                                                                 | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/integration/app/interop-acdc-kli-tufa.test.ts](../../packages/keri/test/integration/app/interop-acdc-kli-tufa.test.ts) — 16, 53, 62, 192, 458, 464, 534                                         | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/integration/app/interop-acdc-mixed-chain-i2i.test.ts](../../packages/keri/test/integration/app/interop-acdc-mixed-chain-i2i.test.ts) — 53, 157, 180, 189, 224, 476, 535, 820, 861, 1258, 1275   | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/integration/app/interop-acdc-mixed-chain-ni2i.test.ts](../../packages/keri/test/integration/app/interop-acdc-mixed-chain-ni2i.test.ts) — 53, 157, 180, 189, 224, 476, 535, 820, 861, 1182, 1199 | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/integration/app/interop-acdc-tufa-kli-holder.test.ts](../../packages/keri/test/integration/app/interop-acdc-tufa-kli-holder.test.ts) — 17, 54, 63, 237, 723, 729                                | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/integration/app/interop-delegation-kli-tufa.test.ts](../../packages/keri/test/integration/app/interop-delegation-kli-tufa.test.ts) — 56                                                         | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/integration/app/interop-saidify-kli-tufa.test.ts](../../packages/keri/test/integration/app/interop-saidify-kli-tufa.test.ts) — 32                                                               | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/integration/app/interop-test-helpers.ts](../../packages/keri/test/integration/app/interop-test-helpers.ts) — 1427, 1436                                                                         | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/keri/test/unit/app/cesr-http.test.ts](../../packages/keri/test/unit/app/cesr-http.test.ts) — 28, 366                                                                                                      | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/configing.test.ts](../../packages/keri/test/unit/app/configing.test.ts) — 8, 9, 17, 34, 40                                                                                             | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/endpoint-roleing.test.ts](../../packages/keri/test/unit/app/endpoint-roleing.test.ts) — 43, 53, 74                                                                                     | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/exchanging.test.ts](../../packages/keri/test/unit/app/exchanging.test.ts) — 14, 47, 51, 60, 64                                                                                         | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/forwarding.test.ts](../../packages/keri/test/unit/app/forwarding.test.ts) — 55, 63, 422, 787, 794, 1135, 1136                                                                          | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/grouping-nests.test.ts](../../packages/keri/test/unit/app/grouping-nests.test.ts) — 56, 252, 257, 455                                                                                  | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/grouping.test.ts](../../packages/keri/test/unit/app/grouping.test.ts) — 60, 65, 66, 71, 72, 73, 78, 79, 84, 136                                                                        | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/habbing.test.ts](../../packages/keri/test/unit/app/habbing.test.ts) — 41, 49, 318, 335, 387, 434, 438, 722, 739, 770                                                                   | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/ipex-credentialing.test.ts](../../packages/keri/test/unit/app/ipex-credentialing.test.ts) — 27                                                                                         | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/ipexing.test.ts](../../packages/keri/test/unit/app/ipexing.test.ts) — 73                                                                                                               | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/mailbox-poller-runtime.test.ts](../../packages/keri/test/unit/app/mailbox-poller-runtime.test.ts) — 22                                                                                 | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/mailbox-runtime-slow.test.ts](../../packages/keri/test/unit/app/mailbox-runtime-slow.test.ts) — 38, 46, 421, 448, 475, 508, 532, 564                                                   | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/mailbox-runtime.test.ts](../../packages/keri/test/unit/app/mailbox-runtime.test.ts) — 57, 65, 673, 867                                                                                 | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/notifications-cli.test.ts](../../packages/keri/test/unit/app/notifications-cli.test.ts) — 13, 15                                                                                       | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/notifying.test.ts](../../packages/keri/test/unit/app/notifying.test.ts) — 14, 22, 270                                                                                                  | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/protocol/mailbox-admin.test.ts](../../packages/keri/test/unit/app/protocol/mailbox-admin.test.ts) — 16                                                                                 | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/querying.test.ts](../../packages/keri/test/unit/app/querying.test.ts) — 167, 171, 175, 339                                                                                             | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/replay-source.test.ts](../../packages/keri/test/unit/app/replay-source.test.ts) — 199                                                                                                  | T private test escape          | Replace private-instance record mutation/monkeypatching with the smallest real-path failure assertion. Keep deliberate malformed inputs visibly at the test boundary; do not expose production internals for tests.                                                                                                                          |
| [packages/keri/test/unit/app/schema-oobi.test.ts](../../packages/keri/test/unit/app/schema-oobi.test.ts) — 14                                                                                                       | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/verifier-agent.test.ts](../../packages/keri/test/unit/app/verifier-agent.test.ts) — 16, 128, 137, 166, 167, 204, 212, 288, 289, 324, 332                                               | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/app/verifying.test.ts](../../packages/keri/test/unit/app/verifying.test.ts) — 38, 90, 91                                                                                                   | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/core/eventing.test.ts](../../packages/keri/test/unit/core/eventing.test.ts) — 47, 66, 2639, 2640                                                                                           | T private test escape          | Replace private-instance record mutation/monkeypatching with the smallest real-path failure assertion. Keep deliberate malformed inputs visibly at the test boundary; do not expose production internals for tests.                                                                                                                          |
| [packages/keri/test/unit/core/kevery-query.test.ts](../../packages/keri/test/unit/core/kevery-query.test.ts) — 168                                                                                                  | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/core/protocol-eventing.test.ts](../../packages/keri/test/unit/core/protocol-eventing.test.ts) — 103, 123                                                                                   | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/core/scheming.test.ts](../../packages/keri/test/unit/core/scheming.test.ts) — 8, 61, 73, 143, 185, 187                                                                                     | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/db/escrowing.test.ts](../../packages/keri/test/unit/db/escrowing.test.ts) — 354, 377                                                                                                       | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/db/reger.test.ts](../../packages/keri/test/unit/db/reger.test.ts) — 60                                                                                                                     | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/did/webs.test.ts](../../packages/keri/test/unit/did/webs.test.ts) — 525, 539, 578                                                                                                          | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/vdr/credentialing.test.ts](../../packages/keri/test/unit/vdr/credentialing.test.ts) — 32, 70                                                                                               | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/unit/vdr/eventing.test.ts](../../packages/keri/test/unit/vdr/eventing.test.ts) — 820, 831, 1028, 1218                                                                                           | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |
| [packages/keri/test/utils.ts](../../packages/keri/test/utils.ts) — 165, 173                                                                                                                                         | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/tufa/scripts/build_npm.ts](../../packages/tufa/scripts/build_npm.ts) — 38                                                                                                                                 | P3 build manifest              | Type the supported package export-map grammar (conditions/subpaths to strings, arrays or null as actually supported) or use an existing manifest type; do not carry arbitrary JS values through package output.                                                                                                                              |
| [packages/tufa/src/cli/agent.ts](../../packages/tufa/src/cli/agent.ts) — 52, 135                                                                                                                                    | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/tufa/src/cli/command-definitions/challenge.ts](../../packages/tufa/src/cli/command-definitions/challenge.ts) — 35, 77, 144                                                                                | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/credentials.ts](../../packages/tufa/src/cli/command-definitions/credentials.ts) — 366                                                                                    | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/endpoints.ts](../../packages/tufa/src/cli/command-definitions/endpoints.ts) — 44, 89, 128, 159, 201                                                                      | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/identity.ts](../../packages/tufa/src/cli/command-definitions/identity.ts) — 54, 105, 144, 182, 214, 249                                                                  | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/lifecycle.ts](../../packages/tufa/src/cli/command-definitions/lifecycle.ts) — 459                                                                                        | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/mailbox.ts](../../packages/tufa/src/cli/command-definitions/mailbox.ts) — 42, 86, 128, 165, 204, 245                                                                     | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/messaging.ts](../../packages/tufa/src/cli/command-definitions/messaging.ts) — 84                                                                                         | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/notifications.ts](../../packages/tufa/src/cli/command-definitions/notifications.ts) — 43, 73, 102                                                                        | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/options.ts](../../packages/tufa/src/cli/command-definitions/options.ts) — 69, 79                                                                                         | P2 CLI dispatch                | Type actual common option renames and witness-auth fields; preserve per-command argument types rather than returning an unknown dictionary.                                                                                                                                                                                                  |
| [packages/tufa/src/cli/command-definitions/shared.ts](../../packages/tufa/src/cli/command-definitions/shared.ts) — 13                                                                                               | P2 CLI dispatch                | Correlate command name with its actual parsed argument type and handler. Preserve lazy import inference or select a typed exported handler; remove CommandModule erasure and accompanying Promise<any>/any[] plumbing. Avoid a generic command framework or giant optional-field bag.                                                        |
| [packages/tufa/src/cli/command-definitions/tooling.ts](../../packages/tufa/src/cli/command-definitions/tooling.ts) — 52                                                                                             | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-definitions/witness.ts](../../packages/tufa/src/cli/command-definitions/witness.ts) — 50, 94                                                                                         | P2 CLI dispatch                | Type this command registration's actual Commander options and selected argument shape; tie it to its handler contract. Preserve lazy loading; no open command-options bag.                                                                                                                                                                   |
| [packages/tufa/src/cli/command-types.ts](../../packages/tufa/src/cli/command-types.ts) — 4                                                                                                                          | P2 CLI dispatch                | Correlate command name with its actual parsed argument type and handler. Preserve lazy import inference or select a typed exported handler; remove CommandModule erasure and accompanying Promise<any>/any[] plumbing. Avoid a generic command framework or giant optional-field bag.                                                        |
| [packages/tufa/src/cli/dws.ts](../../packages/tufa/src/cli/dws.ts) — 30                                                                                                                                             | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing.                                                                                                                                                     |
| [packages/tufa/src/cli/hook.ts](../../packages/tufa/src/cli/hook.ts) — 13, 17, 132                                                                                                                                  | P2 output contracts            | Give demo command arguments and known webhook envelope explicit types. Isolate schema-defined attributes after validation instead of leaving the whole request open.                                                                                                                                                                         |
| [packages/tufa/src/cli/mailbox.ts](../../packages/tufa/src/cli/mailbox.ts) — 91, 99, 110, 163, 192, 238, 422, 439, 464, 502, 515                                                                                    | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing. Decode startup configuration to explicit witness/mailbox option records.                                                                            |
| [packages/tufa/src/cli/witness.ts](../../packages/tufa/src/cli/witness.ts) — 55, 79, 110, 165                                                                                                                       | P2 CLI arguments               | Give each command its actual parsed argument type, including explicit shared base options. Type emitted results and JSON readers where fields are known; unknown is confined to parsing. Decode startup configuration to explicit witness/mailbox option records.                                                                            |
| [packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts](../../packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts) — 85                                                                   | P1 message contracts           | Use validated mailbox-admin and route-specific query types shared with KERI handlers; eliminate independent bag casts in HTTP adapters.                                                                                                                                                                                                      |
| [packages/tufa/src/http/protocol/endpoints/mailbox-admin.ts](../../packages/tufa/src/http/protocol/endpoints/mailbox-admin.ts) — 136                                                                                | P1 message contracts           | Use validated mailbox-admin and route-specific query types shared with KERI handlers; eliminate independent bag casts in HTTP adapters.                                                                                                                                                                                                      |
| [packages/tufa/src/operator/mailbox-startup.ts](../../packages/tufa/src/operator/mailbox-startup.ts) — 68, 92, 131                                                                                                  | P2 configuration/contact       | Parse typed witness/mailbox startup configuration and per-AID sections at the file boundary. Return explicit startup options; remove repeated record casts and unchecked generic config reads.                                                                                                                                               |
| [packages/tufa/src/operator/witness-startup.ts](../../packages/tufa/src/operator/witness-startup.ts) — 82, 97, 183                                                                                                  | P2 configuration/contact       | Parse typed witness/mailbox startup configuration and per-AID sections at the file boundary. Return explicit startup options; remove repeated record casts and unchecked generic config reads.                                                                                                                                               |
| [packages/tufa/test/integration/multisig-nested.test.ts](../../packages/tufa/test/integration/multisig-nested.test.ts) — 424, 488, 493, 496                                                                         | T integration boundary         | Parse CLI/peer JSON to the actual expected result/fixture shape before assertions. Preserve deliberately variable schema payloads and malformed-wire tests; do not weaken interop assertions or topology to satisfy types.                                                                                                                   |
| [packages/tufa/test/progressive-ingress.test.ts](../../packages/tufa/test/progressive-ingress.test.ts) — 706                                                                                                        | T corresponding tests          | Adopt the production DTO/route/fixture types for valid data and assertions. Keep intentionally malformed inputs unknown at the tested boundary. Generic schema/codec traversal may retain a documented local exception; avoid casts that bypass the validator under test.                                                                    |

## Complete occurrence appendix

Each item shows the line, normalized matched form, and captured source line.

### packages/cesr/scripts/build_npm.ts

```text
35: Record<string, unknown> :: exports?: Record<string, unknown>;
```

### packages/cesr/src/core/types.ts

```text
28: Record<string, unknown> :: ked: Record<string, unknown> | null;
```

### packages/cesr/src/primitives/mapper.ts

```text
144: Record<string, unknown> :: Object.entries(value as Record<string, unknown>).map((
```

### packages/cesr/src/primitives/pather.ts

```text
186: Record<string, unknown> :: value = (value as Record<string, unknown>)[key];
```

### packages/cesr/src/primitives/saider.ts

```text
64: Record<string, unknown> :: sad: Record<string, unknown>,
74: Record<string, unknown> :: sad: Record<string, unknown>;
98: Record<string, unknown> :: sad: Record<string, unknown>,
106: Record<string, unknown> :: sad: Record<string, unknown>;
161: Record<string, unknown> :: function inferKind(sad: Record<string, unknown>): Kind {
```

### packages/cesr/src/primitives/structing.ts

```text
280: Record<string, unknown> :: const candidate = value as Record<string, unknown>;
```

### packages/cesr/src/primitives/tholder.ts

```text
113: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/cesr/src/serder/msgpack-admission.ts

```text
24: Record<string, unknown> :: ): Record<string, unknown> {
47: Record<string, unknown> :: return value as Record<string, unknown>;
```

### packages/cesr/src/serder/serder.ts

```text
46: Record<string, unknown> :: type SadMap = Record<string, unknown>;
114: Record<string, unknown> :: Object.entries(value as Record<string, unknown>).map((
145: Record<string, unknown> :: function isPlainSadObject(value: unknown): value is Record<string, unknown> {
217: Record<string, unknown> :: ked: Record<string, unknown> | unknown[],
249: Record<string, unknown> :: ked: Record<string, unknown>,
255: Record<string, unknown> :: ked: Record<string, unknown>;
```

### packages/cesr/test/fixtures/native-serder-test-helpers.ts

```text
62: Record<string, unknown> :: export function expectedNativeKeriIcpSad(): Record<string, unknown> {
```

### packages/cesr/test/unit/cbor.test.ts

```text
187: Record<string, unknown> :: for (const item of Object.values(value as Record<string, unknown>)) {
```

### packages/cesr/test/unit/primitives/compactor.test.ts

```text
66: Record<string, unknown> :: assertEquals(typeof (compactor.mad.a as Record<string, unknown>).d, "string");
```

### packages/cesr/test/unit/serder/classes.test.ts

```text
556: Record<string, unknown> :: ((tampered.a as Record<string, unknown>).role) = "tampered";
589: Record<string, unknown> :: assertEquals(typeof (serder.schema as Record<string, unknown>).$id, "string");
610: Record<string, unknown> :: (changed.s as Record<string, unknown>).$id = token("E");
```

### packages/cesr/test/unit/serder/native.test.ts

```text
31: Record<string, unknown> :: ): Record<string, unknown> {
```

### packages/keri/scripts/build_npm.ts

```text
39: Record<string, unknown> :: exports?: Record<string, unknown>;
```

### packages/keri/src/acdc/messaging.ts

```text
438: Record<string, unknown> :: const sad: Record<string, unknown> = {
```

### packages/keri/src/acdc/scheming.ts

```text
23: Record<string, unknown> :: type Schema = Record<string, unknown>;
```

### packages/keri/src/app/challenging.ts

```text
68: Record<string, unknown> :: const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
97: Record<string, unknown> :: exn.ked?.a as Record<string, unknown> | undefined,
192: Record<string, unknown> :: payload: Record<string, unknown> | undefined,
```

### packages/keri/src/app/cli/aid.ts

```text
15: Record<string, unknown> :: export function* aidCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/annotate-color.ts

```text
78: Record<string, unknown> :: const parsed: Record<string, unknown> = {};
101: Record<string, unknown> :: const value = (parsed as Record<string, unknown>)[key];
```

### packages/keri/src/app/cli/annotate.ts

```text
23: Record<string, unknown> :: export function* annotateCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/benchmark.ts

```text
36: Record<string, unknown> :: export function* benchmarkCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/challenge.ts

```text
56: Record<string, unknown> :: args: Record<string, unknown>,
70: Record<string, unknown> :: args: Record<string, unknown>,
134: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/keri/src/app/cli/common/parsing.ts

```text
159: Record<string, unknown> :: ): Record<string, unknown> {
164: Record<string, unknown> :: const data: Record<string, unknown> = {};
```

### packages/keri/src/app/cli/db-dump.ts

```text
120: Record<string, unknown> :: return Object.entries(domain as unknown as Record<string, unknown>);
135: Record<string, unknown> :: const value = (domain as unknown as Record<string, unknown>)[storeName];
369: Record<string, unknown> :: export function* dumpDatabase(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/delegate.ts

```text
430: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/keri/src/app/cli/did.ts

```text
57: Record<string, unknown> :: export function* dwsBindCommand(args: Record<string, unknown>): Operation<void> {
92: Record<string, unknown> :: export function* dwsGenerateCommand(args: Record<string, unknown>): Operation<void> {
137: Record<string, unknown> :: export function* dwsResolveCommand(args: Record<string, unknown>): Operation<void> {
163: Record<string, unknown> :: export function* dkrResolveCommand(args: Record<string, unknown>): Operation<void> {
188: Record<string, unknown> :: function baseArgs(args: Record<string, unknown>): DidBaseArgs {
```

### packages/keri/src/app/cli/ends.ts

```text
36: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/keri/src/app/cli/exchange.ts

```text
33: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/keri/src/app/cli/export.ts

```text
21: Record<string, unknown> :: export function* exportCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/incept.ts

```text
71: Record<string, unknown> :: export function* inceptCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/init.ts

```text
52: Record<string, unknown> :: export function* initCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/interact.ts

```text
41: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/keri/src/app/cli/ipex.ts

```text
76: Record<string, unknown> :: export function* ipexApplyCommand(args: Record<string, unknown>): Operation<void> {
100: Record<string, unknown> :: export function* ipexOfferCommand(args: Record<string, unknown>): Operation<void> {
121: Record<string, unknown> :: export function* ipexAgreeCommand(args: Record<string, unknown>): Operation<void> {
126: Record<string, unknown> :: export function* ipexSpurnCommand(args: Record<string, unknown>): Operation<void> {
131: Record<string, unknown> :: export function* ipexGrantCommand(args: Record<string, unknown>): Operation<void> {
227: Record<string, unknown> :: export function* ipexAdmitCommand(args: Record<string, unknown>): Operation<void> {
255: Record<string, unknown> :: export function* ipexListCommand(args: Record<string, unknown>): Operation<void> {
274: Record<string, unknown> :: export function* ipexPollCommand(args: Record<string, unknown>): Operation<void> {
310: Record<string, unknown> :: export function* ipexJoinCommand(args: Record<string, unknown>): Operation<void> {
384: Record<string, unknown> :: args: Record<string, unknown>,
406: Record<string, unknown> :: function ipexBaseArgs(args: Record<string, unknown>): IpexBaseArgs {
550: Record<string, unknown> :: function parseJsonArg(value: string | undefined): Record<string, unknown> | undefined {
555: Record<string, unknown> :: return JSON.parse(text) as Record<string, unknown>;
```

### packages/keri/src/app/cli/list.ts

```text
14: Record<string, unknown> :: export function* listCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/loc.ts

```text
28: Record<string, unknown> :: export function* locAddCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/multisig.ts

```text
143: Record<string, unknown> :: args: Record<string, unknown>,
237: Record<string, unknown> :: args: Record<string, unknown>,
302: Record<string, unknown> :: args: Record<string, unknown>,
367: Record<string, unknown> :: args: Record<string, unknown>,
462: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/keri/src/app/cli/notifications.ts

```text
77: Record<string, unknown> :: args: Record<string, unknown>,
113: Record<string, unknown> :: args: Record<string, unknown>,
133: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/keri/src/app/cli/oobi.ts

```text
73: Record<string, unknown> :: args: Record<string, unknown>,
172: Record<string, unknown> :: args: Record<string, unknown>,
232: Record<string, unknown> :: args: Record<string, unknown>,
286: Record<string, unknown> :: payload: (exn.ked?.a as Record<string, unknown>) ?? {
```

### packages/keri/src/app/cli/query.ts

```text
47: Record<string, unknown> :: function loadAnchor(path: string): Record<string, unknown> {
53: Record<string, unknown> :: return anchor as Record<string, unknown>;
92: Record<string, unknown> :: export function* queryCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/rotate.ts

```text
116: Record<string, unknown> :: export function* rotateCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/saidify.ts

```text
11: Record<string, unknown> :: export function* saidifyCommand(args: Record<string, unknown>): Operation<void> {
28: Record<string, unknown> :: function parseSad(raw: string, file: string): Record<string, unknown> {
63: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/app/cli/sign.ts

```text
38: Record<string, unknown> :: export function* signCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/cli/vc.ts

```text
78: Record<string, unknown> :: export function* vcSchemaImportCommand(args: Record<string, unknown>): Operation<void> {
90: Record<string, unknown> :: export function* vcRegistryInceptCommand(args: Record<string, unknown>): Operation<void> {
105: Record<string, unknown> :: export function* vcRegistryListCommand(args: Record<string, unknown>): Operation<void> {
115: Record<string, unknown> :: export function* vcRegistryStatusCommand(args: Record<string, unknown>): Operation<void> {
123: Record<string, unknown> :: export function* vcCreateCommand(args: Record<string, unknown>): Operation<void> {
159: Record<string, unknown> :: export function* vcListCommand(args: Record<string, unknown>): Operation<void> {
178: Record<string, unknown> :: export function* vcExportCommand(args: Record<string, unknown>): Operation<void> {
194: Record<string, unknown> :: export function* vcImportCommand(args: Record<string, unknown>): Operation<void> {
205: Record<string, unknown> :: export function* vcRevokeCommand(args: Record<string, unknown>): Operation<void> {
246: Record<string, unknown> :: function baseArgs(args: Record<string, unknown>): VcBaseArgs {
257: Record<string, unknown> :: args: Record<string, unknown>,
335: Record<string, unknown> :: function parseSubjectDataArg(value: string | undefined): Record<string, unknown> | string | undefined {
349: Record<string, unknown> :: ): Record<string, unknown> | Record<string, unknown>[] | undefined {
349: Record<string, unknown> :: ): Record<string, unknown> | Record<string, unknown>[] | undefined {
363: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/app/cli/verifier.ts

```text
22: Record<string, unknown> :: export function* verifierRunCommand(args: Record<string, unknown>): Operation<void> {
119: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/app/cli/verify.ts

```text
40: Record<string, unknown> :: export function* verifyCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/keri/src/app/configing.ts

```text
241: Record<string, unknown> :: get<T extends Record<string, unknown> = Record<string, unknown>>(): T {
241: Record<string, unknown> :: get<T extends Record<string, unknown> = Record<string, unknown>>(): T {
257: Record<string, unknown> :: put(data: Record<string, unknown>): boolean {
```

### packages/keri/src/app/credential-workflows.ts

```text
49: Record<string, unknown> :: data: Record<string, unknown> | string;
50: Record<string, unknown> :: edges?: Record<string, unknown> | Record<string, unknown>[];
50: Record<string, unknown> :: edges?: Record<string, unknown> | Record<string, unknown>[];
51: Record<string, unknown> :: rules?: Record<string, unknown> | Record<string, unknown>[];
51: Record<string, unknown> :: rules?: Record<string, unknown> | Record<string, unknown>[];
71: Record<string, unknown> :: output: Record<string, unknown>;
461: Record<string, unknown> :: payload: Record<string, unknown>,
```

### packages/keri/src/app/delegating.ts

```text
298: Record<string, unknown> :: const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
299: Record<string, unknown> :: const embeds = args.serder.ked?.e as Record<string, unknown> | undefined;
315: Record<string, unknown> :: const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
316: Record<string, unknown> :: const embeds = args.serder.ked?.e as Record<string, unknown> | undefined;
323: Record<string, unknown> :: const attrs: Record<string, unknown> = {
```

### packages/keri/src/app/endpoint-roleing.ts

```text
127: Record<string, unknown> :: payload: Record<string, unknown>,
```

### packages/keri/src/app/essr.ts

```text
145: Record<string, unknown> :: const modifiers = serder.ked?.q as Record<string, unknown> | undefined;
```

### packages/keri/src/app/exchanging.ts

```text
1402: Record<string, unknown> :: payload: Record<string, unknown>;
1405: Record<string, unknown> :: modifiers?: Record<string, unknown>;
```

### packages/keri/src/app/forwarding.ts

```text
273: Record<string, unknown> :: payload: Record<string, unknown>;
276: Record<string, unknown> :: modifiers?: Record<string, unknown>;
798: Record<string, unknown> :: const modifiers = args.serder.ked?.q as Record<string, unknown> | undefined;
804: Record<string, unknown> :: const signed = (args.serder.a as Record<string, unknown>)?.evt;
834: Record<string, unknown> :: const modifiers = args.serder.ked?.q as Record<string, unknown> | undefined;
1532: Record<string, unknown> :: const embeds = serder.ked?.e as Record<string, unknown> | undefined;
1540: Record<string, unknown> :: const embedded = embeddedSerderRaw(evt as Record<string, unknown>);
1553: Record<string, unknown> :: function embeddedSerderRaw(sad: Record<string, unknown>): Uint8Array {
1802: Record<string, unknown> :: payload: Record<string, unknown>;
1804: Record<string, unknown> :: modifiers?: Record<string, unknown>;
```

### packages/keri/src/app/grouping.ts

```text
122: Record<string, unknown> :: const attrs: Record<string, unknown> = {
281: Record<string, unknown> :: attrs: Record<string, unknown>,
306: Record<string, unknown> :: attrs: Record<string, unknown>,
543: Record<string, unknown> :: get(embeddedSaid: string): Array<{ exn: Record<string, unknown>; paths: Record<string, string> }> {
544: Record<string, unknown> :: const exns: Array<{ exn: Record<string, unknown>; paths: Record<string, string> }> = [];
558: Record<string, unknown> :: private verifyMembership(route: string, payload: Record<string, unknown>): string | null {
597: Record<string, unknown> :: export function embeddedBusinessExnSAD(serder: SerderKERI): Record<string, unknown> | null {
658: Record<string, unknown> :: function embeddedSection(ked: Record<string, unknown>): Record<string, unknown> | null {
658: Record<string, unknown> :: function embeddedSection(ked: Record<string, unknown>): Record<string, unknown> | null {
666: Record<string, unknown> :: function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
666: Record<string, unknown> :: function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
670: Record<string, unknown> :: function routeMembers(payload: Record<string, unknown>): string[] {
677: Record<string, unknown> :: function stringArrayField(record: Record<string, unknown>, field: string): string[] {
682: Record<string, unknown> :: function stringField(record: Record<string, unknown>, field: string): string {
702: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/app/habbing.ts

```text
424: Record<string, unknown> :: private acceptReply(route: string, data: Record<string, unknown>, stamp: string): void {
449: Record<string, unknown> :: configuredSection(): Record<string, unknown> | null {
450: Record<string, unknown> :: const conf = this.cf?.get<Record<string, unknown>>() ?? {};
453: Record<string, unknown> :: ? section as Record<string, unknown>
849: Record<string, unknown> :: data: Record<string, unknown>,
869: Record<string, unknown> :: query: Record<string, unknown> = {},
1495: Record<string, unknown> :: get config(): Record<string, unknown> {
1496: Record<string, unknown> :: return this.cf?.get<Record<string, unknown>>() ?? {};
```

### packages/keri/src/app/ipex-building.ts

```text
26: Record<string, unknown> :: attrs?: Record<string, unknown>;
106: Record<string, unknown> :: ? (schema as Record<string, unknown>).$id as string
113: Record<string, unknown> :: const modifiers: Record<string, unknown> = {};
```

### packages/keri/src/app/ipex-credentialing.ts

```text
313: Record<string, unknown> :: const said = (acdc as Record<string, unknown>).d;
332: Record<string, unknown> :: const issuee = (attrib as Record<string, unknown>).i;
338: Record<string, unknown> :: function embeddedSection(serder: SerderKERI): Record<string, unknown> | null {
344: Record<string, unknown> :: return ked.e as Record<string, unknown>;
348: Record<string, unknown> :: const embeds = (attrs as Record<string, unknown>).e;
350: Record<string, unknown> :: return embeds as Record<string, unknown>;
360: Record<string, unknown> :: return new SerderKERI({ sad: value as Record<string, unknown> }).raw;
367: Record<string, unknown> :: return new SerderACDC({ sad: value as Record<string, unknown>, verify: false }).raw;
```

### packages/keri/src/app/ipex-graph.ts

```text
22: Record<string, unknown> :: function record(value: unknown): value is Record<string, unknown> {
39: Record<string, unknown> :: function blocks(value: unknown): Record<string, unknown>[] | null {
200: Record<string, unknown> :: group: Record<string, unknown>,
231: Record<string, unknown> :: group: Record<string, unknown>,
```

### packages/keri/src/app/ipex-grouping.ts

```text
477: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/app/ipex-v2.ts

```text
44: Record<string, unknown> :: function record(value: unknown): value is Record<string, unknown> {
215: Record<string, unknown> :: this.notifier?.add({ r: `/exn${serder.route}`, d: serder.said, m: (serder.sad!.a as Record<string, unknown>).m });
457: Record<string, unknown> :: sections.push(...aggregate.slice(1) as Record<string, unknown>[]);
```

### packages/keri/src/app/ipexing.ts

```text
340: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/app/multisig-workflows.ts

```text
103: Record<string, unknown> :: payload: Record<string, unknown>,
122: Record<string, unknown> :: payload: Record<string, unknown>,
515: Record<string, unknown> :: payload: Record<string, unknown>,
524: Record<string, unknown> :: function proposalMembers(route: MultisigKelRoute, payload: Record<string, unknown>): string[] {
531: Record<string, unknown> :: function proposalSigningMembers(payload: Record<string, unknown>): string[] {
714: Record<string, unknown> :: const attrs = serder.ked?.a as Record<string, unknown> | undefined;
736: Record<string, unknown> :: function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
736: Record<string, unknown> :: function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
740: Record<string, unknown> :: function embeddedSection(ked: Record<string, unknown>): Record<string, unknown> | null {
740: Record<string, unknown> :: function embeddedSection(ked: Record<string, unknown>): Record<string, unknown> | null {
748: Record<string, unknown> :: function stringArrayField(record: Record<string, unknown>, field: string): string[] {
753: Record<string, unknown> :: function stringField(record: Record<string, unknown>, field: string): string {
758: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/app/oobiery.ts

```text
457: Record<string, unknown> :: const data = serder.ked?.a as Record<string, unknown> | undefined;
596: Record<string, unknown> :: const data = args.serder.ked?.a as Record<string, unknown> | undefined;
700: Record<string, unknown> :: const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
716: Record<string, unknown> :: const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
733: Record<string, unknown> :: const attrs: Record<string, unknown> = {
```

### packages/keri/src/app/organizing.ts

```text
8: Record<string, unknown> :: export interface ContactRecord extends Record<string, unknown> {
41: Record<string, unknown> :: const parsed = JSON.parse(raw) as Record<string, unknown> | null;
57: Record<string, unknown> :: data: Record<string, unknown>,
125: Record<string, unknown> :: const next: Record<string, unknown> = {};
```

### packages/keri/src/app/querying.ts

```text
60: Record<string, unknown> :: query: Record<string, unknown>;
178: Record<string, unknown> :: query: Record<string, unknown>,
179: Record<string, unknown> :: ): Record<string, unknown> {
197: Record<string, unknown> :: function queryBodyFromCue(cue: QueryCue): Record<string, unknown> {
218: Record<string, unknown> :: function normalizeOutboundQuery(cue: QueryCue): Record<string, unknown> {
472: Record<string, unknown> :: readonly anchor: Record<string, unknown>;
480: Record<string, unknown> :: anchor: Record<string, unknown>,
600: Record<string, unknown> :: anchor: Record<string, unknown>,
```

### packages/keri/src/app/signaling.ts

```text
15: Record<string, unknown> :: export type SignalAttrs = Record<string, unknown>;
```

### packages/keri/src/app/verifier-agent.ts

```text
50: Record<string, unknown> :: data: Record<string, unknown>;
448: Record<string, unknown> :: function presentationPayload(creder: SerderACDC): Record<string, unknown> {
461: Record<string, unknown> :: function revocationPayload(reger: Reger, creder: SerderACDC): Record<string, unknown> {
498: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/app/verifying.ts

```text
95: Map<string, unknown> :: get tevers(): Map<string, unknown> {
419: Record<string, unknown> :: function normalizedEdges(edge: unknown): Record<string, unknown>[] | null {
439: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/core/cues.ts

```text
48: Record<string, unknown> :: query?: Record<string, unknown>;
49: Record<string, unknown> :: q?: Record<string, unknown>;
78: Record<string, unknown> :: data?: Record<string, unknown>;
113: Record<string, unknown> :: q: Record<string, unknown>;
```

### packages/keri/src/core/errors.ts

```text
10: Record<string, unknown> :: public readonly context?: Record<string, unknown>,
```

### packages/keri/src/core/eventing.ts

```text
334: Record<string, unknown> :: const query = envelope.serder.ked?.q as Record<string, unknown> | undefined;
365: Record<string, unknown> :: const query = envelope.serder.ked?.q as Record<string, unknown> | undefined;
1381: Record<string, unknown> :: const data = args.serder.ked?.a as Record<string, unknown> | undefined;
1445: Record<string, unknown> :: const query = serder.ked?.q as Record<string, unknown> | undefined;
2777: Record<string, unknown> :: || typeof (anchor as Record<string, unknown>)["i"] !== "string"
2778: Record<string, unknown> :: || typeof (anchor as Record<string, unknown>)["d"] !== "string"
```

### packages/keri/src/core/exchange-proofing.ts

```text
83: Record<string, unknown> :: && (item as Record<string, unknown>).d === serder.said
```

### packages/keri/src/core/kever-decisions.ts

```text
96: Record<string, unknown> :: context?: Record<string, unknown>;
104: Record<string, unknown> :: context?: Record<string, unknown>;
142: Record<string, unknown> :: context?: Record<string, unknown>;
150: Record<string, unknown> :: context?: Record<string, unknown>;
211: Record<string, unknown> :: context?: Record<string, unknown>;
219: Record<string, unknown> :: context?: Record<string, unknown>;
227: Record<string, unknown> :: context?: Record<string, unknown>;
```

### packages/keri/src/core/kever.ts

```text
2111: Record<string, unknown> :: context?: Record<string, unknown>,
2120: Record<string, unknown> :: context?: Record<string, unknown>,
```

### packages/keri/src/core/protocol-eventing.ts

```text
166: Record<string, unknown> :: ked: Record<string, unknown>,
373: Record<string, unknown> :: const sad: Record<string, unknown> = {
491: Record<string, unknown> :: const sad: Record<string, unknown> = {
582: Record<string, unknown> :: queryData: Record<string, unknown> = {},
599: Record<string, unknown> :: const sad: Record<string, unknown> = {
621: Record<string, unknown> :: data: Record<string, unknown> = {},
637: Record<string, unknown> :: const sad: Record<string, unknown> = {
658: Record<string, unknown> :: queryData: Record<string, unknown> = {},
675: Record<string, unknown> :: const sad: Record<string, unknown> = {
697: Record<string, unknown> :: data: Record<string, unknown> = {},
713: Record<string, unknown> :: const sad: Record<string, unknown> = {
747: Record<string, unknown> :: modifiers?: Record<string, unknown>;
748: Record<string, unknown> :: attributes?: Record<string, unknown>;
796: Record<string, unknown> :: modifiers?: Record<string, unknown>;
797: Record<string, unknown> :: attributes?: Record<string, unknown>;
```

### packages/keri/src/core/protocol-exchanging.ts

```text
44: Record<string, unknown> :: ): { e: Record<string, unknown>; end: Uint8Array } {
45: Record<string, unknown> :: const e: Record<string, unknown> = {};
97: Record<string, unknown> :: modifiers?: Record<string, unknown>;
98: Record<string, unknown> :: attributes?: Record<string, unknown>;
130: Record<string, unknown> :: payload: Record<string, unknown> = {},
153: Record<string, unknown> :: modifiers?: Record<string, unknown>;
194: Record<string, unknown> :: const attrs: Record<string, unknown> = {};
```

### packages/keri/src/core/protocol-serialization.ts

```text
479: Record<string, unknown> :: ): Record<string, unknown> {
485: Record<string, unknown> :: const event: Record<string, unknown> = { ked: serder.ked };
511: Record<string, unknown> :: const receipts: Record<string, unknown> = {};
```

### packages/keri/src/core/protocol-vdr-eventing.ts

```text
48: Record<string, unknown> :: function cloneSealDict(seal?: Record<string, unknown> | SealEvent): Record<string, unknown> {
48: Record<string, unknown> :: function cloneSealDict(seal?: Record<string, unknown> | SealEvent): Record<string, unknown> {
52: Record<string, unknown> :: const record = seal as Record<string, unknown>;
414: Record<string, unknown> :: anchor: Record<string, unknown>,
420: Record<string, unknown> :: ra?: Record<string, unknown> | SealEvent;
470: Record<string, unknown> :: const qry: Record<string, unknown> = { i: vcid, ri: regk };
```

### packages/keri/src/core/records.ts

```text
35: Record<string, unknown> :: ): value is Record<string, unknown> {
107: Record<string, unknown> :: TShape extends object | undefined = Record<string, unknown>,
143: Record<string, unknown> :: asDict(): Record<string, unknown> {
146: Record<string, unknown> :: ) as Record<string, unknown>;
150: Record<string, unknown> :: _asdict(): Record<string, unknown> {
351: Record<string, unknown> :: ra?: Record<string, unknown>;
352: Record<string, unknown> :: a?: Record<string, unknown>;
364: Record<string, unknown> :: declare ra?: Record<string, unknown>;
365: Record<string, unknown> :: declare a?: Record<string, unknown>;
```

### packages/keri/src/core/routing.ts

```text
29: Record<string, unknown> :: context?: Record<string, unknown>;
66: Record<string, unknown> :: context?: Record<string, unknown>,
969: Record<string, unknown> :: const data = args.serder.ked?.a as Record<string, unknown> | undefined;
1034: Record<string, unknown> :: const data = args.serder.ked?.a as Record<string, unknown> | undefined;
```

### packages/keri/src/core/scheming.ts

```text
14: Record<string, unknown> :: type JsonObject = Record<string, unknown>;
```

### packages/keri/src/db/escrowing.ts

```text
332: Record<string, unknown> :: const state = serder.sad?.a as Record<string, unknown> | undefined;
```

### packages/keri/src/db/noting.ts

```text
23: Record<string, unknown> :: export type NoticeAttrs = Record<string, unknown>;
```

### packages/keri/src/db/reger.ts

```text
101: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
113: Map<string, unknown> :: public readonly tevers = new Map<string, unknown>();
```

### packages/keri/src/did/webs/designated-aliases.ts

```text
177: Record<string, unknown> :: function designatedAliasRules(): Record<string, unknown> {
321: Record<string, unknown> :: function cloneJsonObject(value: unknown): Record<string, unknown> {
322: Record<string, unknown> :: return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
325: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/did/webs/dids.ts

```text
266: Record<string, unknown> :: const result: Record<string, unknown> = {};
```

### packages/keri/src/did/webs/documenting.ts

```text
19: Record<string, unknown> :: readonly didResolutionMetadata: Record<string, unknown>;
20: Record<string, unknown> :: readonly didDocumentMetadata: Record<string, unknown>;
23: Record<string, unknown> :: export interface DidDocument extends Record<string, unknown> {
32: Record<string, unknown> :: type VerificationMethodEntry = Record<string, unknown> & { id: string };
157: Record<string, unknown> :: ): Array<Record<string, unknown>> {
158: Record<string, unknown> :: const entries: Array<Record<string, unknown>> = [];
234: Record<string, unknown> :: function pruneEmpty(value: Record<string, unknown>): Record<string, unknown> {
234: Record<string, unknown> :: function pruneEmpty(value: Record<string, unknown>): Record<string, unknown> {
235: Record<string, unknown> :: const result: Record<string, unknown> = {};
```

### packages/keri/src/did/webs/resolving.ts

```text
182: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/src/vdr/credential-tsn.ts

```text
28: Record<string, unknown> :: const row = data as Record<string, unknown>;
37: Record<string, unknown> :: const a = row.a as Record<string, unknown>, ra = row.ra as Record<string, unknown>;
37: Record<string, unknown> :: const a = row.a as Record<string, unknown>, ra = row.ra as Record<string, unknown>;
```

### packages/keri/src/vdr/credentialing.ts

```text
82: Record<string, unknown> :: data?: Record<string, unknown> | string;
84: Record<string, unknown> :: edges?: Record<string, unknown> | Record<string, unknown>[];
84: Record<string, unknown> :: edges?: Record<string, unknown> | Record<string, unknown>[];
85: Record<string, unknown> :: rules?: Record<string, unknown> | Record<string, unknown>[];
85: Record<string, unknown> :: rules?: Record<string, unknown> | Record<string, unknown>[];
179: Record<string, unknown> :: data: Record<string, unknown> | string | undefined,
183: Record<string, unknown> :: ): Record<string, unknown> | string {
187: Record<string, unknown> :: const attrs: Record<string, unknown> = { d: "" };
200: Record<string, unknown> :: data: Record<string, unknown> | string,
202: Record<string, unknown> :: ): Record<string, unknown> | string {
214: Record<string, unknown> :: value?: Record<string, unknown> | Record<string, unknown>[],
214: Record<string, unknown> :: value?: Record<string, unknown> | Record<string, unknown>[],
215: Record<string, unknown> :: ): Record<string, unknown> | Record<string, unknown>[] | undefined {
215: Record<string, unknown> :: ): Record<string, unknown> | Record<string, unknown>[] | undefined {
241: Record<string, unknown> :: const sad: Record<string, unknown> = {
550: Record<string, unknown> :: data?: Record<string, unknown> | string;
552: Record<string, unknown> :: edges?: Record<string, unknown> | Record<string, unknown>[];
552: Record<string, unknown> :: edges?: Record<string, unknown> | Record<string, unknown>[];
553: Record<string, unknown> :: rules?: Record<string, unknown> | Record<string, unknown>[];
553: Record<string, unknown> :: rules?: Record<string, unknown> | Record<string, unknown>[];
```

### packages/keri/src/vdr/eventing.ts

```text
141: Record<string, unknown> :: function okKed(serder: SerderKERI): Record<string, unknown> {
228: Record<string, unknown> :: data: Record<string, unknown>,
236: Record<string, unknown> :: data: Record<string, unknown>,
243: Record<string, unknown> :: function sealRecord(value: unknown): Record<string, unknown> | null {
244: Record<string, unknown> :: return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
849: Record<string, unknown> :: ked: Record<string, unknown>,
1032: Record<string, unknown> :: const query = serder.ked?.q as Record<string, unknown> | undefined;
```

### packages/keri/src/vdr/registry-tsn.ts

```text
30: Record<string, unknown> :: const row = data as Record<string, unknown>;
```

### packages/keri/src/vdr/tsn-query.ts

```text
23: Record<string, unknown> :: const query = serder.ked?.q as Record<string, unknown> | undefined;
29: Record<string, unknown> :: const response = (route: string, data: Record<string, unknown>): ReplyCue => ({
```

### packages/keri/test/integration/app/acdc-verifier-workflow.test.ts

```text
49: Record<string, unknown> :: function parseJsonLine(output: string): Record<string, unknown> {
58: Record<string, unknown> :: return JSON.parse(line) as Record<string, unknown>;
73: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
144: Record<string, unknown> :: const webhookBodies: Record<string, unknown>[] = [];
149: Record<string, unknown> :: webhookBodies.push(JSON.parse(await request.text()) as Record<string, unknown>);
259: Record<string, unknown> :: const firstResult = parseJsonLine(firstVerifierRun.stdout).result as Record<string, unknown>;
264: Record<string, unknown> :: assertEquals((webhookBodies[0]!.data as Record<string, unknown>).credential, credentialSaid);
265: Record<string, unknown> :: assertEquals((webhookBodies[0]!.data as Record<string, unknown>).recipient, holderPre);
297: Record<string, unknown> :: const secondResult = parseJsonLine(secondVerifierRun.stdout).result as Record<string, unknown>;
301: Record<string, unknown> :: assertEquals((webhookBodies[1]!.data as Record<string, unknown>).credential, credentialSaid);
314: Record<string, unknown> :: const thirdResult = parseJsonLine(thirdVerifierRun.stdout).result as Record<string, unknown>;
```

### packages/keri/test/integration/app/db-dump.test.ts

```text
22: Record<string, unknown> :: async function captureDump(args: Record<string, unknown>): Promise<{
```

### packages/keri/test/integration/app/interop-acdc-kli-tufa.test.ts

```text
16: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
53: Record<string, unknown> :: function parseJsonLine(output: string): Record<string, unknown> {
62: Record<string, unknown> :: return JSON.parse(line) as Record<string, unknown>;
192: Record<string, unknown> :: const schemaSaid = (JSON.parse(await Deno.readTextFile(schemaPath)) as Record<string, unknown>)["$id"] as string;
458: Record<string, unknown> :: const verifierResult = parseJsonLine(verifierRun.stdout).result as Record<string, unknown>;
464: Record<string, unknown> :: const hookPresentation = await hookResponse.json() as Record<string, unknown>;
534: Record<string, unknown> :: const revocationResult = parseJsonLine(revocationRun.stdout).result as Record<string, unknown>;
```

### packages/keri/test/integration/app/interop-acdc-mixed-chain-i2i.test.ts

```text
53: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
157: Record<string, unknown> :: const health = await response.json() as Record<string, unknown>;
180: Record<string, unknown> :: function parseJsonLine(output: string): Record<string, unknown> {
189: Record<string, unknown> :: return JSON.parse(line) as Record<string, unknown>;
224: Record<string, unknown> :: const schema = JSON.parse(await Deno.readTextFile(schemaPath)) as Record<string, unknown>;
476: Record<string, unknown> :: edges?: Record<string, unknown>;
535: Record<string, unknown> :: edges?: Record<string, unknown>;
820: Record<string, unknown> :: const body = await response.json() as Record<string, unknown>;
861: Record<string, unknown> :: ): Record<string, unknown> {
1258: Record<string, unknown> :: const verifierResult = parseJsonLine(verifierRun.stdout).result as Record<string, unknown>;
1275: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/test/integration/app/interop-acdc-mixed-chain-ni2i.test.ts

```text
53: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
157: Record<string, unknown> :: const health = await response.json() as Record<string, unknown>;
180: Record<string, unknown> :: function parseJsonLine(output: string): Record<string, unknown> {
189: Record<string, unknown> :: return JSON.parse(line) as Record<string, unknown>;
224: Record<string, unknown> :: const schema = JSON.parse(await Deno.readTextFile(schemaPath)) as Record<string, unknown>;
476: Record<string, unknown> :: edges?: Record<string, unknown>;
535: Record<string, unknown> :: edges?: Record<string, unknown>;
820: Record<string, unknown> :: const body = await response.json() as Record<string, unknown>;
861: Record<string, unknown> :: ): Record<string, unknown> {
1182: Record<string, unknown> :: const verifierResult = parseJsonLine(verifierRun.stdout).result as Record<string, unknown>;
1199: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/keri/test/integration/app/interop-acdc-tufa-kli-holder.test.ts

```text
17: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
54: Record<string, unknown> :: function parseJsonLine(output: string): Record<string, unknown> {
63: Record<string, unknown> :: return JSON.parse(line) as Record<string, unknown>;
237: Record<string, unknown> :: const schemaSaid = (JSON.parse(await Deno.readTextFile(schemaPath)) as Record<string, unknown>)["$id"] as string;
723: Record<string, unknown> :: const verifierResult = parseJsonLine(verifierRun.stdout).result as Record<string, unknown>;
729: Record<string, unknown> :: const hookPresentation = await hookResponse.json() as Record<string, unknown>;
```

### packages/keri/test/integration/app/interop-delegation-kli-tufa.test.ts

```text
56: Record<string, unknown> :: attrs: Record<string, unknown>;
```

### packages/keri/test/integration/app/interop-saidify-kli-tufa.test.ts

```text
32: Record<string, unknown> :: sad: Record<string, unknown>,
```

### packages/keri/test/integration/app/interop-test-helpers.ts

```text
1427: Record<string, unknown> :: const parsed = JSON.parse(raw) as Record<string, unknown>;
1436: Record<string, unknown> :: ...(node as Record<string, unknown>),
```

### packages/keri/test/unit/app/cesr-http.test.ts

```text
28: Record<string, unknown> :: payload: Record<string, unknown>,
366: Record<string, unknown> :: (serder.ked?.a as Record<string, unknown> | undefined)?.role,
```

### packages/keri/test/unit/app/configing.test.ts

```text
8: Record<string, unknown> :: expected: Record<string, unknown>,
9: Record<string, unknown> :: ): Promise<Record<string, unknown>> {
17: Record<string, unknown> :: return cf.get<Record<string, unknown>>();
34: Record<string, unknown> :: expected: Record<string, unknown>,
40: Record<string, unknown> :: const loaded = cf.get<Record<string, unknown>>();
```

### packages/keri/test/unit/app/endpoint-roleing.test.ts

```text
43: Record<string, unknown> :: const sent: Record<string, unknown>[] = [];
53: Record<string, unknown> :: args: Record<string, unknown>,
74: Record<string, unknown> :: assertExists((sent[0]?.embeds as Record<string, unknown>).rpy);
```

### packages/keri/test/unit/app/exchanging.test.ts

```text
14: Record<string, unknown> :: payload: Record<string, unknown>,
47: Record<string, unknown> :: Object.keys((withRecipient.ked?.a as Record<string, unknown>) ?? {}),
51: Record<string, unknown> :: (withRecipient.ked?.a as Record<string, unknown>)["i"],
60: Record<string, unknown> :: Object.keys((withoutRecipient.ked?.a as Record<string, unknown>) ?? {}),
64: Record<string, unknown> :: (withoutRecipient.ked?.a as Record<string, unknown>)["i"],
```

### packages/keri/test/unit/app/forwarding.test.ts

```text
55: Record<string, unknown> :: payload: Record<string, unknown>,
63: Record<string, unknown> :: payload: Record<string, unknown>,
422: Record<string, unknown> :: ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
422: Record< string, unknown > :: ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
787: Record<string, unknown> :: ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
787: Record< string, unknown > :: ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
794: Record<string, unknown> :: ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
794: Record< string, unknown > :: ((delivered.ked?.e as Record<string, unknown>)["evt"] as Record<
1135: Record<string, unknown> :: role: (serder.ked?.a as Record<string, unknown> | undefined)?.role,
1136: Record<string, unknown> :: eid: (serder.ked?.a as Record<string, unknown> | undefined)?.eid,
```

### packages/keri/test/unit/app/grouping-nests.test.ts

```text
56: Record<string, unknown> :: function proposal(sender: Hab, route: string, child: CesrFrame, payload: Record<string, unknown>): ExchangeInput {
252: Record<string, unknown> :: serder.a as Record<string, unknown>,
257: Record<string, unknown> :: assertEquals((serder.a as Record<string, unknown>)[serder.route!.split("/").at(-1)!], child.body.said);
455: Record<string, unknown> :: assertEquals((parent.a as Record<string, unknown>).icp, child.body.said);
```

### packages/keri/test/unit/app/grouping.test.ts

```text
60: Record<string, unknown> :: assertExists((micp.ked?.e as Record<string, unknown>).icp);
65: Record<string, unknown> :: assertExists((vcpExn.ked?.e as Record<string, unknown>).vcp);
66: Record<string, unknown> :: assertExists((vcpExn.ked?.e as Record<string, unknown>).anc);
71: Record<string, unknown> :: assertExists((issExn.ked?.e as Record<string, unknown>).acdc);
72: Record<string, unknown> :: assertExists((issExn.ked?.e as Record<string, unknown>).iss);
73: Record<string, unknown> :: assertExists((issExn.ked?.e as Record<string, unknown>).anc);
78: Record<string, unknown> :: assertExists((revExn.ked?.e as Record<string, unknown>).rev);
79: Record<string, unknown> :: assertExists((revExn.ked?.e as Record<string, unknown>).anc);
84: Record<string, unknown> :: assertExists((rpyExn.ked?.e as Record<string, unknown>).rpy);
136: Record<string, unknown> :: const embeddedSaid = (wrapped.ked?.e as Record<string, unknown>).d as string;
```

### packages/keri/test/unit/app/habbing.test.ts

```text
41: Record<string, unknown> :: payload: Record<string, unknown>,
49: Record<string, unknown> :: payload: Record<string, unknown>,
318: Record<string, unknown> :: query: Record<string, unknown>;
335: Record<string, unknown> :: payload: Record<string, unknown>;
387: Record<string, unknown> :: query: Record<string, unknown>;
434: Record<string, unknown> :: (request.ked?.e as Record<string, Record<string, unknown>>)?.evt?.["i"],
438: Record<string, unknown> :: (request.ked?.e as Record<string, Record<string, unknown>>)?.evt?.["t"],
722: Record<string, unknown> :: query: Record<string, unknown>;
739: Record<string, unknown> :: payload: Record<string, unknown>;
770: Record<string, unknown> :: query: Record<string, unknown>;
```

### packages/keri/test/unit/app/ipex-credentialing.test.ts

```text
27: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
```

### packages/keri/test/unit/app/ipexing.test.ts

```text
73: Record<string, unknown> :: assertEquals((offer.ked?.a as Record<string, unknown>)["m"], "offer");
```

### packages/keri/test/unit/app/mailbox-poller-runtime.test.ts

```text
22: Record<string, unknown> :: payload: Record<string, unknown>,
```

### packages/keri/test/unit/app/mailbox-runtime-slow.test.ts

```text
38: Record<string, unknown> :: payload: Record<string, unknown>,
46: Record<string, unknown> :: payload: Record<string, unknown>,
421: Record<string, unknown> :: assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
448: Record<string, unknown> :: assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
475: Record<string, unknown> :: assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
508: Record<string, unknown> :: assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
532: Record<string, unknown> :: assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
564: Record<string, unknown> :: assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
```

### packages/keri/test/unit/app/mailbox-runtime.test.ts

```text
57: Record<string, unknown> :: payload: Record<string, unknown>,
65: Record<string, unknown> :: payload: Record<string, unknown>,
673: Record<string, unknown> :: assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
867: Record<string, unknown> :: assertEquals(yield* jsonOp<Record<string, unknown>>(admin), {
```

### packages/keri/test/unit/app/notifications-cli.test.ts

```text
13: Record<string, unknown> :: args: Record<string, unknown>,
15: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/keri/test/unit/app/notifying.test.ts

```text
14: Record<string, unknown> :: payload: Record<string, unknown>,
22: Record<string, unknown> :: payload: Record<string, unknown>,
270: Record<string, unknown> :: (notices[0]!.attrs["ked"] as Record<string, unknown>)["i"],
```

### packages/keri/test/unit/app/protocol/mailbox-admin.test.ts

```text
16: Record<string, unknown> :: data: Record<string, unknown>,
```

### packages/keri/test/unit/app/querying.test.ts

```text
167: Record<string, unknown> :: (emissions[0]?.serder?.ked?.q as Record<string, unknown>).i,
171: Record<string, unknown> :: (emissions[0]?.serder?.ked?.q as Record<string, unknown>).src,
175: Record<string, unknown> :: (emissions[0]?.serder?.ked?.q as Record<string, unknown>).pre,
339: Record<string, unknown> :: (emissions[0]?.serder?.ked?.q as Record<string, unknown>).src,
```

### packages/keri/test/unit/app/replay-source.test.ts

```text
199: Record<string, unknown> :: delete (hby.db as unknown as Record<string, unknown>).retainedProbe;
```

### packages/keri/test/unit/app/schema-oobi.test.ts

```text
14: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
```

### packages/keri/test/unit/app/verifier-agent.test.ts

```text
16: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
128: Record<string, unknown> :: const requests: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
137: Record<string, unknown> :: body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
166: Record<string, unknown> :: assertEquals((requests[0]!.body.data as Record<string, unknown>).credential, fixture.creder.said);
167: Record<string, unknown> :: assertEquals((requests[0]!.body.data as Record<string, unknown>).recipient, fixture.verifier.pre);
204: Record<string, unknown> :: const requests: Array<Record<string, unknown>> = [];
212: Record<string, unknown> :: requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
288: Record<string, unknown> :: assertEquals((requests[1]!.data as Record<string, unknown>).credential, fixture.creder.said);
289: Record<string, unknown> :: assertExists((requests[1]!.data as Record<string, unknown>).revocationTimestamp);
324: Record<string, unknown> :: const requests: Array<Record<string, unknown>> = [];
332: Record<string, unknown> :: requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
```

### packages/keri/test/unit/app/verifying.test.ts

```text
38: Record<string, unknown> :: ): Record<string, unknown> {
90: Record<string, unknown> :: attrib?: Record<string, unknown>;
91: Record<string, unknown> :: edge?: Record<string, unknown>;
```

### packages/keri/test/unit/core/eventing.test.ts

```text
47: Record<string, unknown> :: const target = kvy as unknown as Record<string, unknown>;
66: Record<string, unknown> :: const target = kvy as unknown as Record<string, unknown>;
2639: Record<string, unknown> :: const target = kvy as unknown as Record<string, unknown>;
2640: Map<string, unknown> :: const originals = new Map<string, unknown>();
```

### packages/keri/test/unit/core/kevery-query.test.ts

```text
168: Record<string, unknown> :: (cue.serder?.ked?.a as Record<string, unknown> | undefined)?.i,
```

### packages/keri/test/unit/core/protocol-eventing.test.ts

```text
103: Record<string, unknown> :: assertEquals((dip.ked as Record<string, unknown>).di, RECIPIENT);
123: Record<string, unknown> :: assertEquals((rot.ked as Record<string, unknown>).c, ["EO"]);
```

### packages/keri/test/unit/core/scheming.test.ts

```text
8: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
61: Record<string, unknown> :: const make = (attribute: Record<string, unknown>, extra = {}) =>
73: Record<string, unknown> :: const credential = (schema: Record<string, unknown> | string, name: string | number | null = "Ada") =>
143: Record<string, unknown> :: const bundled: Record<string, unknown> = {
185: Record<string, unknown> :: const deep: Record<string, unknown> = {};
187: Record<string, unknown> :: for (let i = 0; i < 70; i++) next = next.child = {} as Record<string, unknown>;
```

### packages/keri/test/unit/db/escrowing.test.ts

```text
354: Record<string, unknown> :: visited.push(String((serder.sad!.a as Record<string, unknown>).i));
377: Record<string, unknown> :: next.push(String((serder.sad!.a as Record<string, unknown>).i));
```

### packages/keri/test/unit/db/reger.test.ts

```text
60: Record<string, unknown> :: extra: Record<string, unknown> = {},
```

### packages/keri/test/unit/did/webs.test.ts

```text
525: Record<string, unknown> :: type VerificationMethodDocument = Record<string, unknown> & {
539: Record<string, unknown> :: function verificationMethodMap(document: Record<string, unknown>): Map<string, VerificationMethodDocument> {
578: Record<string, unknown> :: function assertConditionalProofMethods(document: Record<string, unknown>): void {
```

### packages/keri/test/unit/vdr/credentialing.test.ts

```text
32: Record<string, unknown> :: function schemaSed(): Record<string, unknown> {
70: Record<string, unknown> :: (creder.sad?.a as Record<string, unknown>).d,
```

### packages/keri/test/unit/vdr/eventing.test.ts

```text
820: Record<string, unknown> :: const queries: Record<string, unknown>[] = [];
831: Record<string, unknown> :: queries.push(envelopeFromFrame(frame).serder.ked!.q as Record<string, unknown>);
1028: Record<string, unknown> :: a: { ...(state.a as Record<string, unknown>), s: Number((state.a as Record<string, unknown>).s) + 1 },
1028: Record<string, unknown> :: a: { ...(state.a as Record<string, unknown>), s: Number((state.a as Record<string, unknown>).s) + 1 },
1218: Record<string, unknown> :: const fresh = reply(`/tsn/credential/${issuer.pre}`, notice.ked!.a as Record<string, unknown>, {
```

### packages/keri/test/utils.ts

```text
165: [key: string]: unknown :: [key: string]: unknown;
173: Record<string, unknown> :: ): Record<string, unknown> {
```

### packages/tufa/scripts/build_npm.ts

```text
38: Record<string, unknown> :: exports?: Record<string, unknown>;
```

### packages/tufa/src/cli/agent.ts

```text
52: Record<string, unknown> :: function schemaInputsFromArgs(args: Record<string, unknown>): {
135: Record<string, unknown> :: export function* agentCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/tufa/src/cli/command-definitions/challenge.ts

```text
35: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
77: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
144: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-definitions/credentials.ts

```text
366: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({ http: options.http }),
```

### packages/tufa/src/cli/command-definitions/endpoints.ts

```text
44: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
89: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
128: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
159: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
201: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-definitions/identity.ts

```text
54: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
105: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
144: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
182: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
214: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
249: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-definitions/lifecycle.ts

```text
459: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-definitions/mailbox.ts

```text
42: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
86: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
128: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
165: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
204: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
245: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-definitions/messaging.ts

```text
84: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-definitions/notifications.ts

```text
43: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
73: Record<string, unknown> :: args: (rid: string, options: Record<string, unknown>) => ({
102: Record<string, unknown> :: args: (rid: string, options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-definitions/options.ts

```text
69: Record<string, unknown> :: export function witnessAuthArgs(options: Record<string, unknown>): Record<string, unknown> {
69: Record<string, unknown> :: export function witnessAuthArgs(options: Record<string, unknown>): Record<string, unknown> {
79: Record<string, unknown> :: export function dispatchArgs(options: Record<string, unknown>): Record<string, unknown> {
79: Record<string, unknown> :: export function dispatchArgs(options: Record<string, unknown>): Record<string, unknown> {
```

### packages/tufa/src/cli/command-definitions/shared.ts

```text
13: Record<string, unknown> :: type CommandModule = Record<string, unknown>;
```

### packages/tufa/src/cli/command-definitions/tooling.ts

```text
52: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-definitions/witness.ts

```text
50: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
94: Record<string, unknown> :: args: (options: Record<string, unknown>) => ({
```

### packages/tufa/src/cli/command-types.ts

```text
4: Record<string, unknown> :: export type CommandArgs = Record<string, unknown>;
```

### packages/tufa/src/cli/dws.ts

```text
30: Record<string, unknown> :: export function* dwsResolverCommand(args: Record<string, unknown>): Operation<void> {
```

### packages/tufa/src/cli/hook.ts

```text
13: Record<string, unknown> :: attributes: Record<string, unknown>;
17: Record<string, unknown> :: export function* hookDemoCommand(args: Record<string, unknown>): Operation<void> {
132: Record<string, unknown> :: function isRecord(value: unknown): value is Record<string, unknown> {
```

### packages/tufa/src/cli/mailbox.ts

```text
91: Record<string, unknown> :: args: Record<string, unknown>,
99: Record<string, unknown> :: args: Record<string, unknown>,
110: Record<string, unknown> :: args: Record<string, unknown>,
163: Record<string, unknown> :: args: Record<string, unknown>,
192: Record<string, unknown> :: args: Record<string, unknown>,
238: Record<string, unknown> :: args: Record<string, unknown>,
422: Record<string, unknown> :: function parseMailboxBaseArgs(args: Record<string, unknown>): MailboxBaseArgs {
439: Record<string, unknown> :: args: Record<string, unknown>,
464: Record<string, unknown> :: args: Record<string, unknown>,
502: Record<string, unknown> :: ): Record<string, unknown> | null {
515: Record<string, unknown> :: return JSON.parse(Deno.readTextFileSync(path)) as Record<string, unknown>;
```

### packages/tufa/src/cli/witness.ts

```text
55: Record<string, unknown> :: args: Record<string, unknown>,
79: Record<string, unknown> :: startConfig?.get<Record<string, unknown>>() ?? null,
110: Record<string, unknown> :: args: Record<string, unknown>,
165: Record<string, unknown> :: args: Record<string, unknown>,
```

### packages/tufa/src/http/protocol/endpoints/generic-cesr-ingress.ts

```text
85: Record<string, unknown> :: const query = serder.ked?.q as Record<string, unknown> | undefined;
```

### packages/tufa/src/http/protocol/endpoints/mailbox-admin.ts

```text
136: Record<string, unknown> :: const data = serder.ked?.a as Record<string, unknown> | undefined;
```

### packages/tufa/src/operator/mailbox-startup.ts

```text
68: Record<string, unknown> :: config: Record<string, unknown> | null,
92: Record<string, unknown> :: const data = section as Record<string, unknown>;
131: Record<string, unknown> :: config: Record<string, unknown> | null,
```

### packages/tufa/src/operator/witness-startup.ts

```text
82: Record<string, unknown> :: config: Record<string, unknown> | null,
97: Record<string, unknown> :: const data = section as Record<string, unknown>;
183: Record<string, unknown> :: config: Record<string, unknown> | null,
```

### packages/tufa/test/integration/multisig-nested.test.ts

```text
424: Record<string, unknown> :: return [(method as { id: string }).id, method as Record<string, unknown>];
488: Record<string, unknown> :: function parseLastJson(output: string): Record<string, unknown> {
493: Record<string, unknown> :: return JSON.parse(line) as Record<string, unknown>;
496: Record<string, unknown> :: function stringField(record: Record<string, unknown>, key: string): string {
```

### packages/tufa/test/progressive-ingress.test.ts

```text
706: Record<string, unknown> :: assertEquals((queryFrames.at(-1)!.body.ked?.q as Record<string, unknown>).s, "63");
```
