---
"cesr-ts": minor
"keri-ts": minor
---

Correct ACDC aggregate commitments and disclosure verification for CESR, JSON, CBOR, and MGPK. Credential issuee accessors now read the first disclosed aggregate member, so requested revocation delivery can include that recipient while compact commitments remain undisclosed.

Aggor is now a standalone semantic primitive: kind names the serialization format, code names the digest, raw/qb64b contain the complete body, and CESR count includes its enclosure (other kinds use null). Replace Aggor.qb64g/qb2g with qb64/qb2 and serialized.length with size. Generic map/list parsing belongs to Structor or Mapper; projectStructors().aggor is replaced by projectStructors().generic containing Structors. Remove callers of parseAggor, Aggor.fromGroup, and isAggor*Code instead of treating arbitrary generic groups as valid aggregate commitments.
