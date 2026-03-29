# Usage

This file is a working maintainer recipe for manually exercising the current
`keri-ts` CLI flow around:

- local AID creation
- endpoint-role authorization
- location seeding
- OOBI generation
- OOBI resolution

The flow is still evolving. Treat this as a practical local test sequence, not
finished end-user documentation.

## Current Manual Flow

Run these commands from `packages/keri`:

```bash
cd /Users/kbull/code/keri/kentbull/keri-ts/packages/keri

export SRC_DIR=/tmp/tufa-oobi-src
export DST_DIR=/tmp/tufa-oobi-dst
export SRC_NAME=src
export DST_NAME=dst
export ALIAS=alice
export PORT=8911

rm -rf "$SRC_DIR" "$DST_DIR"
```

Create source and target stores:

```bash
deno task tufa init -n "$SRC_NAME" --head-dir "$SRC_DIR" --nopasscode
deno task tufa init -n "$DST_NAME" --head-dir "$DST_DIR" --nopasscode
```

Create one transferable AID in the source store:

```bash
deno task tufa incept \
  -n "$SRC_NAME" \
  --head-dir "$SRC_DIR" \
  -a "$ALIAS" \
  -tf \
  --icount 1 \
  --isith 1 \
  --ncount 1 \
  --nsith 1 \
  --toad 0
```

Capture the source prefix:

```bash
export PRE=$(deno task tufa aid -n "$SRC_NAME" --head-dir "$SRC_DIR" -a "$ALIAS" | tail -n 1)
echo "$PRE"
```

Start the source-side agent server in a separate terminal:

```bash
cd /Users/kbull/code/keri/kentbull/keri-ts/packages/keri

export SRC_DIR=/tmp/tufa-oobi-src
export SRC_NAME=src
export PORT=8911

deno task tufa agent -n "$SRC_NAME" --head-dir "$SRC_DIR" --port "$PORT"
```

Notes:

- `tufa agent` currently seeds the local AID's `http` location reply.
- `tufa agent` also seeds controller and agent endpoint-role replies for the
  local AID.
- there is not yet a dedicated `tufa loc add` command in the CLI

Back in another terminal, add mailbox authorization and generate OOBIs:

```bash
cd /Users/kbull/code/keri/kentbull/keri-ts/packages/keri

export SRC_DIR=/tmp/tufa-oobi-src
export DST_DIR=/tmp/tufa-oobi-dst
export SRC_NAME=src
export DST_NAME=dst
export ALIAS=alice
export PORT=8911
export PRE=$(deno task tufa aid -n "$SRC_NAME" --head-dir "$SRC_DIR" -a "$ALIAS" | tail -n 1)

deno task tufa ends add -n "$SRC_NAME" --head-dir "$SRC_DIR" -a "$ALIAS" -r mailbox -e "$PRE"

deno task tufa oobi generate -n "$SRC_NAME" --head-dir "$SRC_DIR" -a "$ALIAS" -r controller
deno task tufa oobi generate -n "$SRC_NAME" --head-dir "$SRC_DIR" -a "$ALIAS" -r agent
deno task tufa oobi generate -n "$SRC_NAME" --head-dir "$SRC_DIR" -a "$ALIAS" -r mailbox
```

Resolve the generated OOBIs on the target side:

```bash
cd /Users/kbull/code/keri/kentbull/keri-ts/packages/keri

export DST_DIR=/tmp/tufa-oobi-dst
export DST_NAME=dst
export PRE=<paste-source-prefix-here>
export PORT=8911

deno task tufa oobi resolve -n "$DST_NAME" --head-dir "$DST_DIR" -u "http://127.0.0.1:${PORT}/oobi/${PRE}/controller"
deno task tufa oobi resolve -n "$DST_NAME" --head-dir "$DST_DIR" -u "http://127.0.0.1:${PORT}/oobi/${PRE}/agent/${PRE}"
deno task tufa oobi resolve -n "$DST_NAME" --head-dir "$DST_DIR" -u "http://127.0.0.1:${PORT}/oobi/${PRE}/mailbox/${PRE}"
```

## What This Exercises

- `tufa init`
- `tufa incept`
- `tufa aid`
- `tufa agent`
- `tufa ends add`
- `tufa oobi generate`
- `tufa oobi resolve`

It also exercises the current Gate E runtime path where reply and KEL material
flows through the shared parser, reactor, routing, and OOBI processing seams.

## Current Caveats

- This workflow is intentionally tied to the current local implementation.
- The location-scheme part of the flow is still implicit via `tufa agent`.
- Some steps may change as the CLI surface grows, especially once a dedicated
  location management command exists.
- If a step fails, update this file to match the actual working sequence rather
  than preserving outdated assumptions.
