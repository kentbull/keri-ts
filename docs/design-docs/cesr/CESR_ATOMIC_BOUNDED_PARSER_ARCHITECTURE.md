# CESR Atomic Bounded Substream Parser Architecture

## Purpose

This document explains how bytes move through the current `keri-ts` CESR parser
when using the intentional **atomic bounded substream** architecture.

Goals:

- make frame slicing and emission behavior explicit
- show where version context is applied
- show where nested counted groups are parsed atomically

Scope:

- `packages/cesr/src/core/parser-engine.ts`
- `packages/cesr/src/parser/group-dispatch.ts`

Canonical lifecycle contract:

- `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`

## Core Idea

For counted nested groups (`GenericGroup`, `BodyWithAttachmentGroup`,
`AttachmentGroup` wrappers), the parser:

1. waits until the counted payload bytes are available
2. parses that bounded payload as an atomic unit
3. emits complete frames (or deterministic shortage/error behavior)

It does **not** keep a resumable nested parse stack across chunk boundaries.

## Component Map

```mermaid
flowchart TD
    A["feed(chunk)"] --> B["Append bytes"]
    B --> D["drain()"]
    Q["flush()"] --> R["drain(terminal=true)"]
    R --> D
    D --> F{"Open frame?"}
    F -- "yes" --> G["Collect trailing attachments"]
    G --> H{"Completion boundary?"}
    H -- "yes" --> O["Emit frame"]
    H -- "no" --> P["Wait, or report terminal shortage"]
    F -- "no" --> I{"Queued complete siblings?"}
    I -- "yes" --> O
    I -- "no" --> J["Parse next body or enclosure"]
    J --> K{"Complete enclosure?"}
    K -- "yes" --> L["Queue siblings"]
    L --> O
    K -- "no" --> M["Retain open frame"]
    M --> G
    O --> D
```

## Frame Start Parsing Contract

```mermaid
flowchart TD
    A["parseFrame(input, inheritedVersion)"] --> B["Skip leading ano bytes"]
    B --> C{"Cold domain"}
    C -- "msg" --> D["reapSerder()"]
    D --> E["Return frame body, consumed, version, streamVersion"]

    C -- "txt or bny" --> F{"Leading selector is KERIACDCGenusVersion?"}
    F -- "yes" --> G["Decode selector and update active stream version"]
    F -- "no" --> H["Keep inherited active stream version"]
    G --> I["resolveFrameStartCounter(selected genus or legacy inference)"]
    H --> I
    I --> J{"Frame start type (counter.name)"}
    J -- "BodyWithAttachmentGroup" --> K["parseBodyWithAttachmentGroup()"]
    J -- "NonNativeBodyGroup" --> L["parseNonNativeBodyGroup()"]
    J -- "FixBodyGroup or MapBodyGroup" --> M["parseNativeBodyGroup()"]
    J -- "GenericGroup" --> N["parseGenericGroup()"]
    J -- "other" --> O["ColdStartError"]
```

`resolveFrameStartCounter(...)` uses the selected genus. Only an unselected
stream head permits alternate-major legacy recognition. Enclosures supply a
concrete genus to their children; body protocol metadata cannot replace it.

## Atomic Nested Group Boundaries

```mermaid
flowchart TD
    A["Counted group counter"] --> B["payloadSize = count * unit"]
    B --> C{"buffer has full payload?"}
    C -- "no" --> D["ShortageError"]
    C -- "yes" --> E["slice payload bytes exactly"]
    E --> F["parse bounded payload atomically"]
    F --> G{"payload fully consumed?"}
    G -- "no" --> H["ColdStartError or GroupSizeError"]
    G -- "yes" --> I["Return parsed frame/group and consumed bytes"]
```

## GenericGroup Internal Behavior

```mermaid
flowchart TD
    A["parseGenericGroup()"] --> B["Bound payload by count"]
    B --> C["parseFrameSequence(payload, inheritedVersion)"]
    C --> D["First enclosed frame"]
    C --> E["Remaining enclosed frames"]
    D --> F["Return first as current parse result"]
    E --> G["Return remainder as complete siblings"]
    G --> H["drain() queues siblings before new parsing"]
```

## Attachment Wrapper Behavior

```mermaid
flowchart TD
    A["parseAttachmentGroup()"] --> B["group-dispatch parseQuadletGroup()"]
    B --> C{"Wrapper group?"}
    C -- "no" --> D["Parse direct items"]
    C -- "yes" --> E["Iterate bounded wrapper payload"]
    E --> F{"Nested counter is genus version?"}
    F -- "yes" --> G["Update nestedVersion and continue"]
    F -- "no" --> H["Parse nested group with nestedVersion"]
    H --> I{"Parse failure recoverable?"}
    I -- "yes" --> J["Keep opaque remainder"]
    I -- "no" --> K["Throw"]
```

## Sequence: Chunked Top-Level Parse

```mermaid
sequenceDiagram
    participant C as Caller
    participant P as CesrParser
    participant S as CesrParser stream state

    C->>P: "feed(chunk-1)"
    P->>S: "append bytes"
    P->>P: "drain()"
    P->>P: "parseFrame(...)"
    alt "insufficient bytes for frame or group"
        P-->>C: "[] (no emit yet)"
    else "enough bytes"
        P-->>C: "[frame events]"
    end

    C->>P: "feed(chunk-2)"
    P->>S: "append bytes"
    P->>P: "resume pending or parse next"
    P-->>C: "[frame/error events]"

    C->>P: "flush()"
    P-->>C: "[complete frames in order, optional terminal shortage]"
```

## Sequence: BodyWithAttachmentGroup (Atomic Enclosed Parse)

```mermaid
sequenceDiagram
    participant C as Caller
    participant P as CesrParser
    participant G as "parseBodyWithAttachmentGroup"
    participant F as "parseCompleteFrame(payload)"

    C->>P: "feed(stream)"
    P->>P: "parseFrame(...) sees BodyWithAttachmentGroup counter"
    P->>G: "parseBodyWithAttachmentGroup(input, count)"
    G->>G: "ensure full payload count * unit"
    G->>F: "parseCompleteFrame(bounded payload)"
    F-->>G: "enclosed complete frame + consumed"
    G-->>P: "frame + consumed"
    P-->>C: "[frame event]"
```

## Version Context Model

There are three practical version scopes:

1. **Top-level stream scope**: `streamVersion`, updated by leading
   `KERIACDCGenusVersion` at frame start.
2. **Current frame attachment scope**: frame `version`, used when parsing that
   frame's attachment groups.
3. **Nested wrapper scope**: `nestedVersion` inside wrapper payload iteration in
   group dispatch.

This gives stack-like behavior via bounded function scope without a global
mutable nested parse stack.

## Emission and Deferral Rules

1. Open frames wait for a following body, an enclosing attachment-set boundary,
   or explicit terminal flush. Chunk exhaustion is not a completion boundary.
2. Enclosed frames are complete; their siblings emit before parsing outside bytes.
3. `framed` caps complete-frame emissions per feed, without changing boundaries.
4. `flush()` drains all complete frames. An incomplete attachment tail produces
   one shortage error and discards its pending frame, without partial emission.

## When This Architecture Is Preferable

- parity-hardening and readability phase
- maintainability-first parser evolution
- minimizing nested resume-state complexity and bug surface

## When To Revisit

If production workloads require lower latency and progressive nested emission
for large counted groups, add an explicit incremental parser strategy as a
separate module/mode (per ADR-0001).
