---
"keri-ts": patch
"@keri-ts/hosting": patch
"@keri-ts/tufa": patch
---

An agent can now relay for the edges it serves. With the new `AgentRuntimeOptions.relaying` (or `HostKernelSpec.enableRelay` in `@keri-ts/hosting`), `/fwd` intake delivers the child of a sender that authorized this host as its `mailbox` or `agent`. A recipient that is a habitat of the agent's own Habery (an edge's group co-member hosted on the agent) receives it through the agent's own ingress, as remote input to that habitat's endpoint, with signature, KRAM and escrow rules applied as for any received message. Any other recipient gets it through the agent's own Poster, at the recipient and topic the `/fwd` names. A group's `/fwd` is signed by its local member; it relays when that member authorized the host, or when the forwarded message comes from a group the member belongs to and that group authorized the host. Witness membership alone never grants relaying. Exactly one path runs: local habitat, then a recipient this host already stores for (stored as before), then relay. A failed onward send is the Poster's logged failed outcome; nothing is acknowledged back to the edge. Relaying requires a mailbox store.

Breaking changes: `ForwardHandler` takes a second constructor argument, a `ForwardRelaying` (the runtime's `Poster` and `Reactor`), or `null` for store-only intake. `HostKernelSpec.enableRelay` is required.
