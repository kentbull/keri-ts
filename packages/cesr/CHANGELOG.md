# cesr-ts

## 2.0.0

### Breaking changes

- Remove `OwnedPayload`, `PayloadSink`, `MemoryPayloadSink`, `essrRaw` and
  `essrWire`. Consume ordinary Texter raw/qualified bytes instead of ESSR
  staging/ownership adapters. Shared buffered parsing and real transport sources
  remain. See the [migration guide](../../docs/reference/compatibility/MIGRATING_TO_2_0.md).

### Maintenance

- Group primitive implementation and tests by encoding, crypto, values and
  structuring responsibilities while preserving the supported root export.
- Coordinate version 2.0.0 with keri-ts and Tufa. This entry is unpublished
  release preparation; native ACDC/registry completion and publication are deferred.

## 1.0.0

### Breaking API and parsing changes

- Buffer complete counted enclosures before finite synchronous decoding. Remove
  progressive parser cursors/staging, FrameIntake, TcpRead and the CESR Effection
  adapter. Ordinary hydrated frames no longer carry disposal obligations.
- Remove shared memory policies, accounting, byte estimates, quotas and capacity
  callbacks. Declared wire extents, supported numeric ranges, native codec rules
  and actual I/O cleanup remain enforced.

### Correctness

- Preserve canonical compactable ACDC commitments across partial attribute, edge
  and rule disclosures; keep qualified nested proofs and ordered ESSR fragments.
- Correct genus-specific HTTP attachment framing and nested v1/v2 serialization.
- Preserve codec reset and malformed-input provenance without speculative
  allocation preflight or private library-layout assumptions.

## 0.10.0

### Minor Changes

- 62218a0: Correct ACDC aggregate commitments and disclosure verification for CESR, JSON, CBOR, and MGPK. Credential issuee accessors now read the first disclosed aggregate member, so requested revocation delivery can include that recipient while compact commitments remain undisclosed.

  Aggor is now a standalone semantic primitive: kind names the serialization format, code names the digest, raw/qb64b contain the complete body, and CESR count includes its enclosure (other kinds use null). Replace Aggor.qb64g/qb2g with qb64/qb2 and serialized.length with size. Generic map/list parsing belongs to Structor or Mapper; projectStructors().aggor is replaced by projectStructors().generic containing Structors. Remove callers of parseAggor, Aggor.fromGroup, and isAggor\*Code instead of treating arbitrary generic groups as valid aggregate commitments.

- 876d24b: Expose borrowed nested-substream serialization and preserve v2 forwarding trees through exchange admission, atomic child-row replacement, escrow, durable reopen, and replay. Keep child signatures and original qualified ESSR evidence on their owning messages.
  Child serialization uses one body-and-attachment boundary, preserving admitted deep trees under the parser's default enclosure limit instead of doubling their depth.
- aefb533: Name the parsed body-plus-attachments payload CesrFrame and the frame/error
  event union ParseEvent. Rename PrimitiveTuple and isPrimitiveTuple to GroupTuple
  and isGroupTuple. Update KERI reexports and consumers without changing parsing
  behavior. Consumers must migrate the old CesrFrame event type to ParseEvent;
  the CesrFrame name now denotes the payload, so no legacy alias is provided.
- 355b9d9: Align CESR tables with frozen KERIpy 927c0cb8: use nonce seals for v2 -N/--N,
  preserve current GramHead special metadata and widths, and read valid counter
  size rows with trailing commas. Keep historical v1 receipt and path-signature
  protocol handling explicit, without reusing their meanings in v2.

  Add qualified SealNonce records and bounded structing transport. Keep nonce
  groups out of top-level attachments and native event seals, matching the actual
  reference admission boundaries. Remove obsolete big receipt runtime dispatch.

