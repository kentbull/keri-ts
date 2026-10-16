# Upstream registry integration boundary

Reviewed 2026-10-13 against [`71438328`][current], now the approved parity baseline:
`7143832813cac6a394ab1faf9be83bb3372be87c`. It is three commits beyond historical
`927c0cb8794d7c84fc17143c67df64aab9deda6c`; old measurements retain their source labels.

## Foreign registry intake

At both revisions, [parser dispatch][parser] accepts legacy ACDC messages with
no ilk and rejects nonempty ACDC ilks. `rip`/`bup` do not reach a public registry
processor. The parser and `acdc/registering.py` are byte-identical across these
revisions. The [event engine][engine] needs the issuer prefix and accepted public
KEL database through its Hab, while local naming/creation requires a controlling
Hab. [IPEX chain assembly][ipex] reads accepted registry ordinals; upstream IPEX
tests directly seed recipient stores, which is not a production intake path.

The approved TypeScript integration borrows `Baser` and `RegistryStore`, derives
the issuer from the registry inception, and processes public parsed events
through the existing engine. It requires no issuer private Hab. Normal anchoring,
ordering, escrow and per-event commit rules still apply. Full witnessed tuple
anchors at intake are distinct from the observer verifier's digest-seal support.
This is an intentional integration beyond the inspected upstream, not evidence
that upstream provides the same receiving workflow.

The narrow intake does not promise global freshness. [Discussion #1571][observer]
identifies the missing TEL Observer/polling architecture and separates ecosystem
freshness policy from proof validation. That is contributor analysis, not a merged
implementation or a universal freshness rule. Implementing accepted public intake
does not imply subscription, polling, absence proofs or an ecosystem timeliness
policy. Those claims require their own concrete design and evidence.

## Relevant discussion and later changes

- [#1613][factors] distinguishes issuer proof from presentation proof and gives
  registry, KEL-anchor and signature precedence. [#1618][duplicate] redirects to it.
  Parent acceptance must not authenticate nested children.
- [#1566][events] discusses `rip`/`bup`, possible `upd` deprecation and a proposed
  doubly anchored `xfr`. Discussion proposals do not authorize invented processing.
- Current main's [#1713][schema] adds ACDC schema validation and missing-schema
  escrow. Its changes to local `blind`, IPEX and exchange handling are separate
  from the foreign-intake gap. The S1–S3 ports (#211, #215, #222) implement this delta; final composed
  qualification must use 714. Historical 927 results do not prove #1713 parity.

## Completion policy

A missing or unfinished upstream feature is a reference limitation, not an
impossible completion dependency. Implement the approved TypeScript behavior,
record the source gap and intentional differences, and qualify its actual
supported path. The goal may complete once its own acceptance and release gates
pass, with upstream gaps explicitly reported. Do not claim unsupported parity,
global freshness, or semantics for reference stubs. Existing resource, recovery,
transport, maintained-test and npm-publication obligations remain required.

The [preserved bulk-import algorithm][import] remains available as historical
reference. Its active implementation is removed and callers use public intake;
direct accepted-row writes are not a replacement.

[current]: https://github.com/WebOfTrust/keripy/commit/7143832813cac6a394ab1faf9be83bb3372be87c
[parser]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/core/parsing.py#L1517
[engine]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/acdc/regeventing.py
[ipex]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/acdc/ipexing.py
[observer]: https://github.com/WebOfTrust/keripy/discussions/1571#discussioncomment-17898120
[factors]: https://github.com/WebOfTrust/keripy/discussions/1613
[duplicate]: https://github.com/WebOfTrust/keripy/discussions/1618#discussioncomment-18008500
[events]: https://github.com/WebOfTrust/keripy/discussions/1566#discussioncomment-17846317
[schema]: https://github.com/WebOfTrust/keripy/pull/1713
[import]: VERIFIED_IMPORT_SNAPSHOT.md
