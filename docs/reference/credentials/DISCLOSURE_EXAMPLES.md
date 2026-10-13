# Disclosure examples

Read the [disclosure contract](../../design-docs/credentials/GRADUATED_DISCLOSURE.md) first.

## Worked example: `BlindState`

### Semantic record

The semantic form is a fixed record:

- `d`: blinded commitment
- `u`: deterministic disclosure UUID
- `td`: associated ACDC SAID or placeholder
- `ts`: state string such as `issued` or `revoked`

### Build flow

`makeBlindState(...)` does this:

1. resolve or derive `u` via `makeBlindUuid(...)`
2. create a placeholder record with `d=""`
3. recompute `d` from the tuple-body serialization with dummied `d`
4. return the rehydrated committed record

### Unblind flow

`unblindBlindState(...)` does not decrypt anything.

It searches candidate combinations:

- given or placeholder `acdc`
- each provided state plus the empty placeholder state

For each candidate it recomputes the commitment and compares the resulting
`d.nonce` to the target `said`.

If one matches, that candidate is the verified disclosure.

## Worked example: `BoundState`

`BoundState` is `BlindState` plus:

- `bn`: issuee key-state sequence number
- `bd`: issuee key-state event SAID

Those extra fields cross-anchor the issuee’s key state to the issuer’s blinded
state update.

This is why `BoundState` is not just “BlindState with extra metadata.” The extra
pair changes the commitment meaning by binding the issuee state at the time of
update.

## Worked example: `TypeMedia`

`TypeMedia` carries:

- `d`: media commitment
- `u`: disclosure UUID
- `mt`: media type
- `mv`: media value

This is the fixed-field media analogue of the blind-state flow:

- semantic record in `structing.ts`
- commit helper in `disclosure.ts`
- counted-group transport in `mediar.ts`

## Worked example: hierarchical disclosure with `Compactor`

Suppose a nested map has:

- a top-level `d`
- a nested child map `a` with its own `d`

`Compactor` can:

1. trace saidive leaves
2. compute the child-map SAID
3. replace the child map with that SAID
4. recompute the top-level SAID over the compacted branch
5. later re-expand selected branches into partial-disclosure variants

This is graduated disclosure by branch compaction and re-expansion, not by
blind-state placeholder search.

## Worked example: selective disclosure with `Aggor`

For an aggregate list:

- slot zero is the aggregate identifier (`agid`)
- later elements may be compact SAIDs or fully disclosed maps

`Aggor.disclose([indices])` reveals selected map elements while preserving the
same aggregate commitment in slot zero. The commitment hashes the complete
serialized compact list, including CESR counters or JSON/CBOR/MGPK list framing.
Disclosed maps must retain their verified SAIDs, and `verifyDisclosure` rejects
a changed map SAID, map content, or AGID.

`Aggor.kind` is the serialization kind, `code` is the digest code, and `raw` /
`qb64b` contain the complete aggregate serialization. Native `count` includes
the counter; other kinds use null. CESR binary conversion uses `qb2`.
`Aggor` no longer inherits `Structor`: generic parser list/map groups are
transport projections under `Serder.projectStructors().generic`, using
`Structor` and its `qb64g` / `qb2g` views. Construct semantic aggregates with
`new Aggor({ael, kind})` or `new Aggor({raw, kind})`.

Checked vectors in `aggregate-vectors.json` cover all four kinds against frozen
KERIpy `927c0cb8794d7c84fc17143c67df64aab9deda6c`;
`reference-aggregate-vectors.py` verifies the imported source bytes before
regenerating them.

This is selective list disclosure, not fixed-field blinded disclosure and not
hierarchical branch compaction.
