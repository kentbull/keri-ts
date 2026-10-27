# KERI v1/v2 compatibility inventory

This is the maintained inventory of compatibility behavior in keri-ts and cesr-ts.
The [KERIpy porting backlog](../../plans/compatibility/KERIPY_COMPATIBILITY_PORTS.md)
uses the same stable IDs to track future work on WebOfTrust/keripy 1.x and 2.x.
Update an entry when its implementation, supported peer, or qualification changes.
Component contracts still own behavior; this inventory owns the cross-version map.

Initial source review: **2026-10-19**, keri-ts
`eb1a430eed5dd6c08c95abf1b686c6694c8f94c5`. Evidence links identify existing source
and tests, not tests rerun for this documentation change. This is an initial
inventory of inspected boundaries, not an exhaustive audit of all historical wire
forms or a claim that every combination of two implementations interoperates.

## Version vocabulary and reference limits

Use **ACDC v2** for the credential protocol and its application workflows, with
`--acdc-v2` as the explicit CLI selector. Reserve **native CESR** for the CESR
body encoding; JSON ACDC v2 is a separate supported encoding choice. The word
"native" does not distinguish v2 credentials from v1 credentials.

| Dimension                | Meaning                                               | Compatibility consequence                                                                                  |
| ------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Package release / branch | KERIpy 1.x, 2.x, a fork, or a keri-ts release         | A release may implement more than one protocol lane.                                                       |
| Body protocol `pvrsn`    | Version of a signed KERI/ACDC message                 | Changing fields or the version string changes the signed evidence; transport fallback cannot translate it. |
| CESR genus `gvrsn`       | Counter tables, count semantics and enclosure context | A v1 body can travel with a separately selected attachment genus; the receiver must understand both.       |
| HTTP convention          | Media type, detached attachments, or full CESR body   | Accepting a media type does not imply acceptance of the body protocol or genus.                            |
| Application schema       | Credential/schema semantics                           | A schema named "2.0" is not necessarily an ACDC protocol-v2 credential.                                    |
| Stored representation    | Database layout, keys, values and indexes             | Wire acceptance does not establish database upgrade or rollback compatibility.                             |

The source comparisons below use immutable references:

