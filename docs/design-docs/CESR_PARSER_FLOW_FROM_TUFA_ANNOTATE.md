# CESR Parser Flow from `tufa annotate`

## Purpose

This document captures the concrete execution flow from `tufa annotate` into the
`cesr-ts` parser core, plus the parser state-machine mental model needed to
integrate streaming frame parsing into Effection-based services.

## End-to-end command flow

1. Node entrypoint starts Effection runtime:
   `packages/keri/src/app/cli/cli-node.ts`
2. Effection operation `tufa(args)` parses CLI args and dispatches command:
   `packages/keri/src/app/cli/cli.ts`
3. Commander wiring maps `annotate` flags to `annotateCommand`:
   `packages/keri/src/app/cli/command-definitions.ts`
4. `annotateCommand` reads input bytes (file or stdin) and calls `annotate` from
   `cesr-ts`:
   `packages/keri/src/app/cli/annotate.ts`
5. `annotate` -> `annotateFrames` -> `parseBytes`:
   `packages/cesr/src/annotate/annotator.ts`
6. `parseBytes` creates a parser instance, runs `feed(bytes)`, then `flush()`:
   `packages/cesr/src/core/parser-engine.ts`
7. Parsed frames are rendered into line-oriented annotations:
   `packages/cesr/src/annotate/render.ts`

```text
tufa annotate
  -> Commander dispatch
    -> annotateCommand()
      -> annotate(input)
        -> parseBytes()
          -> CesrParserCore.feed()
          -> CesrParserCore.flush()
        -> renderAnnotatedFrames()
      -> stdout/file
```

## Parser core mental model

`CesrParserCore` is a streaming frame assembler with three key state fields:

- `buffer`: unconsumed bytes
- `offset`: absolute consumed position
- `pendingFrame`: a partially completed frame waiting for more attachment bytes

Core loop (`drain`) behavior:

1. Consume leading `ano` separator bytes.
2. If `pendingFrame` exists, attempt `resumePendingFrame`.
3. Otherwise parse one base frame start with `parseFrame`.
4. Greedily parse trailing attachment groups.
5. Emit complete frame, or park in `pendingFrame` on `ShortageError`.
6. On `flush`, emit pending frame if complete enough, otherwise emit terminal
   shortage error for trailing incomplete bytes.

```text
feed(chunk)
  append chunk to buffer
  while buffer not empty:
    skip ano
    if pendingFrame exists:
      resumePendingFrame()
    else:
      parseFrame()
      parse trailing attachments
      emit frame OR park pendingFrame on shortage
```

## Cold-start classification (`sniff`)

The first byte tritet selects parsing domain:

- `msg`: message-domain Serder payload
- `txt`: CESR qb64 text domain
- `bny`: CESR qb2/binary domain
- `ano`: separator/anomaly byte to skip

Reference: `packages/cesr/src/parser/cold-start.ts`

## `parseFrame` decision tree

At frame start:

1. Skip leading `ano`.
2. If `txt`/`bny`, probe counter; if genus-version counter, decode active version.
3. Branch:
   - `msg` -> `reapSerder` for message-domain Serder frame
   - CESR body-group counter -> one of:
     - `BodyWithAttachmentGroup` (nested complete frame payload)
     - `NonNativeBodyGroup` (matter payload, with serder-reap fallback to opaque)
     - `FixBodyGroup` / `MapBodyGroup` (native CESR body, structured field extraction)

Reference: `packages/cesr/src/core/parser-engine.ts`

## Attachment parsing and version tolerance

Attachment groups are table-driven by CESR major version in
`group-dispatch.ts`:

- Parse group counter header
- Select parser from v1/v2 dispatch table
- Parse payload structure (tuple repeats, siger lists, wrapper/nested groups, etc.)

Dispatch modes:

- `strict`: no major-version fallback
- `compat`: on unknown/deserialize error, retry with alternate major version

Wrapper groups recursively parse nested groups and preserve opaque remainder when
recoverable instead of hard-failing.

Reference: `packages/cesr/src/parser/group-dispatch.ts`

## Annotation layer role (not frame boundary logic)

After parse emits frames, annotation renderer:

- Renders native CESR body fields with comments
- Renders message-domain serder bodies (pretty JSON when requested)
- Recursively renders attachment groups (including wrapper payloads)

Reference: `packages/cesr/src/annotate/render.ts`

## Effection integration pattern for agents/services

Current adapters already expose streaming parser integration:

- Async iterable adapter: `packages/cesr/src/adapters/async-iterable.ts`
- Effection adapter: `packages/cesr/src/adapters/effection.ts`

Recommended per-connection coroutine shape:

```text
connection task
  -> byte source AsyncIterable<Uint8Array>
  -> toEffectionFrames(source, parserOptions)
  -> for await frame in frames:
       classify frame (proto/ilk/body code/attachments)
       route to role handler (controller/mailbox/witness/watcher/...)
       persist + ack + emit downstream effects
```

## Operational invariants

- One parser instance per stream/session/connection.
- `ShortageError` is normal mid-stream; terminal only at final `flush` with
  leftover bytes.
- Keep version fallback inside parser/dispatch layer, not business logic.
- Downstream services consume complete `CesrFrame` objects, not raw bytes.

