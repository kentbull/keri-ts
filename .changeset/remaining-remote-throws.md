---
"keri-ts": patch
---

More ways a remote party could end an agent's runtime now end only the one message or operation, as a typed refusal.

- A delegated inception whose delegator's accepted KEL anchors an unknown seal shape, or an event seal with undecodable values, threw from delegation validation and `delegationAncestry`. Anchor searches now read raw seals through the new `readEventSeal` and skip what does not decode, as KERIpy does; `Baser`'s sealing-event lookups use the same reader.
- A `/tsn/registry` or `/tsn/credential` notice whose `dt` is a valid timestamp that a Dater cannot encode (no fraction, `Z`) threw on its way to dependency escrow. It is now an unverified notice.
- A TEL event (`vcp`, `iss`, ...) was never SAID-checked: an unverified body reached out-of-order escrow and threw on every escrow pass. `Tevery.processEvent` now rejects a body that does not verify, a non-hex or unsafe `s`, and an `i`/`ri` that is not exactly one qualified prefix, before any escrow.
- A child nested where a flat message is required (a BUP inside an Unblind query, an event inside a multisig or IPEX exchange) made `envelopeFromFrame` throw a plain `Error`. It now raises `ValidationError`, so the parent is refused.
- A credential whose schema reference starts with `http://` but does not parse threw `TypeError`, and a credential body that is not JSON threw `SyntaxError` from schema validation. The first names no cached schema; the second fails validation (`invalidSchema`).
- A KRAM exchange message whose stamp a Dater cannot encode threw while staging its thread opener, and an exchange id that is not one qualified digest made a cache key the pruner could not split. Both are dropped before any write (`timestamp`, new `exchangeId` reason).
- A query request that can never be addressed rotated in the querier forever; any unverified reply signed by an unknown prefix creates one. A request with a ready signer and no reachable attester is now dropped with a log after `UNADDRESSED_QUERY_PASS_LIMIT` passes. A TCP query location without a valid port, or on a host without a TCP dialer, is unreachable instead of a delivery fault.
- A delegator or witness that is unreachable or refuses ended the delegating loop and the TEL publication loop. The delegation workflow row is kept for the next tick (and is no longer removed before its publication succeeds), and a TEL publication stays pending for the witnesses that did not take it. New: `deliverWitnessMessage`, `Receiptor.attempt`.
