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

## Annotate options

```bash
tufa annotate --in <path> --out <path> --pretty
tufa annotate --qb2 --in <binary.qb2> --out <annotation.txt>
```

- `--in <path>`: input file path (defaults to stdin)
- `--out <path>`: output file path (defaults to stdout)
- `--qb2`: parse input as qb2 binary
- `--pretty`: pretty-print annotation output

## Package entrypoints

```bash
# CLI help
npx tufa --help

# From source in this repo
deno task tufa --help
deno task tufa version
```
