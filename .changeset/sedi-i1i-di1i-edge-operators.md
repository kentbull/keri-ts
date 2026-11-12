---
"keri-ts": minor
---

Add the SEDI issuer-identity Edge operators `I1I` (near and far ACDCs share an issuer) and `DI1I` (the near issuer is the far issuer or an anchored delegated descendant of it), following KERIpy PR 1757. They form a latest-wins group independent of `I2I`/`NI2I`/`DI2I`, compose with `E1E`, and suppress the implicit `I2I`/`NI2I` default. Missing delegation evidence escrows as retryable; a wrong ancestry or DND refuses.

Chain evaluation also changes: unrecognized unary tokens and `NOT` are ANDed as non-retryable unknowns instead of replacing the leaf's other relations, and every schema pin is evaluated unless the relation is already false. An Edge Section that is a list, a falsy non-map value, or carries a top-level `n` or `w` is now malformed, while a compact Edge Section SAID is an opaque, non-retryable unknown. Delegation lookup moved to `core/kel/delegation-ancestry.ts` and now accepts any first-seen delegator approval of the delegated inception, including a superseded one, without the source-seal cache. The legacy TEL verifier checks `I1I` and reports delegated `DI1I` as unsupported instead of coercing it to the default operator.
