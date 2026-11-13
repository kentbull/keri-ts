---
"keri-ts": patch
"@keri-ts/hosting": patch
"@keri-ts/tufa": patch
---

An agent can now relay for the edges it serves. With the new `AgentRuntimeOptions.relaying` (or `HostKernelSpec.enableRelay` in `@keri-ts/hosting`), `/fwd` intake re-sends the child of a sender that authorized this host as its `mailbox` or `agent` through the agent's own Poster, to the recipient and topic the `/fwd` names. A group's `/fwd` is signed by its local member; it relays when that member authorized the host, or when the forwarded message comes from a group the member belongs to and that group authorized the host. Witness membership alone never grants relaying. A recipient this host already stores for is stored here as before and never relayed, and a recipient in the agent's own Habery is never relayed. A failed onward send is the Poster's logged failed outcome; nothing is acknowledged back to the edge. Relaying requires a mailbox store.

Breaking changes: `ForwardHandler` takes a second constructor argument, the `Poster` to relay with, or `null` for store-only intake. `HostKernelSpec.enableRelay` is required.