- 294b2ae: Align typed seal fields with current KERIpy Noncer roles and add FirstSeen fixed-field records. Runtime dispatch uses the canonical FirstSeen record, and datetime consumers use Dater.dts for ISO datetime text.
- 5228ae7: Replace attachment dispatch descriptors and projections with direct v1/v2 handler maps. Remove the public ATTACHMENT_DISPATCH_SPEC metadata export. Preserve version validation, legacy path-signature routes, and distinct item-count versus payload-length handlers.
- 29d4c4e: Move stream state directly into CesrParser and remove the unused public ParserState interface and KERI reexport. Buffering, offsets, reset, and frame completion retain their existing semantics.
- dc24870: Add primitive-owned raw sealed-box opening and an explicitly hosted ESSR recipient service. Accepted exchanges are checked for destination, sender, ciphertext digest, sealed-box authentication, and SCS framing before plaintext staging. Per-message and concurrency limits bound working memory; ciphertext replay evidence remains unchanged.
- 9f3b4c7: Carry reopenable ESSR payloads through exchange acceptance, escrow, and replay. Keep KERIpy-readable ciphertext evidence, publish separate authenticated plaintext references, and join cancellation cleanup through Effection operations.
- aef51c0: Require Node 20.3 or later for generated npm packages. Node 18 is no longer supported; transport cancellation uses native AbortSignal.any.
- fd277c2: Replace per-unit UnknownPrimitive placeholders with one OpaqueSpan per uninterpreted payload. Its raw bytes retain their original encoding domain; opaque spans are group entries, not qualified primitives. Update annotation and Structor serialization without decoding opaque material.
- ef2bc3f: Organize parser ownership into stream, frames, and attachments modules, with shared domain widths below the parser. Shorten internal frame-family names, retire stale module references, and document the resulting architecture and API migration.

  Remove the unused AttachmentItem and redundant QualifiedPrimitive type aliases. Primitive now describes all qualified primitive values; opaque spans remain separate.

- f515cf8: Use progressive parsing for asynchronous annotation, streaming CLI validation,
  and replay benchmarks. Bound finite annotation and benchmark input explicitly,
  preserve nested CESR/ESSR wire in annotation round trips, and own Tufa input and
  output through Effection scopes. Remove unused annotation hints and speculative
  parser-mode/partial-error benchmark flags.
- a1fd6bb: Add a pull-based async `parse` generator that emits complete GenericGroup children before the enclosing payload finishes. Move async frame adapters to this parser, preserve selected genus and exact child bounds, and close input on cancellation or failure. Async adapters now take resource limits and cancellation instead of the obsolete framed emission option.

  Expose the scope-owned Effection adapter through the optional `cesr-ts/effection` entrypoint and optional peer dependency, keeping the CESR root import framework-neutral. Remove the obsolete KERI convenience reexport; Effection callers use the explicit integration entrypoint.

- 04d25f0: Stream ESSR Texters into bounded payload sinks with reopenable wire and decoded views, preserving v1/v2 count semantics and both encoding domains. Verify exchange payload digests incrementally before acceptance.
- 5c2fa28: Separate finite body hydration from progressive enclosure traversal and normalize
  invalid base64 into parser deserialization errors. Move parser coverage to async
  input and remove tests for obsolete feed/flush/reset API behavior while retaining
  v1/v2 wire, genus selection, and enclosure-boundary assertions.
- cbbca78: Add bounded payload sinks and reopenable payload references. CESR provides explicit limited collection and a bounded memory sink; KERI provides awaited file staging, promotion, reopening, and cancellation without changing existing database schemas.
- e8cb717: Remove the parser and attachment-dispatch `onRecoveryDiagnostic` option and all exported recovery diagnostic types. Use normal parser error events for failures; automatic reset and strict/compat wrapper-tail handling are unchanged.
- a871fda: Unify encoding domains under CesrDomain, replace resolveVersionedRegistryValue with resolveTable, and name parser genus context gvrsn. Remove duplicate domain and byte-size helpers without changing decoding or version validation.
- 832742c: Add atomic shared resource reservations with distinct configuration and occupied-capacity refusals.
- 935952f: Retain shared ordinary-tree admission credit across parser delivery, nested ownership, consumer disposal and joined cleanup.
- fddf6fa: Decode native bodies once through Serder and remove the CesrBody.native token sidecar. Annotation owns its token walk and uses the shared genus selector decoder without cross-major counter retries.
- c0e9445: Remove the synchronous CESR stream engine, feed/flush/reset API, parser event
  wrappers, unused KERI CESR re-export stubs, and atomic ESSR conversion adapter. Expose async finite parseBytes
  alongside progressive parse; use the same engine for complete KERI records and
  streamed grant-file inspection. Shorten benchmark API names to benchmarkParser,
  BenchmarkOptions, and BenchmarkResult; countFrames returns the single-run count
  directly. Preserve KERI/CESR/ACDC protocol versions.
- 290bcd3: Remove cross-major attachment retries and their policy, callbacks, and diagnostics. Attachment failures now retain the selected genus version; compat mode only preserves opaque wrapper tails.
- 634cb98: Serialize admitted frames and ESSR payload references incrementally with one explicit output genus and wire domain. Preserve transferable inner counters, reject unsafe opaque genus rewrites, and normalize detached HTTP attachments to bounded qualified text.

  Drive forwarding through Effection-owned per-frame requests with upload backpressure, finite header/error limits, and joined cancellation. Body mode streams each admitted frame and consumes no whole-stream message array.

