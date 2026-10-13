# Frozen reference tables and wire boundaries

Table source: KERIpy `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
Implementation starts at keri-ts `539ed16` (the tree merged as `c0e94454`).
The prior generated source was `450ae1c2a7eac61d92bc7b830cb6883c41e6a798`.
Runtime harness pins are separate; this table upgrade does not upgrade them or
claim complete current-reference runtime parity.

## Audited table changes

| Surface                       | Frozen reference change                                                  | TypeScript treatment                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| v1 `-D`                       | Removed `TransReceiptQuadruples` from codex; size row commented out      | Retain the historical item-counted protocol extension, excluded from `resolveCtrDex(V1)`                 |
| v1 `-J` / `-K`                | Historical path signatures remain absent                                 | Retain existing `SadPathSig` / `SadPathSigGroup` protocol readers and widths outside the canonical codex |
| v2 `-N` / `--N`               | `NonceSealSingles` / `BigNonceSealSingles`, replacing receipt quadruples | One meaning in v2; remove receipt dispatch and reject v1 receipt conversion to v2                        |
| v2 `--G`                      | Active `Cizage(3,5,8)` row has a trailing comma                          | Fix extraction; the old generator omitted this valid big map-body width                                  |
| v2 `-J`                       | Active `Cizage(2,2,4)` row has a trailing comma                          | Extract directly, removing the hand-written size repair                                                  |
| Matter `b`                    | GramHead: `hs=1, ss=3, xs=0, fs=8, ls=0`                                 | Preserve three soft metadata sextets and three raw bytes; qb2 width is six bytes                         |
| Matter `0P`, `0Q`, `0R`, `0S` | Removed old GramHead variants                                            | Reject these codes; do not reinterpret old headers as current `b`                                        |

The source comparison covers counter codices/sizes, Matter codices/sizes, indexer
tables, string codices, and traits. Regeneration changes no other code assignments
or primitive widths. Current Python also adds body-universal subset helpers; these
introduce no wire codes and do not widen the parser's supported body contexts.
The generator matches active rows only, including Python trailing commas; a
commented historical row is never silently treated as current reference support.

Special Matter soft text is metadata, not a derived count. Construction now accepts
`soft` explicitly for fixed special codes; variable-size counts remain derived from
payload size. Counter construction promotes overflowing small forms only through
the selected genus's named big form. Inner transferable-signature groups retain
their stricter small-header restriction in serialization.

## Nonce seal contexts

`SealNonce` contains one `nd: Noncer` value. Its crew/SAD projection uses qualified
`qb64`, including `1AAP` for Empty; it does not use the empty-string `nonce`
projection used by blind-state fields. Digest and salt nonce codes remain valid.

| Context                                | Frozen Python evidence                                                                                  | TypeScript boundary                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Fixed-field `SealNonce` record         | `SClanDom`, `SCastDom`, `ClanToCodens` include it                                                       | Descriptor and registries include it                                                         |
| Counted structing / `Sealer` transport | `Sealer.enclose/extract` support small `-N`                                                             | `parseStructor` / `parseSealer` support small and big nonce groups with exact payload bounds |
| Top-level message attachment           | `Parser.Methods[2][0].NonceSealSingles` is `None`                                                       | Attachment parsing and annotation reject both nonce counter forms                            |
| Native event `a` seal list             | `SealDex_2_0` and `Serder.ClanCodes/CodeClans` omit it; native inception raises `KeyError('SealNonce')` | Native event emission/decoding reject nonce seals; no speculative native encoding            |
| JSON seal projection                   | Fixed-field record support is independent of native framing                                             | Qualified nonce SADs can be represented and projected                                        |

Python's generic `Sealer.extract` also lacks big coden entries. Big wire evidence
therefore uses the actual `Counter` reader followed by bounded `Sealer` tuple
extraction. TypeScript supports the defined big wire form without reproducing this
helper defect. This is distinct from native-event admission, which needs a future
explicit protocol/reference decision.

No parse failure selects another genus. Historical v1 `-D` retains its own
four-field receipt roles; current v2 `-N` never inherits them. Canonical codex
membership, historical wire support, and context-specific dispatch are separate
contracts.

## Reproducing independent wire evidence

Run in a container-local checkout with dependencies already available; this work
used Deno 2.8.2 and Python 3.14.6, with modules imported from
`/work/keripy-main927/src/keri/core`. The script checks the full Git SHA and every
imported reference module's bytes before emitting or consuming evidence.

```sh
PYTHONPATH=/work/keripy-main927/src /work/keripy-mailbox/.venv/bin/python \
  packages/cesr/scripts/reference-wire-vectors.py \
  > packages/cesr/test/fixtures/current-reference-vectors.json
deno test -A packages/cesr/test/unit/tables/current-reference.test.ts
deno run -A packages/cesr/test/fixtures/current-reference-vectors.ts > /tmp/ts-wire.json
PYTHONPATH=/work/keripy-main927/src /work/keripy-mailbox/.venv/bin/python \
  packages/cesr/scripts/reference-wire-vectors.py /tmp/ts-wire.json
KERIPY_PATH=/work/keripy-main927 deno run -A packages/cesr/scripts/verify-tables.ts
```

Python-to-TS fixtures include literal qb64 and hexadecimal qb2, semantic nonce
roles, independent canonical counter tables, exact widths and consumed extents,
small/big forms, and the 4095/4096 promotion boundary. TS-to-Python verification
reads newly constructed TS output in both domains and preserves trailing bytes.
Regression tests cover every truncated header/token prefix, malformed declared
nonce lengths, wrong nonce roles, removed Matter codes, partition-invariant
attachment rejection, native event rejection, and preserved v1 receipt input.

The separate text-escape primitive port, FirstSeen/current semantic accessor
audit, imported v2 event replay, nested attachments, and runtime qualification
remain follow-ons under the progressive parser plan. In particular, frozen
`SealKind.d` and the `TypedDigestSealCouples` attachment reader use `Noncer`, while
this slice retains their existing `Diger` roles. That additional accepted-token
delta belongs to follow-on 1a; table parity is not semantic primitive completeness.
