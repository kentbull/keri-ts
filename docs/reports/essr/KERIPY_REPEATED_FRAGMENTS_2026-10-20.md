# KERIpy ESSR persistence loses repeated fragments

Observed: 2026-10-20. Status: reproduced locally; not submitted upstream.

## Finding

ESSR commits to the concatenation of Texter **raw bytes, in order and with
multiplicity**. KERIpy persists these fragments in an insertion-ordered **set**.
Identical qualified Texters are deduplicated, so reconstruction can change the
committed bytes and invalidate their digest.

Example: `[Texter(raw=b"abc"), Texter(raw=b"abc")]` commits to `b"abcabc"`.
Persistence retains one Texter, and reconstruction produces `b"abc"`.
Repeated fragment values are not inherently invalid: fragmentation of an opaque
ciphertext can produce the same value more than once. Idempotent delivery of an
exchange and multiplicity within its payload are separate concerns.

## Verified revisions

These are frozen reference revisions, not a claim about future branch heads.
The probe used disposable native LMDB stores in a Linux aarch64 container.

| Profile | Commit                                     | Python  | python-lmdb |
| ------- | ------------------------------------------ | ------- | ----------- |
| main    | `424a50c03421165c5f289e07a341bd57b8d8ab78` | 3.14.6  | 2.3.0       |
| 1.2.14  | `bab95c16e949b61398129a3e41a8f68bad84c94f` | 3.13.16 | 1.7.5       |
| 1.3.6   | `4ce4cc79e06653f77342be1bf604086b89b1f090` | 3.13.16 | 1.7.5       |

All three produced the same result: insertion returns `[True, False]`, two input
fragments become one stored fragment, the original digest verifies before storage
and fails against reconstructed bytes.

## Minimal reproducer

Run with the selected KERIpy checkout installed in its matching environment:

```python
# Import first to initialize the legacy releases' circular module graph.
from keri.app import habbing
from keri.core import coring
from keri.db import basing

fragment = coring.Texter(raw=b"abc")
original = fragment.raw + fragment.raw
commitment = coring.Diger(ser=original)

with basing.openDB(name="essr-fragment-probe", temp=True) as db:
    inserted = [
        db.essrs.add(keys=(commitment.qb64,), val=fragment)
        for _ in range(2)
    ]
    stored = db.essrs.get(keys=(commitment.qb64,))
    reconstructed = b"".join(item.raw for item in stored)
    print(inserted, len(stored), reconstructed)
    print(commitment.verify(ser=original),
          commitment.verify(ser=reconstructed))
    assert reconstructed == original, "ESSR persistence dropped fragment bytes"
```

Actual output on each revision, followed by the failing assertion:

```text
[True, False] 1 b'abc'
True False
```

This is a table-level persistence reproduction. It does not submit a signed EXN
through the entire Exchanger or prove end-to-end recipient behavior. The ESSR
refactor's implementation tests must also exercise signed exchange acceptance,
restart and escrow retry/replay through public processing paths.

## Reference source and consequence

At the verified main revision:

- [Exchanger.processEvent](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/peer/exchanging.py#L328)
  joins raw Texter bytes and already checks their signed digest. Digest verification
  is present upstream; it is not a missing feature discovered here.
- [Exchanger.logEvent](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/peer/exchanging.py#L746)
  inserts each Texter with `essrs.add`.
- [Baser](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/db/basing.py#L1165)
  binds `essrs.` as `CesrIoSetSuber`; its set contract intentionally deduplicates
  equal values. The generic set implementation is behaving as specified.
- [Escrow reconstruction](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/peer/exchanging.py#L617)
  reads those retained Texters before calling `processEvent` again. The persistence
  defect can therefore turn an initially matching commitment into a digest failure
  on retry or reconstruct different replay evidence. This consequence follows from
  the source paths; the probe above isolates the storage defect.

## Conceptual upstream recommendation

Store ESSR fragments as an ordered sequence keyed by exchange SAID and fragment
ordinal, retaining qualified Texter values and repeated occurrences. Existing
ordinal LMDB primitives should suffice. Make repeated delivery idempotent at the
same exchange/position, rather than deduplicating distinct positions by value.

The essential invariant is that concatenated raw bytes survive persistence;
identical original fragmentation is not required if an alternative normalization
can prove that invariant for every supported payload size. Simply coalescing all
fragments into one Texter needs a representability check and must not introduce a
new protocol rejection or payload limit.

A small regression should commit repeated fragments, persist/reopen, then verify
the original digest and escrow/replay reconstruction. keri-ts uses the same physical
`essrs.` layout: EXN SAID plus a dot and 32-digit hexadecimal ordinal, with
qualified Texter bytes as the value. Equal values at different positions are
retained. Focused TS tests cover signed acceptance, restart, escrow retry and
replay with repeated fragments. A separate test against all three pins confirms
that KERIpy's typed reader reads the repeated TS rows, and that TS reopens
ordinary rows written by KERIpy. This is storage interoperability evidence, not
a claim that the upstream deduplicating writer is fixed. No filesystem archive
is needed to solve it.
