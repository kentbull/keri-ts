# Runtime parity pre-release qualification checkpoint — 2026-10-14

The complete maintained inventory ran once on clean candidate
`576064bf4830750159fd9aa15c0ae725f73d357c`, whose entire tree matches implementation
merge `1aa470fd48119ae35c908e24f2703aa0a15d2548` (#328/#330–332).
It finished with mixed outcomes; subsequent focused repairs do not relabel it green.
Checkpoint source is `8497ebb6` after Node floor, export, native-read, stream-headroom,
fairness, response-cleanup and writer repairs (#333–339). Targeted #336–339 repairs close the twelve original failed cases and the additional
KLI timeout. Docs/static closure, final installed packs and publication remain open.

## Authorities

Normative KERIpy is upstream 7143832813cac6a394ab1faf9be83bb3372be87c.
Mailbox CLI compatibility is kentbull/keripy b08ddeb, fork-on-upstream 927; Sally 98
and resolver 839/installed KERIpy 1.2.14 remain separately labeled environments.
[Import/source inventory][pins] records actual probes and retained-target rationale;
startup probes do not qualify full CLI/resolver workflows. Ordinary Node/npm LMDB
0.9.90 is separate from qualified Deno V1/NAPI 0.9.29; no cross-open claim is made.

## Classification

| Class                  | Boundary                                    | Evidence            |
| ---------------------- | ------------------------------------------- | ------------------- |
| Supported              | Implemented/focused-qualified paths         | A–D below           |
| Unfinished             | Guarded consumers/deeper nests              | [IPEX][ipex]        |
| Intentional difference | TS integrations/corrections                 | E below             |
| Reference stub         | xip/pro/bar have no processing              | [714 source][stubs] |
| Unqualified            | Native/default-builder/final release claims | F below             |

**A — wire and protocol.** One progressive CESR engine preserves v1/v2, qb64/qb2,
local genus, exact enclosures/truncation and earlier independent siblings.
[Multisig #160–161][multisig] binds child proofs independently; parent acceptance
never authenticates descendants. V2 permits exactly icp/rot/ixn/rpy; 714 explicitly
rejects other nested multisig routes. V1 registers all eight coordination routes;
KEL/RPY/VCP/ISS and group IPEX approval run through separate owners. Real V1 REV
peer approval/fanout is unfinished and deferred legacy scope, not a reference stub
or a new release gate; individual revocation stays supported. Automatic TS mux
replay is V2-only; actual V1 CLI controllers parse child/peer attachments explicitly.
Full standalone 714 V1 Multiplexor replay API equality is not claimed. [IPEX][ipex], [registry R1–R12/S1–S3][registry],
[EXN/TEL/TSN][exchange] and optional-disabled [KRAM K1–K10][kram] are implemented.
Conversation, issuer proof, saved credential and global freshness are distinct.
[Mapper #223/#226][mapper] verifies present configured top-level claims in saidive
semantic/wire inputs; makify replaces claims and verify:false opts out. Compactor
retains wire checks while constructing disclosures, not authenticating credentials.
Aggor independently checks disclosed map claims plus the format-specific compact
list AGID. Supplied bound JSON resources and generated default schemas stay distinct.

**B — runtime.** One Baser ResourcePolicy admits cooperating transient owners:
256 MiB byte budget and eight streams/one decryption after [#336][headroom].
The scale observations used two streams/one decryption. Headroom for simultaneous
mailbox/SSE polls and independent work is policy, not a protocol maximum; it does
not supply an eight-concurrency volume result. Producer/consumer ports retain cue/tree/output credit through joined cleanup.
Historical [#328][activation] installed cue ownership accounting. The October 15
cleanup removes that layer: default runtime and mailbox queues now carry ordinary
Deck records; joined output cleanup still precedes store closure.
Network waits run outside short guarded preparation; busy preserves the admitted head.
[#326][sidecars] scopes temporary Noter/Mailboxer cleanup, including failed acquisition.

**C — transport.** Two shared HTTP/TCP engines preserve framed POST, signed
introductions and HTTP-first/TCP fallback. [Receiptor #308][receipts] requires
persisted verified receipts; [query/Anchorer #311][callers] and [Poster #319][poster]
borrow existing runtime services. [Listener #309–310][listener] returns correlated
immediate/deferred replay through one parser/borrowed writer, preserves independent
RX/TX, absolute drain deadlines and joined cancellation. The existing escrow driver
wakes pending queries. Same-socket TX works with two RX slots occupied; independent outgoing work still
requires available configured capacity. [#337][fairness] retains a command-local
mailbox scan position; [#338][response-close] preserves normal successful HTTP
teardown while propagating foreign cleanup failures.
[HTTP #323][http] and [witness #327][witness] transfer real request/callback owners;
finite wrapper snapshots remain caller-owned. [Mailbox #322][mailbox] keeps SSE
HTTP-only and preserves role precedence. Local drain/HTTP success is not acceptance.

**D — storage.** Nested/KRAM/mailbox/KEL/outbox adopted reads preflight native
rows and retain scoped copy leases. [TEL #331][tel] closes the actual native body-before-limit and eager proof-bucket gap. Stored reply/KEL proof iteration is
incrementally capped; canonical anchor tuples and native duplicate records are
finite. [Storage owner][storage] preserves existing publication/rollback/reopen
and task-owned recovery, without a general delivery journal. [#339][first-seen]
commits incoming KEL/FEL/prepared writes before live state and cue publication.
Private escrow [#341][escrow-writer] is focused-qualified, with exact-head CI pending.
Explicit decide/apply or active-writer callers own commit/publication; this is not cache coherence.
Outbox stays optional.

V2 processMsg preserves sender policy→optional KRAM→authentication prerequisites
and route dispatch. Signature presence is not threshold proof; downstream processors
own it. logs/ksn/mbx and legacy tels/tsn are real processors. KRAM intake authority,
cache/receipt persistence and ready handoff do not implement xip/pro/bar acceptance.

**E — differences.** [Public observer intake][gaps] extends 714's missing nonempty
ACDC-ilk receiver path. TS corrects foreign group leadership, TSN positional vcState,
attester suffixes, outer-SAID BADA pointers, accepted-backer trust and forged/stale
credential anchors. TS retains framed POST instead of upstream bulk PUT, and bounded
lazy TEL replay. Physical storage ordinals remain safe-integer limited. NOT/DI2I and
unfinished nests stay guarded; automatic bare-schema-SAID host discovery/global TEL
freshness are not implemented upstream obligations. [CBOR envelope][cbor] records
unknown-tag shape differences and JS-only expansion refusals; further extensions,
cache eviction/APIs and blanket streaming/export conversion are deferred.
The accessor audit records absent convenience names, nullable/list and live-map
facade differences, and JS numeric projections that can lose wide ordinal precision;
callers needing exact values use NumberPrimitive bigint wrappers. It does not claim
Python object mutability, malformed-input permissiveness or complete API equality.

**F — limits.** Default native EXN construction is rejected by the reference's own
decoder; generated nonJSON schemas are outside 714's JSON-resource profile. Supplied
bound JSON resource evidence does not qualify those builders. Accepted read-through
caches grow. Legacy Verifier accepted-credential hydration, caller-owned IPEX/export
collections, other storage/outbox scans, native scratch/crypto/fetch/kernel buffers,
LMDB mapped residency and arbitrary external retention remain separate costs.
This report does not claim total-RSS, all-storage preallocation, general durability,
exactly-once delivery or universal-size parity.

## Candidate production observations

Both ran once on clean a172e370, worker 993aff405c4828362460f1a2d9458a4f44664617c6885a1f32d22a4d24ec2d9b.
Same two identities, **two-stream/one-decryption, 256 MiB** measured policy;
1 MiB logical user items, 64 KiB chunks, flat v2/qb64 independent enclosed messages
(depth 0), not GenericGroup. Separate small HTTP/TCP cases establish independent
GenericGroup usability. Later stream headroom changes do not retroactively
turn these into current-eight-concurrency measurements or a universal RSS bound. Raw logs:
`runtime-final-qualification/A1-16MiB.log`, `A2-256MiB.log` and `observations.json`
under the outside-ENC qualification artifact directory.

| Observation               |          16 MiB |         256 MiB |
| ------------------------- | --------------: | --------------: |
| Parsed/verified/replayed  |        16/16/16 |     256/256/256 |
| Logical byte high-water   |      96,449,404 |      96,449,404 |
| First parsed/usable ms    | 166.626/967.209 | 167.002/969.201 |
| Producer EOF ms           |      10,971.475 |     226,491.599 |
| Observed peak RSS bytes   |     712,306,688 |     778,813,440 |
| Terminal mapped RSS bytes |      14,098,432 |     244,269,056 |

Joined trial cleanup left zero owned store/corpus files, logical credit and tracked
owners in both observations. These prove this generic HTTP→explicit recipient→
store→reopen/replay envelope with fixed identity cardinality; mapped storage
residency grows separately. They are not a statistical plateau, throughput guarantee
or packed HTTP messenger qualification. The later production delta from a172 to 1aa
is exactly two files: Serder UUID/snh
projections (#330/#332) and Reger TEL reconstruction (#331). The EXN profile never
calls TEL replay or the legacy vcp UUID fallback; its generated inception sequence
is canonical s="0", unchanged by snh normalization. These scoped applicability
facts retain the two observations without claiming every source file is identical.
Native Node read qualification and HTTP response cleanup follow separate call paths;
the observed Deno NAPI reader remains unchanged. New package engine/export metadata
and current stream headroom require their own installed/caller evidence.

## Maintained inventory and affected reruns

The frozen inventory executed 133 KERI files through 23 suites, including both
manual targets, in 4,424.0 seconds. Five KERI commands failed with twelve cases;
Tufa and CESR completed successfully in 37.0/10.2 seconds. This is execution
coverage with recorded failures, not full qualification or an all-green run.

| Frozen failure                            | Cases | Qualified repair |
| ----------------------------------------- | ----: | ---------------- |
| Public GroupHab delegation                |     3 | #336             |
| Ordinary delegation                       |     4 | #336/#337        |
| Tufa controller to KERIpy/mixed witnesses |     2 | #338             |
| Mailbox workflows                         |     2 | #339             |
| Six-witness soak                          |     1 | #338             |

Capacity `e4e8b35d` passed two retained public workflows and three ordinary cases.
Fairness `16924187` passed the remaining rotation; its tree is identical to published
`8c3a5ba6`. Cleanup `e326a6f8` passed both affected controller cases and the soak.
Writer `982cbcab` passed both mailbox cases on matching source/test snapshots.
Raw evidence is outside ENC in `stream-admission-diagnosis`,
`first-seen-writer-audit` and `final-inventory-execution/http-cleanup-e326a6f8-results`;
the original mixed inventory remains in `final-inventory-execution/576064bf-results`.

The cleanup witness rerun also found a separate default KLI-to-Tufa inception
timeout on its earlier two-stream composition. One unchanged case then passed in
6 seconds at clean `9f0d63da`, combining default-eight headroom, fairness and cleanup
with the original 30-second deadline/topology. This closes the additional case;
it does not isolate one cause or implicate the first-seen writer repair.
`default-witness-composition-9f0d63da.log` and its provenance in
`stream-admission-diagnosis` retain this result. Targeted closure preserves every
frozen failure; no complete inventory or volume run was repeated.

## Supported Node floor and package gate

The approved floor is Node >=20.3; merged [#333][node-floor] declares it for
all three packages and Bookworm 20.3.0 qualification, retaining current Alpine CI.
Node 18 results are historical. Merged [#334][exports] fixes Tufa public JS/type
export targets; [#335][native-node] admits pinned matching native Node V8 reads
while retaining Deno NAPI-only protection. Official Node 20.3 V8 and Node 25.9 NAPI
row/copy/transaction probes passed on LMDB 0.9.90, separately from Deno's V1 0.9.29.

Provisional local-tarball probes passed real 2 MiB TCP GenericGroup acceptance
before EOF, finite/parsed-frame verified receipts, HTTP receipt/Auth and joined
cleanup on Node 20.3/25.9. The minimum needed the generated repaired reader;
current Node used its unchanged NAPI branch. This is not final physical tarball
qualification: refreshed engine/export/read metadata,
fresh installed packages and registry publication remain pending. No KERIpy physical
store cross-opening claim is made for ordinary official npm addons.

## Remaining gates

1. Retain exact imported/native provenance and final source/package deltas. The
   completed inventory remains labeled 576/1aa, with its failures intact.
2. Complete exact-head CI for [#341][escrow-writer] and docs/static closure; retain
   source-qualified evidence without successful-path repeats.
   Preserve protocol/topology and accessor/Mapper/schema limits.
3. Source Deno/packed Node actual caller/framing/early-usable/pressure/cleanup evidence,
   exact installed tarballs at advertised Node 20.3.0 and current runtime, with peer
   provenance separated. Existing tiny/finite failure cases supply distinct controls;
   no extra volume/format matrix or automatic repeats.
4. After docs/static closure, refresh [#104][release] versions/ranges/changelogs,
   qualify final physical packs, require exact-head checks and publish
   cesr-ts→keri-ts→@keri-ts/tufa. Its human body and linked release artifacts own
   final registry/tarball/installed evidence; this dated checkpoint stays unchanged.

[pins]: ../../plans/qualification/REFERENCE_ENVIRONMENTS.md
[ipex]: ../../plans/exchange/IPEX_PLAN.md
[stubs]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/core/eventing.py#L4780
[multisig]: ../../plans/exchange/MULTISIG_PLAN.md
[registry]: ../../plans/credentials/REGISTRY_PLAN.md
[exchange]: ../../plans/exchange/EXCHANGE_ADMISSION_PLAN.md
[kram]: ../../plans/exchange/KRAM_PLAN.md
[mapper]: ../../plans/cesr/MAPPER_PLAN.md
[activation]: https://github.com/kentbull/keri-ts/pull/328
[sidecars]: https://github.com/kentbull/keri-ts/pull/326
[receipts]: https://github.com/kentbull/keri-ts/pull/308
[callers]: https://github.com/kentbull/keri-ts/pull/311
[poster]: https://github.com/kentbull/keri-ts/pull/319
[listener]: https://github.com/kentbull/keri-ts/pull/310
[http]: https://github.com/kentbull/keri-ts/pull/323
[witness]: https://github.com/kentbull/keri-ts/pull/327
[mailbox]: https://github.com/kentbull/keri-ts/pull/322
[tel]: https://github.com/kentbull/keri-ts/pull/331
[storage]: ../../plans/db/STORAGE_RECOVERY_PLAN.md
[gaps]: ../../reference/credentials/UPSTREAM_REGISTRY_GAPS.md
[cbor]: ../../design-docs/cesr/CESR_PROGRESSIVE_PARSER_CONTRACT.md
[node-floor]: https://github.com/kentbull/keri-ts/pull/333
[exports]: https://github.com/kentbull/keri-ts/pull/334
[headroom]: https://github.com/kentbull/keri-ts/pull/336
[native-node]: https://github.com/kentbull/keri-ts/pull/335
[fairness]: https://github.com/kentbull/keri-ts/pull/337
[response-close]: https://github.com/kentbull/keri-ts/pull/338
[first-seen]: https://github.com/kentbull/keri-ts/pull/339
[release]: https://github.com/kentbull/keri-ts/pull/104
[escrow-writer]: https://github.com/kentbull/keri-ts/pull/341