- 17bff5b: Reject malformed attachment wrapper tails consistently. Replace the dispatch entrypoints with parseAttachmentGroup, remove parser recovery options and parser-related --compat flags, and migrate runtime callers. Opaque wire families and KERIpy filesystem compatibility remain supported.
- 27023be: Fix v2 attachment parsing to honor payload quadlet/triplet counts, including nested signature groups and tuple families. Reject incomplete items within complete declared payloads without consuming following groups. Previously accepted v2 item-count encodings are invalid; v1 item counts and v1 enclosure lengths retain their existing meaning.
- 92c9b2e: Hydrate attachment tuples with their known signature, verifier, prefix, ordinal, digest, date, path, and media primitive types. Reject wrong-role codes at the CESR boundary while preserving tuple layouts and both versions count semantics.

### Patch Changes

- c05be57: Admit progressive JSON decoded bodies before allocation and retain their resource credit through parent-tree cleanup; preserve resource and decoder failure provenance.
- 01b0239: Bound non-native body primitives to their declared enclosure before decoding. Truncated matter inside a complete enclosure now raises a boundary error immediately, without waiting for or reading peer bytes.
- da097ae: Preserve verified JSON schema resource identities and bundled URI references across ACDC body formats, and reject stale explicit schema claims during verification.
- d85fa42: Retain canonical Compactor descendants through compaction and expansion, and support path-directed disclosure closures. Add bounded Pather resolution for the IPEX disclosure prerequisite while keeping wire path construction independent of the traversal limit.
- ad42241: Admit progressive CBOR declared/base token allocations before decode with shared tree credit and narrow refusal provenance; special tag expansion and codec-global retention remain open.
- e6f2b04: Reset configured CBOR decoder message globals before returning ownership, reserve fixed reset work on admitted paths, and preserve primary and reset failure identities.
- 9f3f4bf: Refuse unqualified cbor-x expansion formats before progressive runtime decoding with explicit admission diagnostics, while preserving bounded unknown tags and standalone codec behavior.
- b17c4ee: Preserve late frame-source failures through joined Effection cancellation.
- 1504255: Keep an explicit CESR genus selection independent of message protocol versions.
  A v1 KERI body under genus 2 now retains v2 attachment decoding across chunks
  and following messages. Nested selectors stay local to their enclosure.

  Reject incompatible body versions and alternate-major counter reinterpretation
  in selected contexts, while preserving unselected legacy v1 parsing. Correct
  selector fixtures to encode the full two-character minor version.

- 1f6d190: Align Bexter and Labeler with current KERIpy text escaping so leading A and
  hyphen values survive encoding and decoding. Preserve Pather's separate path
  escape convention, and avoid expanded byte arrays when decoding large Bexters.
- 4d6290c: Dispatch frame starts directly after recognizing their domain and counter, removing the intermediate syntax artifact and redundant interpretation pass. Shorten internal frame parser names without changing enclosure or version-scope behavior.
- 0f7f68f: Dispose a finished ESSR sink owner when payload qualification fails before transfer, preserving joined cleanup errors.
- 60fbf59: Separate ESSR admission refusal from verification rejection with typed recipient outcomes and explicit plaintext ownership transfer. Propagate unexpected I/O and key-store failures, classify raw sealed-box authentication narrowly, and dispose finished plaintext when handoff cleanup fails.
- 0445f70: Parse ESSR payloads as Texters using version-specific count rules, reject unsupported genus selectors without coercion, and require controller counters inside transferable signature groups. Pin generated-table verification to the KERIpy interop reference to prevent accidental codex drift.
- 137b587: Decode CESR primitives from bounded headers and exact token bytes, and encode large byte arrays without exceeding JavaScript argument limits. Preserve incomplete-header shortages and ignore trailing stream bytes.
- e4e8b35: Raise the finite shared default stream ceiling to eight so KLI mailbox and witness long polls leave room for ingress and delivery. The 256 MiB byte ceiling, one decryption ceiling, configured-policy refusal and joined cleanup remain unchanged.
- 27e4a05: Verify standalone Mapper claimed SAIDs across semantic and wire inputs while preserving Compactor disclosure construction and independent Aggor verification.
- 9847e73: Admit progressive MGPK declared decoded capacity and pinned codec working allocations before decoding, sharing JSON/MGPK tree credit through cleanup and preserving refusal provenance.
- 6455bdd: Preserve typed seal SADs in native KERI event construction and parsing, including homogeneous seal runs and current KERIpy numeric encoding. Share automatic numeric code selection through NumberPrimitive.fromNum across seal, Serder, and threshold projections. Restrict native seal lists to event fields and reject unsupported entries before they can be lost.
- 298387c: Annotate parent-owned nested CESR messages within their root entry while preserving original wrappers, scoped genus selectors, signatures, and ESSR ownership.
- 886031f: Serialize parent-owned nested message trees through reopenable payload views, preserving each child's signatures, scoped genus, and streamed ESSR ownership. Keep annotation and KERI runtime boundaries explicitly unsupported pending their own consumer changes.
- 96b197e: Initialize pinned sodium npm bindings with Node 18's native secure randomness when the global is absent.
  Declare Node 18.17 as the KERI/Tufa minimum required by their abort-signal composition.
