# Node pointer-compression measurement, 2026-10-19

The pointer-compressed build reduced median peak RSS by about 2–5% across these
three short installed CLI workloads. It passed the existing installed-package
checks on Linux ARM64, including native LMDB rows over 16 MiB, read/reopen and
owned-byte checks, signing/tamper refusal, TCP cleanup, strict declarations and
hosted Tufa startup. This supports a qualified Node container profile, not changing
the source commands from Deno or promising half the process memory.

## Source and environment

- Unpublished source-built `cesr-ts`, `keri-ts` and `@keri-ts/tufa` 1.0.0 tarballs
  from `c80d7ab4c57db398289563383a60c35c0e26b841`; these are not registry artifacts.
- Linux ARM64 inside Docker Desktop, 8 CPUs and approximately 10 GiB VM memory.
  All source/test state was on a Docker-managed Linux volume; no macOS bind mount.
- Both builds: Node 26.10.0, V8 `14.6.202.34-node.34`, Debian trixie.
- Official: `node:26.10.0-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33`.
- Caged: `platformatic/node-caged:26-slim@sha256:fa80c7804a23484a3b707733f8b3d0e45a93babd7ce6ae6e29312ed2c1eb8403`.
- `v8_enable_pointer_compression` was 0 and 1 respectively; both reported default
  `heap_size_limit=2248146944`. Heap limit alone did not identify compression.

## Method and results

Five rounds alternated which image ran first. Each case used a fresh Node process
and the same exit probe, without forced GC or heap tuning. `tufa version` measures
CLI startup/imports. `tufa incept` follows an unmeasured `init` into a fresh store
with the same public fixture salt/config, without a passcode or witnesses.
`tephra bench` parses 256 repetitions of
`CESR_1_0-oor-auth-vc.cesr`: 3,761,920 bytes, SHA-256
`9b29dc48123a9ab60d0fd7c0f1dd008a7181a5357c31e638222f5116304d6ad5`,
one warmup and five measured passes, yielding 25,600 measured frames in every run.
All 30 measured processes exited successfully.

Values are MiB, **median (minimum–maximum)**. Peak RSS comes from Linux
`process.resourceUsage().maxRSS` (KiB converted to MiB). Heap is a single
`heapUsed` snapshot at exit, including uncollected garbage; it is neither peak
heap nor post-GC live retention.

| Case         | Official peak RSS      | Caged peak RSS         | Official heap at exit | Caged heap at exit  |
| ------------ | ---------------------- | ---------------------- | --------------------- | ------------------- |
| tufa-version | 94.72 (92.96–97.45)    | 93.21 (91.70–93.67)    | 19.14 (18.93–22.16)   | 15.11 (15.05–15.14) |
| tephra-bench | 96.27 (94.59–96.56)    | 91.49 (90.38–94.10)    | 13.34 (11.13–15.91)   | 9.42 (7.89–14.15)   |
| tufa-incept  | 177.47 (176.66–178.19) | 168.15 (168.15–168.59) | 30.62 (21.19–30.92)   | 17.51 (17.44–17.52) |

The median peak-RSS differences were 1.60% for version, 4.96% for parser replay and
5.25% for inception. Some ranges overlap. Five rounds are a small operational
sample, not a confidence interval or proof of a general production improvement.
The images also differ in build configuration beyond pointer compression, so this
is a comparison of deployable runtime profiles, not an isolated compiler experiment.

Qualification activity shared the Docker VM. Elapsed values are retained in raw
data for transparency but do not establish throughput or tail-latency differences.
Long-lived traffic, heaps near the cage limit, worker-thread addons and AMD64
memory behavior remain outside this measurement. The package CI profile provides
separate compatibility evidence; it does not extend these memory numbers.

## Reproduction artifacts

The exact [exit probe](node-pointer-compression-2026-10-19/observer.mjs),
[case driver](node-pointer-compression-2026-10-19/cases.mjs) and
[raw samples](node-pointer-compression-2026-10-19/samples.jsonl) retain the experiment.
They are dated measurement artifacts, not application hooks or a new test framework.

Install the same three tarballs under `/profile` in each digest-pinned image;
make the recorded source/samples available at `/workspace/keri-ts` from a Linux
volume. Copy the probe to `/profile/observer.mjs` and the driver to
`/profile/cases.mjs`. Run `node /profile/cases.mjs ROUND VARIANT` for rounds 1–5,
alternating `official caged` and `caged official`. Store all databases in the Linux
container. The driver prepares each store and fails on a nonzero CLI exit or empty
parser output; compare the recorded corpus hash and frame count before memory.

For current runtime choices, build-feature references and qualification requirements,
see [runtime memory](../../design-docs/runtime/RUNTIME_MEMORY.md). The
[Platformatic source](https://github.com/platformatic/node-caged/tree/97879611bd48a378d51e3afe592aef9f11fcf627)
provides the pointer-compressed build; these measurements replace extrapolation
from its synthetic pointer-heavy examples to this application's total RSS.
