# CESR Primitives KERIpy Parity Matrix

## Purpose

This is the scan-friendly companion to the walkthrough guide.

Use it when you already know the symbol name and want fast answers about:

- the KERIpy peer
- the primitive family/category
- how it is initialized
- what encodings it exposes
- whether the TypeScript shape is direct parity, near parity, or TS-local

Companion guide:

- [CESR Primitives Walkthrough](./CESR_PRIMITIVES_WALKTHROUGH.md)

Baseline source for the KERIpy comparisons in this document:

- `keripy` branch `main`
- primitive fixture baseline commit: `5a5597e8b7f7`

## Legend

- `direct`: same role and close shape to the KERIpy peer
- `near`: same role, but TypeScript packaging or convenience surface differs
- `TS-local`: no direct public KERIpy peer in the same shape

## Foundation

| `keri-ts`      | KERIpy peer                 | Role/category                             | Initialization shapes                            | Encoded forms exposed                              | Parity note |
|----------------|-----------------------------|-------------------------------------------|--------------------------------------------------|----------------------------------------------------|-------------|
| `Matter`       | `coring.Matter`             | Non-indexed qualified material base       | `raw+code`, `qb64`, `qb64b`, `qb2`               | `raw`, `qb64`, `qb64b`, `qb2`, size fields         | `direct`    |
| `Indexer`      | `indexing.Indexer`          | Indexed qualified material base           | `raw+code+index(+ondex)`, `qb64`, `qb64b`, `qb2` | `raw`, `qb64`, `qb64b`, `qb2`, `index`, `ondex`    | `direct`    |
| `Counter`      | `counting.Counter`          | Versioned framing/group counter           | `code+count+version`, `qb64`, `qb64b`, `qb2`     | `qb64`, `qb64b`, `qb2`, `count`, `name`, `version` | `direct`    |
| `CounterGroup` | parser/group result concept | Parsed counter plus grouped payload/items | parser-produced                                  | `Counter` fields plus `raw`, `items`               | `near`      |

## Message And Body

| `keri-ts`          | KERIpy peer            | Role/category               | Initialization shapes                   | Encoded forms exposed                         | Parity note |
|--------------------|------------------------|-----------------------------|-----------------------------------------|-----------------------------------------------|-------------|
| `Serder`           | `serdering.Serder`     | Parsed body object          | usually `parseSerder(raw, smellage)`    | `raw`, `ked`, protocol/version metadata       | `direct`    |
| `SerderKERI`       | `serdering.SerderKERI` | KERI body subtype           | parser-produced / constructor           | same as `Serder`                              | `direct`    |
| `SerderACDC`       | `serdering.SerderACDC` | ACDC body subtype           | parser-produced / constructor           | same as `Serder`                              | `direct`    |
| `CesrBody`         | no exact public peer   | Typed parser body contract  | not directly constructed                | body metadata plus optional native projection | `TS-local`  |
| `Structor`         | `structing.Structor`   | Typed counted-group wrapper | `parseStructor(...)`, `.fromGroup(...)` | `qb64g`, `qb2g`, grouped serialization        | `direct`    |
| `UnknownPrimitive` | no exact public peer   | Lossless opaque placeholder | `fromPayload(...)`                      | preserved `qb64`, `qb2`, `raw`                | `TS-local`  |

## Core `Matter` Derivatives

