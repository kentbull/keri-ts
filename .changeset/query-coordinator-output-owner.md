---
"keri-ts": minor
---

Delete RuntimeDeliveries and give QueryCoordinator ownership of signed query packets, route preparation and joined HTTP/TCP/SSE response I/O. Construct it with actual Reactor and clock/HTTP dependencies, include pending output in query convergence, and remove the runtime delivery field and unused delivery counters.