| Label | Source                                                                                                                      | Role                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| W1    | WebOfTrust KERIpy v1.2.14, [`bab95c16`](https://github.com/WebOfTrust/keripy/tree/bab95c16e949b61398129a3e41a8f68bad84c94f) | Historical 1.x comparison baseline.                                                             |
| G1    | GLEIF-IT KERIpy v1.2.17, [`b8626e1d`](https://github.com/GLEIF-IT/keripy/tree/b8626e1d58770a4a480ea72a01acc5580278a9f2)     | Actual older HTTP convention and messenger/lifecycle reference; a fork, not all WebOfTrust 1.x. |
| W2    | WebOfTrust KERIpy main, [`71438328`](https://github.com/WebOfTrust/keripy/tree/7143832813cac6a394ab1faf9be83bb3372be87c)    | Frozen protocol/runtime correspondence; not the current head of all 2.x work.                   |

[Reference environments](../../plans/qualification/REFERENCE_ENVIRONMENTS.md)
owns the separate table-vector pins, functional mailbox fork, historical Sally
peer and embedded DID resolver. Do not substitute one for another. The
[release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md) and
[disclosure acceptance matrix](../../plans/qualification/GRADUATED_DISCLOSURE_INTEROP.md)
own executed workflow qualification and its limitations. No fresh live-peer runs
are claimed here.

## Compatibility matrix

"Implemented" means the linked code and regressions exist. "Conditional" means
the receiver and workflow must explicitly support the selected form. "Not
provided" is an intentional boundary or an unresolved need, not a silent fallback.

| Traffic / transition                                          | keri-ts behavior                                                                             | Peer boundary                                                                                                                        | Catalogue        |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Old or new CESR HTTP media type into keri-ts                  | Implemented: recognize both `application/cesr+json` and `application/cesr`.                  | Endpoint still validates framing, messages and proofs.                                                                               | COMP-01          |
| Detached-header send from keri-ts to G1                       | Implemented: try `application/cesr`, then the legacy type after the specific 406 rejection.  | Same message; only the media type changes. W2 accepts the first type.                                                                | COMP-01          |
| Full CESR body sent to an older HTTP endpoint                 | Conditional: keri-ts supports explicit body mode.                                            | No general full-body capability discovery or header-mode fallback; G1/W2 detached request parsers are not qualified by this feature. | COMP-02          |
| v1 or v2 CESR input into cesr-ts                              | Implemented for supported bodies/counters, explicit selectors and scoped mixed genera.       | Parse success does not establish an application handler or peer support for every form.                                              | COMP-03, COMP-04 |
| Known attachments re-encoded in another genus                 | Conditional: semantic conversion; original non-CESR signed body remains unchanged.         | Opaque content, missing target counters and unsupported inner widths reject.                                                         | COMP-05, COMP-06 |
| Native CESR body or v2 protocol feature sent to a v1-only processor | Not provided as a general downgrade.                                                         | HTTP relabeling cannot make the message or feature a v1 artifact.                                                                    | GAP-01           |
| Forwarded legacy versus v2 message                            | Implemented: legacy pathed embed versus signed v2 digest plus nested child.                  | Source body/genus selects the shape; no recipient capability negotiation.                                                            | COMP-07          |
| Multisig child whose body and attachment versions differ      | Implemented: explicit child genus, including a signed hint for legacy wrappers when needed.  | Peer must implement the same hint/selection rules; not universal 1.x support.                                                        | COMP-08          |
| Existing v1 credentials alongside new ACDC registry workflows | Implemented as separate VDR and ACDC lanes.                                                  | No in-place credential, registry or database conversion.                                                                             | COMP-09, GAP-03  |
| Legacy versus v2 IPEX                                         | Implemented with version-specific construction/verification.                                 | Conversation graphs, disclosures and proof requirements differ; no automatic downgrade.                                              | COMP-10          |
| KRAM adoption alongside existing intake                       | Explicit opt-in and scoped v2 intake.                                                        | Sender policy, receiver time and application proof verification remain independent.                                                  | COMP-11          |
| Legacy TEL replay requested by an older peer                  | Implemented: parsed request genus selects v1 replay or explicit v2 framing.                  | Signed bodies remain unchanged; evidence requiring a newer version is explicitly refused.                                            | GAP-02           |
| TSN endorsement ordinals stored from different encodings      | Broker indexes the numeric ordinal in zero-padded hexadecimal, as both Python references do. | This is a database key convention, not a body/genus conversion or a general database migration.                                      | COMP-12, GAP-03  |

## Implemented features and preservation rules

### COMP-01 — Dual HTTP media types and narrow sender fallback

OOBI stream responses use `application/json+cesr`, the label accepted by both
pinned legacy Oobiery implementations and main. This is separate from ordinary
POST's `application/cesr` / `application/cesr+json` header-media choices; it does
not change signed event bytes or select a protocol/body version.

**Bridge.** [CESR HTTP helpers](../../../packages/keri/src/app/transport/cesr-http.ts)
recognize both media types, including parameters. In
[CESR egress](../../../packages/keri/src/app/transport/cesr-egress.ts), `isLegacyCesrMediaRejection`
allows one alternative only when `CESR-ATTACHMENT` is present, status is 406,
the attempted type is `application/cesr`, and the JSON refusal has the pinned Falcon
`Content type error` title and `Unacceptable content type.` description. Mailbox
polling shares that predicate and reuses the signed query after joined response
cleanup; unrelated refusals cannot cause an alternate submission.
[Witness receipt POST](../../../packages/keri/src/app/witness/receipt-client.ts) has the same
type fallback at its owner.

G1's [HTTP parser](https://github.com/GLEIF-IT/keripy/blob/b8626e1d58770a4a480ea72a01acc5580278a9f2/src/keri/app/httping.py)
expects `application/cesr+json`; W2's
[HTTP parser](https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/app/httping.py)
expects `application/cesr`. Both reject a mismatched type before processing its
message. W1's [HTTP parser](https://github.com/WebOfTrust/keripy/blob/bab95c16e949b61398129a3e41a8f68bad84c94f/src/keri/app/httping.py)
also uses the legacy `application/cesr+json` convention. Preserve the signed body,
attachment bytes, recipient and Authorization
across the alternative attempt; fully close the refused attempt first.

This is our cross-release accommodation, not generic retries or protocol-version
negotiation. The English-text predicate is a peer-specific heuristic. Body mode
has no second media choice. Do not assume every HTTP caller uses the fallback:
direct mailbox polling through `requestWithHeaderTimeout` is a separate path.
The [HTTP ownership contract](../../design-docs/runtime/INGRESS_AND_EGRESS.md#http-ownership)
explains finite versus scoped responses and ordinary-send versus query intake.
Evidence: [media recognition/framing](../../../packages/keri/test/unit/app/transport/cesr-http.test.ts),
[header fallback and body refusal](../../../packages/keri/test/unit/app/transport/cesr-egress.test.ts),
[per-frame fallback with authorization](../../../packages/keri/test/unit/app/witness/witness-transport.test.ts).

### COMP-02 — Detached and full-body HTTP framing

**Coexistence.** [CESR HTTP helpers](../../../packages/keri/src/app/transport/cesr-http.ts)
default to one body plus detached `CESR-ATTACHMENT`, reconstruct inbound wire in
order, and expose explicit full-body/stream requests. Header-mode sending prepares
one complete frame per HTTP request. Full-body mode is a supported TS integration,
not a universally portable replacement for the Python detached convention.
Evidence: [CESR HTTP framing tests](../../../packages/keri/test/unit/app/transport/cesr-http.test.ts).

### COMP-03 — Independent body and attachment versions

**Coexistence and guard.** [Complete decoding](../../../packages/cesr/src/parser/complete.ts)
and [attachment dispatch](../../../packages/cesr/src/parser/attachments.ts)
retain explicit stream/enclosure genus context. Only unselected legacy input may
infer its genus. Do not retry malformed data under another major version or leak
a child's selector into siblings. Evidence:
[version context](../../../packages/cesr/test/unit/parser/version-context.test.ts)
and [wrapper context/refusals](../../../packages/cesr/test/unit/parser/wrapper-version.test.ts).

### COMP-04 — Historical v1 receipt and path-signature readers

**Backward reader support.** The explicit v1 `-D` receipt quadruples and `-J/-K`
path-signature extensions remain in
[attachment parsing](../../../packages/cesr/src/parser/attachments.ts), outside
canonical current table membership. They retain v1 semantics. Current v2 nonce
codes cannot be reinterpreted as obsolete receipt codes. Details:
[frozen wire boundaries](../cesr/CESR_CURRENT_REFERENCE_TABLES.md).
Evidence: [historical receipt and rejection tests](../../../packages/cesr/test/unit/tables/current-reference.test.ts)
and [attachment dispatch](../../../packages/cesr/test/unit/parser/attachment-dispatch.test.ts).

### COMP-05 — Semantic attachment conversion with explicit refusals

**Limited bridge.** [Serialization](../../../packages/cesr/src/parser/serialize.ts)
rebuilds supported known groups using v1 item counts or v2 payload units, including
inner signature counters. Same-genus attachment-group wire is retained apart from requested text/
binary qualification. Opaque genus conversion, nonexistent target counters and
unsupported large inner signature counters fail. Historical receipt quadruples
are not convertible to the current v2 codex. Evidence:
[serialization](../../../packages/cesr/test/unit/parser/serialize.test.ts),
[nested serialization](../../../packages/cesr/test/unit/parser/serialize-nests.test.ts)
and [historical receipts](../../../packages/cesr/test/unit/tables/current-reference.test.ts).

### COMP-06 — Source-preserving signing and replay version selection

**Coexistence and guard.** [Attachment countering](../../../packages/keri/src/core/attachment-countering.ts)
and [protocol serialization](../../../packages/keri/src/core/protocol-serialization.ts)
select the requested genus subject to body/genus requirements; nesting requires
v2. [Stored replay](../../../packages/keri/src/db/basing.ts) retains signed bodies.
Selecting counter output is not reissuing or rewriting a signed event. Native CESR
body conversion has its own restrictions and must not be presented as a generic
byte-preserving protocol downgrade. Evidence:
[protocol serialization](../../../packages/keri/test/unit/core/protocol-serialization.test.ts)
and [replay sources](../../../packages/keri/test/unit/app/delivery/replay-source.test.ts).

### COMP-07 — Version-aware forwarding envelopes

**Coexistence.** [Poster forwarding construction](../../../packages/keri/src/app/delivery/forwarding.ts)
uses legacy pathed embeds for legacy children and a v2 `/fwd` binding one nested
child to signed `a.evt` when the child body or genus requires v2. Preserve the
child's own signatures; the forwarding signature is not child authentication.
This resembles W2's separate Poster/StreamPoster paths; it does not discover an
old mailbox's capabilities. Evidence:
[legacy/v2 forwarding shapes](../../../packages/keri/test/unit/app/delivery/forwarding.test.ts)
and [nested exchange acceptance](../../../packages/keri/src/app/exchanges/exchanging.ts).

### COMP-08 — Multisig child genus survives approval and replay

**Bridge.** [Grouping](../../../packages/keri/src/app/multisig/grouping.ts) preserves
`childGvrsn` separately from the wrapper. A v1 wrapper carries signed `a.cgvrsn`
only when its legacy child body does not declare the differing genus. An explicit
child genus wins over the hint; a hint applies to carried child attachments.
Approval, reopen/retry and KEL/reply/TEL/credential intake must agree on that
context. Do not retrofit a hint into an already signed proposal. Evidence:
[grouping and malformed hints](../../../packages/keri/test/unit/app/multisig/grouping.test.ts),
[mixed-genus approval and replay](../../../packages/keri/test/unit/app/multisig/grouping-nests.test.ts)
and [independent 714 vectors](../../../packages/keri/test/fixtures/multisig-framing-714.json).

### COMP-09 — Preserve the legacy credential lane

**Coexistence, not conversion.** Legacy `vdr`/Reger/Verifier remain separate from
`acdc`/RegistryStore/RegistryObserver. Preserve the appropriate SAID, anchoring,
issuer and presentation proofs; new registry acceptance is not an upgrade of an
old credential. Owners and source links:
[credential contract](../../design-docs/credentials/ACDC_TEL_VERIFIER.md).
Evidence/limits: [registry qualification](../../plans/credentials/REGISTRY_PLAN.md),
[legacy credential interop](../../../packages/keri/test/integration/app/interop-acdc-kli-tufa.test.ts)
and [disclosure interop](../../plans/qualification/GRADUATED_DISCLOSURE_INTEROP.md).

### COMP-10 — Version-specific IPEX and nested-route gates

**Coexistence and guard.** [Exchange construction](../../../packages/keri/src/core/exchange/protocol-exchanging.ts),
[legacy IPEX](../../../packages/keri/src/app/ipex/ipexing.ts) and
[v2 IPEX](../../../packages/keri/src/app/ipex/ipex-v2.ts) retain different shapes and
predecessor rules. In particular, v2 grant can follow apply or agree; v1's
prior-route rule remains distinct. Nested exchange support is route-specific;
decoding a v2 child does not enable every application route. Evidence:
[v1 IPEX](../../../packages/keri/test/unit/app/ipex/ipexing.test.ts),
[v2 IPEX](../../../packages/keri/test/unit/app/ipex/ipex-v2.test.ts)
and [disclosure interop limitations](../../plans/qualification/GRADUATED_DISCLOSURE_INTEROP.md).

### COMP-11 — Explicit KRAM adoption without a downgrade escape

**Adoption boundary.** [KRAM policy](../../../packages/keri/src/core/mailbox/kram-policy.ts)
defaults to disabled and supports version/type/route exemptions. The
[v2 admission contract](../../design-docs/exchange/MESSAGE_ADMISSION.md) keeps
KRAM separate from sender filtering and independent protocol proof checks.
Disabled/exempt intake is not authenticated merely because it bypasses KRAM;
failed KRAM must not trigger an automatic legacy retry. Evidence:
[policy](../../../packages/keri/test/unit/core/mailbox/kram-policy.test.ts),
[authentication](../../../packages/keri/test/unit/core/mailbox/kram-auth.test.ts)
and [mailbox interop](../../../packages/keri/test/integration/app/interop-kram-mailbox.test.ts).

### COMP-12 — Stable TSN proof identity across ordinal encodings

**Shared storage convention.** Both G1's
[Broker](https://github.com/GLEIF-IT/keripy/blob/b8626e1d58770a4a480ea72a01acc5580278a9f2/src/keri/db/escrowing.py#L168-L170)
and W2's
[Broker](https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/db/escrowing.py#L202-L204)
format the establishment ordinal in the transferable-signature key as
`f"{seqner.sn:032x}"`. The key identifies the reply, signer, numeric establishment
ordinal and establishment digest. There is no v1-to-v2 key-format break between
these references.

[TypeScript Broker](../../../packages/keri/src/db/escrowing.ts) uses the same
numeric key. `Seqner.snh` is padded, while `NumberPrimitive.numh` is unpadded;
using those projections interchangeably would create different rows when a
retry reconstructs the ordinal. Canonical indexing keeps the same proof under
the same key and combines partial signatures received with equivalent ordinal
encodings. An identical retry must not duplicate the stored proof.

Do not choose this key from the reply's body version, the JavaScript primitive
class, or the `0A` code. Body and attachment versions are independent (COMP-03);
the [attachment parser](../../../packages/cesr/src/parser/attachments.ts) uses
`NumberPrimitive` for transferable signature groups in both genera, including
explicit `0A` ordinals. The index does not rewrite signed bodies or signatures,
and it is not an archive of the original attachment encoding. Evidence:
[Broker storage/retry tests](../../../packages/keri/test/unit/db/escrowing.test.ts)
and [TSN recovery tests](../../../packages/keri/test/unit/vdr/eventing.test.ts).
General database transition qualification remains GAP-03.

## ESSR storage target and table bindings

| Frozen Python reference | Actual `Baser.essrs` binding |
| ----------------------- | ---------------------------- |
| main `c7e74ad`          | `essrs.`                     |
| 1.2.14 `bab95c16`       | `.essrs`                     |
| 1.3.6 `4ce4cc79`        | `.essrs`                     |

Current ESSR storage targets actual pinned-main Baser, with ordinary qualified
Texter set equality and insertion order. Repeated fragments deduplicate; valid
alternate fragmentations can append members. Incoming commitments can therefore
verify while stored reconstruction fails. See the [storage contract](../../design-docs/db/PAYLOAD_STORAGE.md)
and [reproducer/scope correction](../../reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md).
Actual main Baser reads/writes and reopen are qualified separately from the
required main/1.2/1.3 ESSR wire exchanges. Manually binding `essrs.` in each Python
version does not test its native Baser binding or full Habery/Keeper interchange.
Direct legacy LMDB support has a [deferred canonical roadmap owner](../../plans/db/DB_PARITY_PLAN.md#deferred-legacy-lmdb-compatibility)
outside the 2.0 gate; legacy wire support remains required.

Disclosure recovery has two bounded API differences from selected Python
`c60da4bf`; [the CESR owner regressions](../../../packages/cesr/test/unit/primitives/structuring/disclosure.test.ts)
cover the TypeScript behavior:

- `unblindBlindState` and `unblindBoundState` accept deterministic `raw` salt
  without a separate `salt` argument. Python `Blinder.unblind` rejects that
  raw-only call in its preliminary salt guard.
- TypeScript infers the target BLID's supported digest code and honors a matching
  explicit code. Python's recovery search constructs default Blake3 candidates;
  alternate-code recovery API equivalence is not claimed. Generic commitment and
  TypeMedia digest capabilities are unchanged.

Both differences use the existing deterministic UUID derivation and supported
digest algorithms to produce the same CESR tuple forms. Independent hash checks
and the [Python-produced SHA-256 opening case](../../../packages/keri/test/integration/app/interop-native-registry.test.ts)
exercise that wire contract.

ACDC v2 reporting has an explicit application-policy difference. The TypeScript
[verifier](../../../packages/verifier/src/acdc-v2.ts) requires an issued origin
and the shared graph evaluator's true verdict over current authenticated node
states. A known revoked far node can therefore satisfy NOR/NAND. Selected
[Dolly `b0a172a6`](https://github.com/kentbull/dolly/blob/b0a172a6bab4c3a3c61985bee893b3395e78c351/src/dolly/serving.py)
additionally requires every disclosed node to remain issued. Both retain the
same authenticated wire evidence; reporting decisions can differ. The existing
[verifier workflow](../../../packages/tufa/test/integration/verifier-workflow.test.ts)
checks an issued root with a revoked far node under NOR and AND, plus independent
historical inspection and opaque/current revocation transitions. Missing or
invalid evidence remains unresolved or refused under either policy.

## Known compatibility needs and explicit limits

| ID     | Need / limit                                         | Current disposition                                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-01 | Capability selection and v2-to-v1 feature fallback   | No general peer negotiation or downgrade engine. Keep caller-selected versions explicit. A v2-only message, nested proof or disclosure cannot be relabeled into v1.                                                                                                                                                                                  |
| GAP-02 | Legacy replay, forwarding and mailbox reachability   | Audit actual send paths and peer genera. TEL replay now selects actual request framing and refuses unsupported downward conversion; header-only mailbox polling does not inherit COMP-01 automatically. See the [admission contract](../../design-docs/exchange/MESSAGE_ADMISSION.md).                                                               |
| GAP-03 | Database upgrade, rollback and pending-work recovery | ESSR targets main `essrs.`; legacy Baser binds `.essrs`. Direct legacy LMDB interchange/migration is deferred outside 2.0 to the [DB roadmap](../../plans/db/DB_PARITY_PLAN.md#deferred-legacy-lmdb-compatibility). No discovery, dual writes or migration supplied. Legacy wire remains required; older keri-ts private formats remain unsupported. |
| GAP-04 | Broad historical archive acceptance                  | COMP-04 covers named extensions, not every old large-counter encoding or removed Matter code. Audit actual archives; never reinterpret removed codes under a new meaning.                                                                                                                                                                            |
| GAP-05 | New feature rollout to old peers                     | Native CESR bodies, ACDC v2 registry/disclosure workflows and KRAM need explicit adoption profiles. TS DI2I/NOT and RegistryObserver integration have separate Python reference gaps; they are not already qualified forward-compatibility bridges.                                                                                                         |
| GAP-06 | Python application/API and operational parity        | Source, HTTP, CLI and Python API differences need independent checks. GLEIF completion/connection fixes are relevant donor evidence, not proof that WebOfTrust 2.x includes every 1.x fix. Preserve [transport boundaries](../../design-docs/runtime/INGRESS_AND_EGRESS.md).                                                                         |

## Maintenance rule

For each added or changed compatibility behavior, update its stable entry, source
owner, peer/version direction, negative boundary and regression links. Record
executed evidence at its exact revisions in a report; do not turn an implementation
link into a fresh qualification claim. Keep proposed ports in the
[backlog](../../plans/compatibility/KERIPY_COMPATIBILITY_PORTS.md), not in this
implemented catalogue. A removed bridge needs an explicit supported-peer decision.
