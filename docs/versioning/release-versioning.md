# Versioning and release process

## Version numbers

Package versions follow semantic versioning: a major release may break callers, a
minor release adds behavior, a patch release fixes it. The major version also tracks
the KERIpy release line whose feature set the packages port; KERIpy's number is a
guideline, so a break on only one side still follows semver here. Package versions
never select KERI/ACDC/CESR wire versions; the specification column records which
ToIP KSWG specification revision a release line implements.

| keri-ts packages | KERIpy parity | ToIP KERI/ACDC/CESR specifications |
| ---------------- | ------------- | ---------------------------------- |
| 1.0.x            | 1.x           | v1.0                               |
| 2.0.x            | 2.x           | v1.1                               |

The coordinated 2.0.0 release covers cesr-ts, keri-ts, @keri-ts/tufa,
@keri-ts/verifier, @keri-ts/hosting, @keri-ts/wallet, @keri-ts/registrar and
@keri-ts/observer. @keri-ts/multisync remains unpublished at 0.1.0.

## Manifests and Changesets

Package manifests own versions independently for each published package.
`manifest:sync` updates Deno mirrors and npm workspace-lock versions;
`manifest:check` rejects drift. `release:version` applies Changesets, synchronizes
manifests and generates runtime version modules. Ordinary generation is deterministic;
release builds explicitly add `build.<run>.<sha>` metadata.

## Prepare an authorized release

1. Work from reviewed, clean source on a topic branch. Add package Changesets for
   publishable changes; documentation/tooling-only PRs use an empty changeset.
2. Apply `deno task release:version`, then `deno task manifest:check` and
   `deno task version:check`. Inspect package dependencies and generated changes.
3. Follow the [qualification standard](../plans/qualification/QUALIFICATION_PLAN.md).
   Record exact source, reference imports, native environment and test inventory.
   Scoped PR checks are not full release qualification.
4. Build and smoke the exact packed artifacts, including strict declarations,
   >16 MiB LMDB read/reopen and owned bytes, crypto, TCP and Tufa CLI/HTTP.
   Exercise Node 20.3 and the selected current runtime. Install compiler tools
   after runtime checks so they cannot mask missing runtime dependencies.
5. Commit only explicit release paths, with an explanatory body, and merge after
   exact-head checks pass. Never stage unrelated work or publish from a dirty tree.
6. With publication authorization, create annotated `<package>-v<VERSION>` tags
   (`cesr`, `keri`, `hosting`, `registrar`, `wallet`, `verifier`, `observer`,
   `tufa`) at the verified release commit. Push each selected tag explicitly in
   dependency order CESR → KERI → hosting → registrar → wallet → verifier →
   observer → Tufa, waiting for each package to become available on npm. Do not
   use an unqualified `--follow-tags` command or rewrite a published tag.
7. npm trusted publishing can only be configured for a package that already
   exists, so a package's first publication is maintainer-run. Dispatch that
   package's release workflow at the release commit with `publish=false`,
   download its uploaded tarball, `npm publish` exactly those bytes, then add the
   package workflow as the trusted publisher. When the tag is pushed, the shared
   workflow skips the existing npm version but attaches its own rebuilt tarball,
   whose CI build metadata differs; replace that GitHub release asset with
   `npm pack <name>@<version>` registry bytes so all copies match.

## Workflow and artifact ownership

The three package tag workflows call
[shared npm release](../../.github/workflows/npm-release.yml). It performs
package-owned checks, builds and smokes the primary artifact, publishes that
uploaded tarball to npm, then creates the GitHub release using registry bytes.
Tufa builds supporting dependency artifacts for smoke and verifies its declared
CESR/KERI versions are already published. The shared workflow does not itself
repeat the full interoperability/manual qualification battery.

Verify every selected version's registry metadata, internal dependencies,
workflow/npm/GitHub tarball equality and final registry-only installs. A merged
version PR, built tarball or successful source test is not publication evidence.
Changesets record version intent; the Changesets version-PR workflow does not
replace the package tag publication workflows.

Publication and GitHub release creation can fail separately. Inspect which side
effects completed before recovery. Existing exact versions are skipped by the
publish helper; preserve artifact identity and original tag provenance. If a
workflow-only repair runs at another commit, record both source identities and
verify package/manifests/build inputs rather than relabeling the tag.

## Container images

[`docker/tufa/Dockerfile`](../../docker/tufa/Dockerfile) packages an
already-published `@keri-ts/tufa` version from npm, never repository source, so
the image carries the released bytes. Every deployable service is a `tufa`
subcommand, so each `keri-ts-<role>` image is a Dockerfile target over that one
installation whose entrypoint is the service command: `tufa` (full CLI), `agent`,
`witness` (`witness start`), `hosted-witness` (`witness backend`), `watcher`,
`mailbox`, `registrar`, `observer`, `verifier`, `boot` and `dws-resolver`.
Keystores live on the `/usr/local/var/keri` volume and the process runs as the
unprivileged `node` user. After the npm release, dispatch the Tufa Docker workflow
with that version. It builds linux/amd64 and linux/arm64, smokes the CLI image with
init, incept, rotate and a reopened list on native LMDB, checks each role's command,
then pushes `<version>`, `<major>.<minor>` and optionally `latest` for every image.
A new GHCR package starts private; make each one public once.

## Recorded baseline

The [1.0.0 qualification report](../reports/parity/CLEANUP_RELEASE_2026-10-16.md)
records the three publications, Tufa's fixture-only recovery and installed checks.
It separately records post-release Tevery ownership; those later source changes
are not included in the published packages. Future releases need fresh evidence.
