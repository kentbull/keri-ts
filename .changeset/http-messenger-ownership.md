---
"keri-ts": major
"@keri-ts/tufa": major
---

Introduce HTTPMessenger with explicit HTTP/clock/protocol dependencies and input-owned Kevery/parser lifetimes. Query and receipt owners depend directly on ProtocolProcessor rather than Reactor; finite/streamed sends share lower HTTP cleanup and framing. Remove the unused postCesrMessage wrapper and migrate constructor contracts without compatibility aliases.