| `keri-ts`         | KERIpy peer                                  | Role/category                 | Initialization shapes                               | Encoded forms exposed                              | Parity note |
|-------------------|----------------------------------------------|-------------------------------|-----------------------------------------------------|----------------------------------------------------|-------------|
| `Diger`           | `coring.Diger`                               | Digest material               | `qb64`, `qb64b`, `qb2`, `raw+code`                  | `Matter` forms                                     | `direct`    |
| `Prefixer`        | `coring.Prefixer`                            | Identifier prefix material    | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Verfer`          | `coring.Verfer`                              | Verification-key material     | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Saider`          | `coring.Saider`                              | Self-addressing digest        | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Seqner`          | `coring.Seqner`                              | Sequence-number material      | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `NumberPrimitive` | `coring.Number`                              | Qualified numeric material    | same as `Matter`                                    | `Matter` forms plus numeric projection helpers     | `direct`    |
| `Tholder`         | `coring.Tholder`                             | Threshold material            | parse/helper-oriented, numeric encodings underneath | `Matter`-family encodings plus threshold semantics | `direct`    |
| `Verser`          | `coring.Verser`                              | Version/protocol tag          | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Ilker`           | `coring.Ilker`                               | Event-ilk tag                 | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Traitor`         | `coring.Traitor`                             | Trait tag                     | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Tagger`          | `coring.Tagger`                              | Generic tag material          | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Labeler`         | `coring.Labeler`                             | Field-label material          | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Texter`          | `coring.Texter`                              | Text payload material         | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Bexter`          | `coring.Bexter`                              | Base64-text payload material  | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Pather`          | `coring.Pather`                              | SAD/path material             | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Dater`           | `coring.Dater`                               | Datetime material             | same as `Matter`                                    | `Matter` forms plus date projection                | `direct`    |
| `Noncer`          | `coring.Noncer`                              | Nonce material                | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Decimer`         | `coring.Decimer`                             | Decimal numeric material      | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Salter`          | `coring.Salter`                              | Salt material                 | same as `Matter`                                    | `Matter` forms                                     | `direct`    |
| `Signer`          | signer/seed model spread across `signing.py` | Seed/signing material wrapper | constructor from qualified forms                    | `Matter` forms plus seed accessor                  | `near`      |
| `Encrypter`       | encrypter/public-key material model          | Encryption-key wrapper        | constructor from qualified forms                    | `Matter` forms                                     | `near`      |
| `Decrypter`       | decrypter/private-key material model         | Decryption-key wrapper        | constructor from qualified forms                    | `Matter` forms                                     | `near`      |
| `Cipher`          | cipher-family material model                 | Ciphertext wrapper            | constructor from qualified forms                    | `Matter` forms                                     | `near`      |
| `Cigar`           | `coring.Cigar`                               | Unindexed signature material  | same as `Matter`                                    | `Matter` forms                                     | `direct`    |

## Indexed Signature Family

| `keri-ts` | KERIpy peer      | Role/category              | Initialization shapes | Encoded forms exposed                    | Parity note |
|-----------|------------------|----------------------------|-----------------------|------------------------------------------|-------------|
| `Siger`   | `indexing.Siger` | Indexed signature material | `Indexer` shapes      | `Indexer` forms plus signature semantics | `direct`    |

## Counted-Group Structor Family

| `keri-ts` | KERIpy peer                      | Role/category                | Initialization shapes                  | Encoded forms exposed                  | Parity note |
|-----------|----------------------------------|------------------------------|----------------------------------------|----------------------------------------|-------------|
| `Sealer`  | `structing.Sealer`               | Seal-group wrapper           | `parseSealer(...)`, `.fromGroup(...)`  | grouped `qb64g`, `qb2g`, typed members | `direct`    |
| `Blinder` | blinder-family structor behavior | Blind-state group wrapper    | `parseBlinder(...)`, `.fromGroup(...)` | grouped encodings and typed members    | `near`      |
| `Mediar`  | media structor behavior          | Media-bearing group wrapper  | `parseMediar(...)`, `.fromGroup(...)`  | grouped encodings and typed members    | `near`      |
| `Aggor`   | aggregate/list structor behavior | Aggregate/list group wrapper | `parseAggor(...)`, `.fromGroup(...)`   | grouped encodings and typed members    | `near`      |

## Support Surface

| `keri-ts`                                       | KERIpy peer                                              | Role/category                         | Initialization shapes | Encoded forms exposed        | Parity note |
|-------------------------------------------------|----------------------------------------------------------|---------------------------------------|-----------------------|------------------------------|-------------|
| `codex.ts` subsets                              | multiple codex tables in `coring.py` / `kering.py`       | Semantic code-family sets             | import constants      | none; support constants only | `TS-local`  |
| `Primitive` / `GroupEntry` / `CounterGroupLike` | no exact public peer                                     | Recursive parser graph typing         | parser-produced       | typed unions/interfaces      | `TS-local`  |
| `Mapper`                                        | native map/body parsing spread across parser logic       | Map-body syntax + semantic projection | parse helpers         | typed field projection       | `TS-local`  |
| `Compactor`                                     | no exact public peer                                     | Narrow map-group parser helper        | parse helper          | typed map projection         | `TS-local`  |
| `registry.ts` helpers                           | codex/constructor knowledge spread across Python modules | Inspection/listing helpers            | helper functions      | lightweight `PrimitiveToken` | `TS-local`  |

## Fast Takeaways

- `Matter`, `Indexer`, and `Counter` are the three bases you should memorize.
- `Serder` and `Structor` are the two big "typed projection" layers on top of
  raw CESR material.
- Most primitive-by-primitive comparisons to KERIpy are straight across.
- The main intentional TypeScript-specific shape is `CesrBody` and the broader
  typed parser/body contracts around it.
