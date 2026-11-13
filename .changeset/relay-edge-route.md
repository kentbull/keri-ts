---
"keri-ts": patch
---

A runtime can be an edge that delivers through its agent. `AgentRuntimeOptions.relay` names the agent (`Relay`: its
AID and its own OOBI). With it, `createAgentRuntime` wraps the HTTP client in `relayOnlyHttpClient`, which refuses as
`RelayOnlyError` (a `TransportError`) any request whose origin is neither the relay's OOBI origin nor an accepted relay
location, and queues the relay's OOBI when its location is not accepted yet. `Poster` sends every recipient other than
the relay one `/fwd` delivery to the relay, never a direct fallback, and sends to the relay itself directly; while the
relay is unresolved a delivery fails with `RelayUnresolvedError` and nothing is sent. `relayEndpoint` reads the relay's
accepted location. A runtime without `relay` delivers directly as before. `Poster`'s constructor takes the relay (or
null) as its last argument.
