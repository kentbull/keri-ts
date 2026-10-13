# CESR Atomic Bounded Parser Architecture

The stream parser keeps one open frame and complete queued siblings. Nested
counted payloads are bounded and parsed atomically; there is no resumable nested
parse stack. See the [normative contract](CESR_PARSER_STATE_MACHINE_CONTRACT.md)
and [module guide](CESR_PARSER_MAINTAINER_GUIDE.md).

## Ownership

```mermaid
flowchart TD
    C["Caller: feed or flush"] --> S["stream.ts: CesrParser state and drain"]
    S --> F["frames.ts: parseFrameStart"]
    S --> A["attachments.ts: parseAttachments"]
    F --> A
    F --> B["Serder: hydrate body once"]
    A --> G["parseAttachmentGroup: selected v1/v2 handler"]
    G --> P["Narrow primitives or one opaque span"]
    S --> E["ParseEvent: CesrFrame or error"]
    E --> K["KERI envelope: reuse parsed values"]
    E --> R["Annotation: walk and render tokens when requested"]
```

`common.ts` contains frame-family names and selector constants. `core/domain.ts`
provides byte widths shared with primitives. These modules carry no parser state.

## Completion

```mermaid
flowchart TD
    A["Body parsed"] --> B["Collect attachments"]
    B --> C{"Stopping point"}
    C -- "Next body or closed attachment enclosure" --> D["Emit complete frame"]
    C -- "Chunk exhausted" --> E["Keep pending frame"]
    C -- "Terminal or bounded exhaustion" --> D
    C -- "Partial group" --> F{"Input boundary known?"}
    F -- "No" --> E
    F -- "Terminal stream" --> G["Shortage error; discard pending frame"]
    F -- "Complete enclosure" --> H["GroupSizeError; reject enclosure"]
```

A complete `BodyWithAttachmentGroup` contains exactly one frame. A complete
`GenericGroup` can contain several; ordered siblings are queued before parsing
outside bytes. `framed` limits emissions per feed, not parsing boundaries.
`flush()` drains all complete frames and is idempotent.

## Version scopes

`streamGvrsn` is null until explicitly selected. `parseFrameStart` may infer
legacy framing only while unselected. It returns the resolved frame `gvrsn`
separately, so a v1 body cannot silently replace an explicit v2 stream genus.
Body protocol `pvrsn` remains distinct from both.

Enclosures pass their genus to children. Scoped selectors change subsequent
siblings only within that payload. Boundary probes and attachment readers use
the selected genus without fallback. Unsupported selectors and malformed
selected-version payloads fail.

## Attachment lengths

V1 signature and tuple groups count items; v2 counts payload units. Sized v1
wrappers also count payload units. Text units are four bytes; binary units are
three. Bound payload lengths before decoding items, and require exact exhaustion.
A complete enclosure cannot borrow bytes from a peer to finish an inner item.

Wrappers recurse through their bounded group payloads. There is no recovery
branch for malformed tails. Only wire families whose contents are intentionally
opaque produce `OpaqueSpan`; each span preserves the original bytes and domain.

## Deliberate limits

Native bodies hydrate once through Serder. Annotation's token walk exists only
for presentation. Runtime envelopes reuse typed primitives and validate roles at
the public frame boundary.

Progressive nested emission remains deferred until a measured workload justifies
its state and complexity, as described in ADR-0001.
