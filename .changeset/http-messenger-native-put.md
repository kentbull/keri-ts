---
"keri-ts": patch
---

Send native CESR frames through `HTTPMessenger` as one whole `PUT` per frame, following KERIpy PR 1751. A frame whose body is a counter-prefixed native CESR message (text or binary domain) now goes out with the serialized frame as the body, `Content-Type: application/cesr`, `Content-Length` and `CESR-DESTINATION`, retaining caller headers such as `Authorization` and omitting `CESR-ATTACHMENT`/`CESR-Genus`. JSON/CBOR/MGPK frames keep the existing detached-attachment `POST` path and legacy media fallback. Before this, a native frame was posted with a non-JSON body that KERIpy receivers refused with HTTP 400.
