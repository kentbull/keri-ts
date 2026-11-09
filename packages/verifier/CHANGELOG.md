# @keri-ts/verifier

## 2.1.0

### Minor Changes

- d80ccc5: Move to `cesr-ts` and `keri-ts` 2.1.0 so this package and its dependents no longer install libsodium.

## 2.0.1

### Patch Changes

- 1f23273: Depend on keri-ts 2.0.1, which rejects credentials whose body does not match their SAID. These packages pin keri-ts to an exact version, so they must be republished for the fix to reach their installs.

## 2.0.0

First npm release, coordinated with cesr-ts and keri-ts 2.0.0.

### Major Changes

- Use one upstream-aligned ACDC chaining evaluator for IPEX and application use.
  Remove the private graph evaluator and its unsupported operator/schema profiles.
  Applications supply issued-state verdicts, including the origin, and retain unknown
  optional branches until AND/OR reduction; schema and graph-shape failures remain global.

### Minor Changes

- Extract the existing credential verifier application, cue store, business policy and webhook workflow into `@keri-ts/verifier`. Tufa retains CLI registration and host composition and consumes the package directly; verifier imports move from `@keri-ts/tufa/runtime` to the new public package without a forwarding facade.

### Patch Changes

- Verify retained ACDC v2 Grant views against current authenticated observer evidence and shared graph policy, with read-only historical inspection and exact Grant-keyed reporting through existing cue stores.
- Retain authenticated per-Grant registry observations atomically with accepted IPEX evidence, preserve the first disclosed paths on later deliveries, and expose labeled read-only historical observations without changing current-authority policy.
- Use the runtime HTTP client and ordinary HTTPS certificate validation for ACDC v2 observer requests. Move observer selection, observation age and request timeout into the verifier application configuration, removing the dedicated observer and TLS command-line options.
