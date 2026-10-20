# Runtime selection and memory

Choose the executable before starting work. Source commands run Deno; installed
packages use the Node executable selected by their `#!/usr/bin/env node` launchers.
Changing a Docker base's Node binary does not change a Deno process's V8 build.

| Entry point                                                               | Actual execution                | Memory controls that apply                                                       |
| ------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `deno task tufa`, Tufa start/dev, CESR source commands                    | Deno source modules             | Selected Deno build and operator-supplied Deno settings                          |
| Installed `tufa` / `tephra`, application imports of `keri-ts` / `cesr-ts` | Node                            | Selected Node build and operator-supplied Node settings                          |
| DID Webs runtime/interop Docker stages                                    | Deno; Node supplies build tools | A different Node base alone cannot compress the application heap                 |
| KERI/CESR CI owners                                                       | Deno subprocesses               | The child uses the parent's exact executable; suite concurrency remains explicit |
| Parser benchmark supervisor                                               | Deno from `PATH`                | Python samples child RSS; the worker records its Deno version                    |
| KLI bridge and Python interoperability peers                              | Separate Python processes       | V8 settings do not control their memory                                          |

Effection tasks are cooperative operations within their process, not worker threads
or additional V8 isolates; they do not provide additional cages. A worker-based
redesign requires its own measured need and protocol/store ownership design.
Protocol ownership and store lifetimes remain as
specified in [the runtime contract](INGRESS_AND_EGRESS.md).

## Node deployment profile

For Node-based Linux containers with a suitable per-isolate heap requirement,
prefer the qualified pointer-compressed profile over an equivalent stock Node
build. Use the digest recorded in the package CI job and
[measurement report](../../reports/runtime/NODE_POINTER_COMPRESSION_2026-10-19.md),
not an unreviewed moving `latest` tag. Existing official Node support, including the
minimum Node 20.3 package checks and Alpine checks, remains required. An image
digest update must reverify the build feature and native/package behavior; rerun
the relevant memory workload before claiming a new benefit.

Pointer compression is a Node **build option**; `NODE_OPTIONS` cannot enable it
in an ordinary binary. The tested Platformatic image reports
`process.config.variables.v8_enable_pointer_compression === 1`. Verify that field
on the actual executable rather than inferring it from a small heap limit: both
measured Node builds reported the same default heap limit. Node's
[configure source](https://github.com/nodejs/node/blob/v26.10.0/configure.py) and
[Platformatic's build](https://github.com/platformatic/node-caged/blob/97879611bd48a378d51e3afe592aef9f11fcf627/docker/slim/Dockerfile)
record the compile-time choice.

The pointer-compressed heap has an approximately 4 GiB ceiling per isolate group.
Native allocations, ArrayBuffer backing stores and resident LMDB mappings remain
outside that heap. A heap-size setting neither enables compression nor caps total
RSS. Do not raise heap settings or split protocol state into workers without a
measured workload that requires it. Standalone package launchers do not download a
custom runtime or alter the operator's `NODE_OPTIONS`.

Native compatibility must be qualified on the actual runtime and architecture.
Keep the LMDB data-v1/NAPI rebuild (`LMDB_DATA_V1=true`,
`ENABLE_V8_FUNCTIONS=false`); loading an addon is insufficient proof. Package CI
runs the existing large-row/read/reopen, source-byte ownership, signing, transport,
declaration and hosted CLI checks on the pinned caged image. The same checks on
an official runtime still matter. Neither generic N-API compatibility claims nor
these checks qualify arbitrary legacy V8/NAN addons or untested worker use.

## Deno and process settings

The pinned Deno 2.8.2 workspace selects rusty_v8 149.2.0 with only `simdutf` enabled
and default features disabled. That rusty_v8 build leaves pointer compression off
unless its build feature is enabled. There is no supported runtime flag in this
configuration that turns it on. See the pinned
[Deno dependency](https://github.com/denoland/deno/blob/v2.8.2/Cargo.toml) and
[rusty_v8 build](https://github.com/denoland/rusty_v8/blob/v149.2.0/build.rs).
Recheck source and actual release artifacts when changing Deno; do not turn this
observation into a claim about every future release or custom build.

KERI test owners retain their measured isolation/concurrency policy. CESR's
`CESR_TEST_JOBS` / `DENO_JOBS` controls test concurrency, with its existing automatic
cap; these are test-process controls, not runtime admission or memory accounting.
`--expose-gc` belongs to decoder-retention tests, not normal CLI startup.

Measure the workload before adding GC, heap or concurrency overrides. Record peak
RSS separately from allocated heap, external bytes and ArrayBuffers; ArrayBuffer
storage is included in `external`, so those fields must not be added together.
Large virtual LMDB mappings are not equivalent to resident memory. Preserve
cancellation and joined teardown before store closure; runtime tuning does not
replace ownership or fix leaked handles.

On macOS, run native-heavy qualification with source and database state inside
Docker-managed Linux volumes. Clone or copy inputs into the container; do not bind
mount macOS directories for these runs. Keep test data inside Linux even when
copying text logs or package artifacts back for review.

## Evidence boundary

The recorded five-round Node comparison measured three installed CLI paths and
found about 2–5% lower median peak RSS with the caged build. Larger differences in
end-of-command heap snapshots do not establish a universal 50% process-memory
saving. Byte buffers, native state and workload shape matter. The report records
raw samples, ranges, source/image identities and reproduction artifacts; it does
not qualify long-lived host latency, large heaps or every deployment topology.

This profile adds no application memory budget, logging wrapper, runtime service
bag, automatic runtime replacement or generic process framework.
