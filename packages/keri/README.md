# keri-ts

KERI TypeScript runtime package with the `tufa` CLI.

## Install

```bash
# As a dependency
npm install keri-ts

# Global CLI install
npm install -g keri-ts
```

## CLI quick start

`tufa version` and `tufa annotate` are the fastest way to verify your setup.

```bash
# Version
tufa version
tufa --version

# Annotate CESR from file
tufa annotate --in ./mystream.cesr

# Annotate from stdin
cat ./mystream.cesr | tufa annotate
```

## Benchmark CESR parser

Benchmark any CESR stream from file or stdin:

```bash
# Benchmark a stream file
tufa benchmark cesr --in ./mystream.cesr

# Benchmark from stdin with explicit chunk simulation
cat ./mystream.cesr | tufa benchmark cesr --chunk-size 256 --iterations 25 --warmup 5
```

- `--in <path>`: input file path (defaults to stdin)
- `--iterations <count>`: measured benchmark runs (default `50`)
- `--warmup <count>`: warmup runs before measurement (default `5`)
- `--chunk-size <bytes>`: chunk size for streaming simulation (`0` = full
  stream)
- `--framed`: benchmark parser in framed mode
- `--compat`: benchmark parser with compat attachment dispatch mode
- `--allow-errors`: continue benchmark even when parse errors are emitted
- `--json`: print one JSON result line

## Annotate options

```bash
tufa annotate --in <path> --out <path> --pretty
tufa annotate --qb2 --in <binary.qb2> --out <annotation.txt>
```

- `--in <path>`: input file path (defaults to stdin)
- `--out <path>`: output file path (defaults to stdout)
- `--qb2`: parse input as qb2 binary
- `--pretty`: pretty-print annotation output
- `--colored`: colorize annotation output on stdout only (ignored with `--out`)

Optional color overrides:

- File: `$HOME/.tufa/annot-color.yaml` or `$HOME/.tufa/annot-color.yml`
- Keys: `counter`, `group`, `body`, `signature`, `said`, `opaque`, `comment`
- Values: `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`,
  or bright variants (`brightBlack` ... `brightWhite`)

## Package entrypoints

```bash
# CLI help
npx tufa --help

# From source in this repo
deno task tufa --help
deno task tufa version
```
