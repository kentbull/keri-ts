# keri-ts monorepo

TypeScript packages for KERI and CESR:

- `keri-ts`: KERI runtime package and the `tufa` CLI
- `cesr-ts`: CESR parsing and annotation library

## Quick start

### Easiest entrypoints

```bash
# Show the CLI version
tufa version

# Annotate a CESR stream from file
tufa annotate --in samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr

# Annotate from stdin
cat samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr | tufa annotate
```

`tufa annotate` supports:

- `--in <path>` input file (defaults to stdin)
- `--out <path>` output file (defaults to stdout)
- `--qb2` treat input as qb2 binary
- `--pretty` pretty-print annotation output

## Install

```bash
# Global install
npm install -g keri-ts
tufa version

# One-off usage without global install
npx tufa version
```

## From source (repo)

```bash
# Run CLI from workspace
deno task tufa version
deno task tufa annotate --in samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr

# Run quality checks
deno task quality
```

## Package docs

- `packages/keri/README.md`: `keri-ts` package and `tufa` CLI
- `packages/cesr/README.md`: `cesr-ts` parser/annotator library

## Maintainer docs

Release/versioning and maintainer workflows are documented in:

- `MAINTAINER-README.md`
- `docs/release-versioning.md`