- c8332a2: Parse enclosed nested messages as bounded parent-owned trees, preserving each child's body, signatures, genus, and payload resources. Dispose complete trees at ownership boundaries and reject nested runtime processing, serialization, and annotation explicitly until those consumers support their evidence.
- 2f10def: Yield host scheduling turns during long parser annotation and empty-producer work, while preserving shared cursor extents and joined cancellation cleanup.
- 1efdc9b: Separate v1 item-count and v2 bounded-payload parsing handlers for tuples and signature groups. Select handlers during dispatch construction and remove the tuple-parser cache. Parsing behavior and public APIs are unchanged.
- c78ecee: Expose opt-in progressive wire refusals while preserving source, storage, policy and cleanup error provenance.
- e38056e: Qualify invocation-local transport admission refusals and preserve foreign same-class failures through joined target attempts.
- d485e44: Make CESR frame completion independent of network chunk boundaries. Open
  attachment sets now wait for a following body, a complete enclosure, or explicit
  flush. Terminal partial attachments report shortage without emitting an
  incomplete frame; flush drains all complete frames in either emission mode.

  Remove the frameBoundaryPolicy option, policy exports, and deferred-frame
  wrapper. Update complete-record runtime consumers to finish parsing explicitly
  and keep multisig attachment sets open while appending peer signatures.

- f631dab: Add local v2 blinded registry updates with validated credential membership and a reopen-safe staged frontier.

  Repair raw/default salt initialization used by blind disclosure derivation.

- 3a18954: Retain ignored SAID fields and their versioned size while excluding them from the digest, matching KERIpy.
- ea4d159: Canonicalize SerderKERI.snh through its Number primitive for reference-compatible source-seal comparisons.
- 522100f: Match KERIpy's legacy registry nonce fallback in SerderKERI.uuid and its nonce alias.
- 0880b4a: Use one attachment loop for streaming and bounded frames, and replace the stateless frame parser and attachment collector objects with functions. Preserve explicit exhaustion, enclosure, and genus boundaries.

  Complete v1 attachment enclosures now reject truncated inner items immediately, matching the bounded-input rule already applied to v2.

- bc5fc4c: Reserve shared canonical-wire credit before opening ESSR sinks and retain it with the parent tree through joined cleanup.
- 151ee7d: Reserve shared byte credit before copying queued ingress and retain its lease through processing, retry and joined cleanup.
- 6b7851b: Simplify internal frame parser arguments by deriving byte boundaries from the counter and encoding domain inside each helper. Parsing behavior is unchanged.
- e509343: Bound weighted threshold work and JSON input with KERIpy's tunable deployment limits.

## 0.9.2

### Patch Changes

- e99beb0: Use pinned libsodium Argon2id for faster byte-compatible Salter derivation, wiping owned WASM buffers before release. Preserve KERIpy tier parameters and enforce its 16-byte minimum output; whole-process erasure is not claimed.

## 0.9.1

### Patch Changes

- 1f14f5c: Fixed the build process to use explicit public package boundaries and upgraded libsodium-wrappers to 0.8.4

## 0.9.0

### Minor Changes

- Align attachment counter serialization with KERIpy genus-version handling,
  including `Counter.makeGVC` and `Counter.enclose`.

## 0.8.0

### Minor Changes

- 6286759: Release the ACDC/TEL/IPEX implementation as v0.8.0 across Tufa, CESR, and
  KERI packages, including the end-to-end issuer, holder, verifier, KERIpy
  interop, credential-chain, revocation, and saidification workflows.

### Patch Changes

- 053c1fa: Add KERIpy-parity ACDC v2 messaging builders for registry, map, attribute,
  aggregate, and section messages, and align CESR-native mapper/string and direct
  native-serder hydration behavior with KERIpy vectors.

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
