# Progressive runtime delivery evidence through #168

> Historical snapshot at the source revision below. Its pending items and
> implementation names are not a current queue or preservation contract. See the
> [release and post-release record](CLEANUP_RELEASE_2026-10-16.md) and ADR-0012/0013
> for subsequent delivery and supersession. Original measurements remain unchanged.

Snapshot: 2026-10-13, keri-ts `691998a2317881db484f216c00e81a68030dc3a2`.
This is historical evidence, not an execution plan. The [roadmap][roadmap] owns
remaining acceptance. The full prior narrative is retained in
[Git at this boundary][previous]; routine check-by-check history is not repeated.

## Delivered boundaries

| Area                 | Merged PRs                     | Result                                               |
| -------------------- | ------------------------------ | ---------------------------------------------------- |
| Parser foundation    | [126–132][pr126]               | Baseline, decoding, cursor, generators, payload/ESSR |
| Recipient            | [133][pr133], [163][pr163]     | Authenticated plaintext and typed outcomes           |
| Ownership/storage    | [135–137][pr137]               | Awaited dispatch and durable references              |
| Ingress/egress       | [138–145][pr145]               | Streaming intake, output, replay, query/mailbox      |
| Engine removal       | [146][pr146]                   | One progressive engine                               |
| Tables/semantics     | [148–154][pr148], [156][pr156] | Frozen wire, replay, records, thresholds, SAIDs      |
| Owned trees          | [155][pr155], [157–159][pr159] | Parsing, serialization, annotation, forwarding       |
| Multisig             | [160–161][pr161]               | Four nested routes; pure-body/byte-input extraction  |
| EXN proof policy     | [162][pr162], [165][pr165]     | Historical proofs, capabilities, escrow/cues         |
| Live LMDB inspection | [164][pr164]                   | Separate real host/inspection processes              |
| Disclosure/registry  | [166][pr166], [167][pr167]     | Canonical paths and read-only chain vetting          |
| Nested IPEX          | [168][pr168]                   | Graph/issuer verification, dependency retention      |

Ranges summarize delivered slices; linked PRs and the historical plan retain each
individual review. They do not imply full runtime parity or a resource bound.

## Independent evidence and limits

- #134 reorganized and ran the then-complete local inventory: 1,059 tests, including
  577 KERI tests across 111 files and manual endurance. Qualification source was
  `1e0af1b189ae947bb236178946e6ab008d885507`. Counts are historical; final work must
  run the current maintained inventory without changing topology.
- #159 delivered 490 CESR tests, 19 focused runtime/serialization tests and independent
  Python checks of 34 serialized trees/12 stored rows. A signed 40-node fixture
  checks default depth through replay. Nested runtime normalization then admitted
  only v2 fwd; subsequent multisig/IPEX work widened specific completed routes.
- #161 proved direct parsed-frame construction, v1 pathed/v2 nested commitments,
  real multisig coordination, storage/replay and joined cancellation. Native EXN
  empty-field construction remained unqualified.
- #163 distinguished busy/limit/unaccepted admission from envelope/digest/decrypt/
  framing failures, with pre-read rejection, durable exchange prerequisites,
  joined I/O cleanup and plaintext-owner transfer. It retained per-recipient guards.
- #164 reproduced same-process duplicate LMDB V1 environment-handle failure before
  ESSR processing. A real CLI child hosts the store while the parent inspects it;
  protocol participants, stored-role and live HTTP assertions remain intact.
- #165 preserved source/foreign/cigar evidence, independent capability selection,
  query/escrow behavior and incomplete duplicates. Canonical signature ordinals
  fixed retry duplication. Foreign signatures are excluded from group leadership.
- #166 used independent four-format canonical/partial bytes and path fixtures;
  #167 used frozen signed KEL/registry fixtures and upstream verifier tests.
  Compactor construction does not authenticate issuers; registry vetting does not
  create issuer-side processing or globally fresh state.
- #168 added a 42-case semantic Python wire oracle, actual two-Habery dependency
  retry/reopen, observer registry import and blocked-I/O cleanup. Local app and DB
  suites passed at their recorded checkpoints; all six required final-head checks
  passed on `2c725bcd078c45164ddb809719b6dcbff73860b4`. The maintainer merged it.
  Presentation-registry KRAM cutoffs and native outer EXN qualification remain open.

The frozen fixture generators check actual loaded module bytes against upstream
`927c0cb8794d7c84fc17143c67df64aab9deda6c`. Runtime mailbox evidence instead uses
fork `b08ddeb047fd865d60affe82a0dc77f5efaf4672`; see the [pin inventory][pins].
Mac/Linux, Sally and embedded DID Webs results must not be inferred from those probes.

## Preserved benchmark context

An earlier parser-only 4 GiB run used 65,536 × 64 KiB items, reported peak RSS
288,550,912 bytes, elapsed 367.98 s and first frame 9.125875 ms. This is a historical
parser observation, not a repeated full-runtime bound. Immutable untouched,
decoding-fixed, cursor and progressive worktrees/artifacts remain separate inputs
to [final qualification][qualification]. Keep individual observations and variance.

Docker qualification used container-local state without macOS LMDB bind mounts.
The #168 scratch native-addon preflight detected a default-data-format build; the
repository V1 setup rebuilt it before maintained-suite runs. This does not qualify
native macOS LMDB or solve the whole-row allocation boundary. Existing 24 MiB
nested-wire and other finite row ceilings still check after LMDB materialization.

[roadmap]: ../../plans/PARITY_ROADMAP.md
[pins]: ../../plans/qualification/REFERENCE_ENVIRONMENTS.md
[qualification]: ../../plans/qualification/QUALIFICATION_PLAN.md
[previous]: https://github.com/kentbull/keri-ts/blob/691998a2317881db484f216c00e81a68030dc3a2/docs/design-docs/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md
[pr126]: https://github.com/kentbull/keri-ts/pull/126
[pr133]: https://github.com/kentbull/keri-ts/pull/133
[pr137]: https://github.com/kentbull/keri-ts/pull/137
[pr145]: https://github.com/kentbull/keri-ts/pull/145
[pr146]: https://github.com/kentbull/keri-ts/pull/146
[pr148]: https://github.com/kentbull/keri-ts/pull/148
[pr155]: https://github.com/kentbull/keri-ts/pull/155
[pr156]: https://github.com/kentbull/keri-ts/pull/156
[pr159]: https://github.com/kentbull/keri-ts/pull/159
[pr161]: https://github.com/kentbull/keri-ts/pull/161
[pr162]: https://github.com/kentbull/keri-ts/pull/162
[pr163]: https://github.com/kentbull/keri-ts/pull/163
[pr164]: https://github.com/kentbull/keri-ts/pull/164
[pr165]: https://github.com/kentbull/keri-ts/pull/165
[pr166]: https://github.com/kentbull/keri-ts/pull/166
[pr167]: https://github.com/kentbull/keri-ts/pull/167
[pr168]: https://github.com/kentbull/keri-ts/pull/168
