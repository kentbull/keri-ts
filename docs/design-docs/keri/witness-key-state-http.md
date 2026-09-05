# Witness key-state HTTP replies

Tufa witness hosts expose `GET /ksn?pre=<target AID>` with `CESR-DESTINATION` equal to the host policy's witness AID. Missing or mismatched destination and missing target return 400. Unknown target or an accepted latest event without its required witness receipts returns 404. A successful response is 200 `application/cesr`, containing an actual endorsed KERI reply at `/ksn/<witness AID>` with the accepted target key-state record.

The core helper refreshes the target Kever and uses the same `Baser.fullyWitnessed` gate as the existing KERI `ksn` query path. The helper returns typed accepted/rejected decisions; Tufa owns HTTP routing. Controller-only hosts do not acquire this route. Endpoint selection does not grant a request caller control over which habitat signs.

This follows the witness-hk endpoint's destination, target, receipt and endorsement semantics at [5cd978c](https://github.com/keri-foundation/witness-hk/blob/5cd978cb30ce68936024b4e7bf0179dc2b896d29/src/witopnet/app/indirecting.py#L661). Wire generation deliberately follows the existing keri-ts reply and Hab endorsement defaults: KERI 1.0 JSON event bytes plus CESR signature attachments. It does not claim witness-hk's KERI 2.0 native CESR generation. The media type labels a signed CESR protocol stream, not an unsigned JSON status API.

Acceptance tests exercise the shared actual Tufa handler with real habitats and receipts. They require receipt gating and independently parse/verify the returned notice in fresh observer state, including rejection of a changed signature. The addition does not implement a watcher, prove a controller fork from a witness claim, or authorize an observer to ignore source identity, stale-state or target-roster validation.
